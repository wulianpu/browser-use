// Reference host policy for the browser-use plugin (test oracle + integration guide).
//
// This file is NOT plugin runtime code. The Agent Host owns trust, authorization,
// isolation and lifecycle (spec §2). It exists so the security tests in
// tests/security/ have an executable, reviewable definition of the required host
// behavior, and so hosts integrating this plugin can copy a known-good baseline.

import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

// §25 Host permission requirements.
export const TOOL_PERMISSIONS = Object.freeze({
  browser_screenshot: ["browser.observe"],
  browser_exec: ["browser.interact", "browser.debug", "local.code-execution"],
});

// §75 Host error contract — the stable business error API.
export const ERROR_CODES = Object.freeze([
  "BROWSER_USE_RUNTIME_MISSING",
  "BROWSER_USE_RUNTIME_START_FAILED",
  "BROWSER_USE_MCP_HANDSHAKE_FAILED",
  "BROWSER_USE_TOOL_UNAVAILABLE",
  "BROWSER_USE_BUSY",
  "BROWSER_USE_PERMISSION_DENIED",
  "BROWSER_USE_TIMEOUT",
  "BROWSER_USE_RESULT_TOO_LARGE",
  "BROWSER_USE_RUNTIME_CRASHED",
  "BROWSER_USE_OUTCOME_UNKNOWN",
  "BROWSER_USE_BROWSER_PERMISSION_REQUIRED",
]);

// §55 Timeout defaults (ms). Exec may be raised to MAX by product policy but must stay bounded.
export const DEFAULT_TIMEOUTS_MS = Object.freeze({
  browser_exec: 300_000,
  browser_screenshot: 30_000,
});
export const MAX_TIMEOUTS_MS = Object.freeze({ browser_exec: 1_800_000 });

// §56/§57 Input and output bounds.
export const LIMITS = Object.freeze({
  codeInputBytes: 128 * 1024,
  textOutputBytes: 1024 * 1024,
  imageOutputBytes: 16 * 1024 * 1024,
});

// §19/§20/§21/§22 telemetry, recordings, domain skills, tab marker must be off.
export const REQUIRED_DISABLED_ENV = Object.freeze({
  BH_TELEMETRY: "false",
  BROWSER_HARNESS_TELEMETRY: "false",
  ANONYMIZED_TELEMETRY: "false",
  BH_RECORD: "0",
  BH_DOMAIN_SKILLS: "0",
  BH_TAB_MARKER: "0",
});

// §29 Secrets that must never reach the plugin subprocess by default inheritance.
export const KNOWN_SECRET_KEYS = Object.freeze([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
  "DATABASE_URL",
]);
const SECRET_SUFFIXES = ["_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIALS"];

// §28 Host environment sanitization: allowlist-based base environment for the
// stdio subprocess. Keys a Python/uvx runtime needs to function; nothing more.
const ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "SystemDrive",
  "ComSpec",
  "COMSPEC",
  "WINDIR",
  "windir",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "APPDATA",
  "USERNAME",
  "USERDOMAIN",
  "LANG",
  "LC_ALL",
  "TZ",
  "OS",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
];

export function policyError(code, message) {
  const err = new Error(message ?? code);
  err.code = code;
  return err;
}

export function isSecretLikeKey(key) {
  const upper = String(key).toUpperCase();
  return (
    KNOWN_SECRET_KEYS.includes(upper) ||
    SECRET_SUFFIXES.some((suffix) => upper.endsWith(suffix)) ||
    upper.startsWith("AWS_")
  );
}

// §28 sanitized base environment: copy only allowlisted keys from the host env.
export function sanitizeBaseEnv(hostEnv) {
  const base = {};
  for (const key of ENV_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(hostEnv, key) && hostEnv[key] !== undefined) {
      base[key] = hostEnv[key];
    }
  }
  return base;
}

// §17/§18/§28 full runtime environment: sanitized base + plugin mcp.json overlay
// (with ${PLUGIN_DATA}/${PLUGIN_ROOT} expanded) + the PLUGIN_ROOT/PLUGIN_DATA
// variables the Client must provide to every stdio subprocess (§4).
export function buildRuntimeEnv(hostEnv, { pluginData, pluginRoot, overlay = {} }) {
  const env = sanitizeBaseEnv(hostEnv);
  for (const [key, value] of Object.entries(overlay)) {
    env[key] = String(value)
      .split("${PLUGIN_DATA}")
      .join(pluginData)
      .split("${PLUGIN_ROOT}")
      .join(pluginRoot);
  }
  env.PLUGIN_ROOT = pluginRoot;
  env.PLUGIN_DATA = pluginData;
  return env;
}

