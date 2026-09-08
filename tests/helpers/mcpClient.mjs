// Minimal MCP stdio JSON-RPC client for tests and contract verification (§69/§80).
// Newline-delimited JSON over the subprocess's stdin/stdout. Not plugin runtime code.

import { spawn } from "node:child_process";
import { once } from "node:events";

const STDERR_RING_LIMIT = 64 * 1024;

export class McpTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`MCP request "${method}" timed out after ${timeoutMs} ms`);
    this.name = "McpTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class McpProcessError extends Error {
  constructor(message, { exitCode, signal, stderr } = {}) {
    super(message);
    this.name = "McpProcessError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderr = stderr;
  }
}

export class McpStdioClient {
  constructor({ command, args, env, cwd, clientName = "browser-use-plugin-tests", clientVersion = "1.0.0" }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.clientInfo = { name: clientName, version: clientVersion };
    this.nextId = 1;
    this.pending = new Map();
    this.serverInfo = null;
    this.protocolVersion = null;
    this.exitInfo = null;
    this._stderrChunks = [];
    this._stdoutBuffer = "";
    this.child = null;
  }

  get stderrTail() {
    return this._stderrChunks.join("");
  }

  async start({ initTimeoutMs = 120_000 } = {}) {
    this.child = spawn(this.command, this.args, {
      env: this.env,
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this._stderrChunks.push(chunk);
      const total = this.stderrTail.length;
      if (total > STDERR_RING_LIMIT) {
        this._stderrChunks = [this.stderrTail.slice(total - STDERR_RING_LIMIT)];
      }
    });
    this.child.on("exit", (code, signal) => {
      this.exitInfo = { code, signal };
      const err = new McpProcessError(
        `MCP process exited (code=${code}, signal=${signal})`,
        { exitCode: code, signal, stderr: this.stderrTail },
      );
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
    this.child.on("error", (err) => {
      const wrapped = new McpProcessError(`failed to spawn "${this.command}": ${err.message}`, { stderr: this.stderrTail });
      for (const { reject } of this.pending.values()) reject(wrapped);
      this.pending.clear();
    });

    const init = await this.request(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: this.clientInfo,
      },
      initTimeoutMs,
    );
    this.serverInfo = init.serverInfo;
    this.protocolVersion = init.protocolVersion;
    this.notify("notifications/initialized", {});
    return init;
  }

  _onStdout(chunk) {
    this._stdoutBuffer += chunk;
    let newlineIndex = this._stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this._stdoutBuffer.slice(0, newlineIndex).trim();
      this._stdoutBuffer = this._stdoutBuffer.slice(newlineIndex + 1);
      if (line) this._onMessage(line);
      newlineIndex = this._stdoutBuffer.indexOf("\n");
    }
  }

  _onMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Non-JSON noise on stdout; ignore for robustness.
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // Server-initiated requests/notifications are not needed by these tests.
  }

  request(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      if (this.exitInfo) {
        reject(new McpProcessError("MCP process already exited", { ...this.exitInfo, stderr: this.stderrTail }));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload);
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  listTools(timeoutMs = 60_000) {
    return this.request("tools/list", {}, timeoutMs);
  }

  callTool(name, args, timeoutMs = 300_000) {
    return this.request("tools/call", { name, arguments: args ?? {} }, timeoutMs);
  }

  async stop({ gracefulMs = 8_000 } = {}) {
    if (!this.child || this.exitInfo) return this.exitInfo;
    const exited = once(this.child, "exit").then(([code, signal]) => ({ code, signal }));
    this.child.stdin.end();
    const timer = setTimeout(() => {
      try {
        this.child.kill();
      } catch {
        /* already gone */
      }
    }, gracefulMs);
    try {
      return await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
