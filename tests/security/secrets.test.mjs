// §28/§29/§79 Secret Isolation Tests — host secrets must not be visible to the
// plugin subprocess. Static part always runs; the live-runtime part requires
// BROWSER_USE_BROWSER_TESTS=1 because browser_exec may start the harness daemon.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRuntimeEnv, isSecretLikeKey, KNOWN_SECRET_KEYS } from "../helpers/hostPolicy.mjs";
import { loadMcpConfig, RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

const execFileAsync = promisify(execFile);

const FAKE_HOST_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  SystemRoot: process.env.SystemRoot,
  OPENAI_API_KEY: "fake-secret-openai",
  ANTHROPIC_API_KEY: "fake-secret-anthropic",
  GOOGLE_API_KEY: "fake-secret-google",
  AWS_ACCESS_KEY_ID: "fake-secret-aws-id",
  AWS_SECRET_ACCESS_KEY: "fake-secret-aws-key",
  GITHUB_TOKEN: "fake-secret-github",
  DATABASE_URL: "postgres://fake-secret-db",
  INTERNAL_SERVICE_TOKEN: "fake-secret-internal",
};

test("sanitizeBaseEnv drops every known host secret (§29)", () => {
  const env = buildRuntimeEnv(FAKE_HOST_ENV, { pluginData: "/data", pluginRoot: "/pkg", overlay: {} });
  for (const key of KNOWN_SECRET_KEYS) {
    assert.ok(!(key in env), `${key} must not be inherited`);
  }
  assert.ok(!("INTERNAL_SERVICE_TOKEN" in env), "generic *_TOKEN secrets must not be inherited");
  assert.equal(env.PATH, FAKE_HOST_ENV.PATH, "functional allowlisted keys survive");
});

test("the mcp.json overlay introduces no secret-bearing keys", () => {
  const overlay = loadMcpConfig().mcpServers["browser-use"].env;
  const secretLike = Object.keys(overlay).filter((key) => isSecretLikeKey(key));
  assert.deepEqual(secretLike, [], "overlay env must contain only harness configuration");
  for (const [key, value] of Object.entries(overlay)) {
    const templates = String(value).match(/\$\{[^}]+\}/g) ?? [];
    for (const template of templates) {
      assert.ok(
        template === "${PLUGIN_DATA}" || template === "${PLUGIN_ROOT}",
        `${key} may only template PLUGIN_DATA/PLUGIN_ROOT, found ${template}`,
      );
    }
  }
});

test("secrets are not visible inside a real sanitized subprocess (§79)", async () => {
  const env = buildRuntimeEnv(FAKE_HOST_ENV, { pluginData: "/data", pluginRoot: "/pkg", overlay: {} });
  const { stdout } = await execFileAsync(
    process.execPath,
    ["-e", "console.log(JSON.stringify(process.env))"],
    { env, windowsHide: true },
  );
  const childEnv = JSON.parse(stdout);
  const leaked = Object.keys(childEnv).filter(
    (key) => key.includes("SECRET") || key.endsWith("_TOKEN") || key.endsWith("_API_KEY") || key === "DATABASE_URL",
  );
  assert.deepEqual(leaked, [], "no secret-bearing keys may exist in the subprocess environment");
});

test("secrets are not visible inside the real browser-use MCP process (§79, active)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  if (!RUNTIME_GATES.browserTests) {
    t.skip("BROWSER_USE_BROWSER_TESTS=1 required — browser_exec may start the harness daemon/Chrome");
    return;
  }
  process.env.OPENAI_API_KEY = "fake-secret-openai";
  process.env.GITHUB_TOKEN = "fake-secret-github";
  const runtime = await startRuntime();
  try {
    const result = await runtime.client.callTool("browser_exec", {
      code: [
        "import os, json",
        'keys = ["OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "DATABASE_URL"]',
        "print(json.dumps({k: os.environ.get(k) for k in keys}))",
      ].join("\n"),
    });
    const observed = JSON.parse(textContent(result));
    for (const [key, value] of Object.entries(observed)) {
      assert.equal(value, null, `${key} must not be visible in the MCP process`);
    }
  } finally {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GITHUB_TOKEN;
    await runtime.stop();
  }
});

function textContent(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