// §25 tool authorization decision.
export function authorizeTool(tool, granted) {
  const required = TOOL_PERMISSIONS[tool];
  if (!required) {
    return { tool, allowed: false, missing: [], code: "BROWSER_USE_TOOL_UNAVAILABLE" };
  }
  const have = new Set(Array.isArray(granted) ? granted : [granted]);
  const missing = required.filter((perm) => !have.has(perm));
  return {
    tool,
    allowed: missing.length === 0,
    missing,
    code: missing.length === 0 ? null : "BROWSER_USE_PERMISSION_DENIED",
  };
}

// §56 reject oversized browser_exec code before it reaches the runtime.
export function checkCodeInput(code) {
  const bytes = Buffer.byteLength(String(code), "utf8");
  return {
    ok: bytes <= LIMITS.codeInputBytes,
    bytes,
    limit: LIMITS.codeInputBytes,
    code: bytes <= LIMITS.codeInputBytes ? null : "BROWSER_USE_INPUT_TOO_LARGE",
  };
}

// §57/§89 bound textual output: bounded truncation, never an unbounded pass-through.
export function boundTextOutput(text) {
  const buf = Buffer.from(String(text), "utf8");
  if (buf.length <= LIMITS.textOutputBytes) {
    return { truncated: false, bytes: buf.length, limit: LIMITS.textOutputBytes, text: String(text) };
  }
  // Cut at the byte limit, then drop a possibly partial trailing UTF-8 sequence.
  const cut = buf.subarray(0, LIMITS.textOutputBytes).toString("utf8");
  return {
    truncated: true,
    bytes: buf.length,
    limit: LIMITS.textOutputBytes,
    text: cut,
    note: "BROWSER_USE_RESULT_TOO_LARGE: output truncated; re-filter/aggregate/summarize",
  };
}

// §57/§89 bound screenshot payloads.
export function boundImageOutput(bytes) {
  const size = typeof bytes === "number" ? bytes : Buffer.byteLength(bytes);
  return {
    ok: size <= LIMITS.imageOutputBytes,
    bytes: size,
    limit: LIMITS.imageOutputBytes,
    code: size <= LIMITS.imageOutputBytes ? null : "BROWSER_USE_RESULT_TOO_LARGE",
  };
}

// §58/§59/§60 unknown-outcome policy: a possibly-mutating call that ended in
// timeout/disconnect/crash has UNKNOWN outcome; replay is forbidden.
export function decideAfterFailure({ sideEffectPossible, failure }) {
  const transportFailures = ["timeout", "disconnect", "mcp-crash", "chrome-crash"];
  if (sideEffectPossible && transportFailures.includes(failure)) {
    return {
      outcome: "unknown",
      replay: false,
      code: "BROWSER_USE_OUTCOME_UNKNOWN",
      nextStep: ["recover runtime if required", "inspect current page state", "determine whether effect occurred", "then decide next action"],
    };
  }
  return {
    outcome: "known-failed",
    replay: false,
    code: failure === "timeout" ? "BROWSER_USE_TIMEOUT" : "BROWSER_USE_RUNTIME_CRASHED",
    nextStep: ["diagnose from the returned error", "fix the procedure", "retry deliberately"],
  };
}

// §41 quarantine persistent self-modifying helper state before a new independent
// execution context starts. Browser Harness runtime/config state is untouched.
export async function prepareExecutionContext(pluginData) {
  const workspace = join(pluginData, "agent-workspace");
  await mkdir(workspace, { recursive: true });
  const helperPath = join(workspace, "agent_helpers.py");
  let quarantined = null;
  if (existsSync(helperPath)) {
    const quarantineDir = join(pluginData, "quarantine");
    await mkdir(quarantineDir, { recursive: true });
    quarantined = join(quarantineDir, `${Date.now()}-${process.pid}-agent_helpers.py`);
    await rename(helperPath, quarantined);
  }
  return { workspace, quarantined };
}

// §39/§87 single-flight gate: one logical browser task per MCP runtime; a second
// independent task queues (default) or fails with BROWSER_USE_BUSY; never interleaves.
export function createBrowserRuntimeGate({ mode = "queue" } = {}) {
  let running = false;
  const queue = [];
  return {
    submit(taskId, fn) {
      if (running) {
        if (mode === "busy") {
          return Promise.reject(policyError("BROWSER_USE_BUSY", `browser runtime busy (task in flight): ${taskId}`));
        }
        return new Promise((resolve, reject) => queue.push({ fn, resolve, reject }));
      }
      return run(fn);
    },
    get pending() {
      return queue.length;
    },
  };

  async function run(fn) {
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
      const next = queue.shift();
      if (next) run(next.fn).then(next.resolve, next.reject);
    }
  }
}
