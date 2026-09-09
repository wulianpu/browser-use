// Runtime launcher used by tests and scripts/verify-runtime-contract.mjs (§33/§68).
// Spawns the real `uvx --python 3.12 browser-use@0.13.10 --cli-mcp` process exactly
// as declared in mcp.json, with a sanitized host environment and a disposable
// PLUGIN_DATA. Not plugin runtime code — the plugin is only plugin.json/mcp.json/SKILL.md.

import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { McpStdioClient } from "./mcpClient.mjs";
import { buildRuntimeEnv } from "./hostPolicy.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(HERE, "..", "..");

export function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

export function loadPluginManifest() {
  return readJson("plugin.json");
}

export function loadMcpConfig() {
  return readJson("mcp.json");
}

export function loadUpstreamLock() {
  return readJson("upstream.lock.json");
}

export function mcpServerConfig() {
  return loadMcpConfig().mcpServers["browser-use"];
}

export function resolveTemplate(value, { pluginData, pluginRoot }) {
  return String(value)
    .split("${PLUGIN_DATA}")
    .join(pluginData)
    .split("${PLUGIN_ROOT}")
    .join(pluginRoot);
}

// Passive uvx availability probe (no Chrome, no MCP server start).
export function uvxAvailable() {
  const probe = spawnSync(mcpServerConfig().command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return probe.error ? false : true;
}

// Runtime gating policy:
//   BROWSER_USE_SKIP_RUNTIME=1      → explicit skip of runtime tests (local dev without uvx)
//   default                          → runtime tests must run for real; missing uvx FAILS the
//                                      suite (§80: no mock-only MCP tests, no implicit skip)
//   BROWSER_USE_BROWSER_TESTS=1     → opt in to tests that call browser_exec / drive real Chrome (§35)
//   BROWSER_USE_QUALIFICATION=1     → opt in to interactive qualification scenarios
//   BROWSER_USE_QUALIFICATION_SCENARIO → existing-browser | cold-start | remote-debugging-disabled
//   BROWSER_USE_QUALIFICATION_BROWSER → chrome | chromium | edge — the browser this run
//                                      qualifies; probes and identity guards are target-specific
export const RUNTIME_GATES = Object.freeze({
  skipRuntime: process.env.BROWSER_USE_SKIP_RUNTIME === "1",
  browserTests: process.env.BROWSER_USE_BROWSER_TESTS === "1",
  qualification: process.env.BROWSER_USE_QUALIFICATION === "1",
  qualificationScenario: process.env.BROWSER_USE_QUALIFICATION_SCENARIO || "existing-browser",
  qualificationBrowser: process.env.BROWSER_USE_QUALIFICATION_BROWSER || "chrome",
});

export function requireRuntimeOrSkip(t) {
  if (RUNTIME_GATES.skipRuntime) {
    t.skip("BROWSER_USE_SKIP_RUNTIME=1 — runtime tests skipped by explicit request");
    return false;
  }
  if (!uvxAvailable()) {
    // Implicit skip would let the suite go green without the real runtime (§80).
    throw new Error(
      `"${mcpServerConfig().command}" is not on PATH. Runtime tests must run for real: ` +
        "install uv (https://docs.astral.sh/uv/) or explicitly set BROWSER_USE_SKIP_RUNTIME=1.",
    );
  }
  return true;
}

// Start the real MCP runtime with the same launch chain an Agent Host must use:
// sanitized base env (§28) + mcp.json env overlay (§11) + PLUGIN_ROOT/PLUGIN_DATA (§4),
// cwd from mcp.json, then initialize + tools/list (§69 contract validation).
// The returned object's stop() recycles BOTH the MCP process and — when the
// PLUGIN_DATA was test-created — the Browser Harness daemon bound to that
// BH_HOME (finding #8: killed MCP hosts otherwise orphan their daemons, and
// a day of qualification runs accumulated 42 of them until spawning broke).
export async function startRuntime({ pluginData, initTimeoutMs } = {}) {
  const server = mcpServerConfig();
  const ownsPluginData = !pluginData;
  const dataDir = pluginData ?? (await mkdtemp(join(tmpdir(), "browser-use-plugin-data-")));
  const startedAt = Date.now();
  const env = buildRuntimeEnv(process.env, {
    pluginData: dataDir,
    pluginRoot: repoRoot,
    overlay: server.env,
  });
  const cwd = resolveTemplate(server.cwd, { pluginData: dataDir, pluginRoot: repoRoot });
  const client = new McpStdioClient({
    command: server.command,
    args: server.args,
    env,
    cwd,
    clientName: "browser-use-plugin-contract",
  });
  await client.start({ initTimeoutMs: initTimeoutMs ?? 120_000 });
  const { tools } = await client.listTools();

  async function stop() {
    await client.stop();
    if (ownsPluginData) {
      await stopOwnedHarnessDaemon(server, dataDir, startedAt);
    }
  }

  return { client, tools, pluginData: dataDir, cwd, ownsPluginData, stop };
}

// Stop the daemon bound to OUR temp BH_HOME — never a global daemon kill.
// Primary: the official `browser-use --reload` scoped by the same env (its
// stop lands asynchronously). Fallback: after a short grace window, kill by
// PID ONLY harness-daemon processes created after this runtime started
// (time-window scoping; daemons from other owners predate the window).
function stopOwnedHarnessDaemon(server, dataDir, startedAtMs) {
  const daemonEnv = {
    ...process.env,
    BH_HOME: `${dataDir}/browser-harness`,
    BH_AGENT_WORKSPACE: `${dataDir}/agent-workspace`,
  };
  try {
    spawnSync(server.command, [...server.args.slice(0, -1), "--reload"], {
      env: daemonEnv,
      windowsHide: true,
      timeout: 120_000,
    });
  } catch {
    /* best-effort official stop; the fallback below still applies */
  }
  const deadline = Date.now() + 12_000;
  for (;;) {
    const lingering = harnessDaemonsCreatedAfter(startedAtMs);
    if (lingering.length === 0) return;
    if (Date.now() > deadline) {
      for (const pid of lingering) {
        try {
          process.kill(pid); // Windows: terminates; POSIX: SIGTERM
        } catch {
          /* already gone */
        }
      }
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500); // sleep 1.5s
  }
}

// Harness-daemon PIDs created after the given timestamp (empty list on
// probe failure — cleanup then simply does nothing extra).
function harnessDaemonsCreatedAfter(startedAtMs) {
  try {
    if (process.platform === "win32") {
      const out = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command",
          'Get-CimInstance Win32_Process | Where-Object { $_.Name -like "python*" -and $_.CommandLine -match "browser_harness.daemon" } | ForEach-Object { if ($_.CreationDate.ToFileTimeUtc() -gt ' + (startedAtMs + 11644473600000) * 10000 + ') { $_.ProcessId } }'],
        { encoding: "utf8", windowsHide: true, timeout: 30_000 },
      );
      return (out.stdout ?? "").split(/\s+/).filter((t) => /^\d+$/.test(t)).map(Number);
    }
    const out = spawnSync("ps", ["-eo", "pid,lstart,command"], { encoding: "utf8", timeout: 15_000 });
    const lines = (out.stdout ?? "").split("\n").filter((l) => /browser_harness\.daemon/.test(l));
    const pids = [];
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)\s+/);
      if (!m) continue;
      const created = new Date(line.slice(String(m[1]).length + 1, 30)).getTime();
      if (Number.isFinite(created) && created >= startedAtMs) pids.push(Number(m[1]));
    }
    return pids;
  } catch {
    return [];
  }
}
