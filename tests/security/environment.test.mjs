// §17/§18/§78 Environment Tests — PLUGIN_DATA containment, telemetry/recordings/
// domain-skills/tab-marker defaults, and the sanitized runtime environment builder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRuntimeEnv, REQUIRED_DISABLED_ENV } from "../helpers/hostPolicy.mjs";
import { loadMcpConfig, resolveTemplate } from "../helpers/runtime.mjs";

test("all Browser Harness mutable state is contained in PLUGIN_DATA (§17/§18)", () => {
  const env = loadMcpConfig().mcpServers["browser-use"].env;
  assert.equal(env.BH_HOME, "${PLUGIN_DATA}/browser-harness", "BH_HOME overridden out of the user's harness config area");
  assert.equal(env.BH_AGENT_WORKSPACE, "${PLUGIN_DATA}/agent-workspace");
  assert.equal(loadMcpConfig().mcpServers["browser-use"].cwd, "${PLUGIN_DATA}");
});

test("no mutable runtime state points into PLUGIN_ROOT (§18: package stays immutable)", () => {
  const server = loadMcpConfig().mcpServers["browser-use"];
  for (const [key, value] of Object.entries(server.env)) {
    assert.ok(
      !String(value).includes("${PLUGIN_ROOT}"),
      `env ${key} must not write runtime state into the immutable package`,
    );
  }
  assert.ok(!String(server.cwd).includes("${PLUGIN_ROOT}"), "cwd must live under PLUGIN_DATA");
});

test("telemetry, recordings, domain skills, tab marker, cloud sync are disabled by default (§19-§22/§64/§78)", () => {
  const env = loadMcpConfig().mcpServers["browser-use"].env;
  assert.deepEqual(
    {
      BH_TELEMETRY: env.BH_TELEMETRY,
      BROWSER_HARNESS_TELEMETRY: env.BROWSER_HARNESS_TELEMETRY,
      ANONYMIZED_TELEMETRY: env.ANONYMIZED_TELEMETRY,
      BROWSER_USE_CLOUD_SYNC: env.BROWSER_USE_CLOUD_SYNC,
      BH_RECORD: env.BH_RECORD,
      BH_DOMAIN_SKILLS: env.BH_DOMAIN_SKILLS,
      BH_TAB_MARKER: env.BH_TAB_MARKER,
    },
    { ...REQUIRED_DISABLED_ENV },
  );
});

test("${PLUGIN_DATA} templates resolve to real paths inside the data dir", async () => {
  const pluginData = await mkdtemp(join(tmpdir(), "bu-env-test-"));
  const server = loadMcpConfig().mcpServers["browser-use"];
  const bhHome = resolveTemplate(server.env.BH_HOME, { pluginData, pluginRoot: "/pkg" });
  assert.ok(bhHome.startsWith(pluginData), "resolved BH_HOME lives under PLUGIN_DATA");
  assert.ok(resolveTemplate(server.cwd, { pluginData, pluginRoot: "/pkg" }) === pluginData);
});

test("buildRuntimeEnv produces the full host-side launch environment (§4/§28)", async () => {
  const pluginData = await mkdtemp(join(tmpdir(), "bu-env-test-"));
  const server = loadMcpConfig().mcpServers["browser-use"];
  const env = buildRuntimeEnv({ PATH: "/bin" }, {
    pluginData,
    pluginRoot: "/pkg-root",
    overlay: server.env,
  });
  assert.equal(env.BH_HOME, `${pluginData}/browser-harness`, "overlay template expanded against PLUGIN_DATA");
  assert.equal(env.PLUGIN_ROOT, "/pkg-root", "client provides PLUGIN_ROOT to the subprocess");
  assert.equal(env.PLUGIN_DATA, pluginData, "client provides PLUGIN_DATA to the subprocess");
  assert.equal(env.PATH, "/bin", "sanitized base env is preserved under the overlay");
});
