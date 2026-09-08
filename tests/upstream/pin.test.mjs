// §13/§15/§77 Pin Tests — reproducible runtime identity, no @latest, lock consistency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMcpConfig, loadPluginManifest, loadUpstreamLock, repoRoot } from "../helpers/runtime.mjs";

const LOCKED_VERSION = "0.13.10";

test("mcp.json pins the exact reviewed Browser Use runtime (§10/§13)", () => {
  const args = loadMcpConfig().mcpServers["browser-use"].args;
  assert.deepEqual(
    args,
    ["--python", "3.12", `browser-use@${LOCKED_VERSION}`, "--cli-mcp"],
    "runtime launch line is frozen: uvx --python 3.12 browser-use@<pin> --cli-mcp",
  );
});

test("@latest is forbidden anywhere in the runtime artifacts (§13)", () => {
  const serialized = JSON.stringify(loadMcpConfig()) + JSON.stringify(loadPluginManifest());
  assert.ok(!/@latest/.test(serialized), "@latest would make PluginRevision non-reproducible");
});

test("mcp.json pin, upstream.lock version, and Python pin are consistent (§77)", () => {
  const lock = loadUpstreamLock();
  const args = loadMcpConfig().mcpServers["browser-use"].args;
  assert.equal(lock.browserUse.package, "browser-use");
  assert.equal(lock.browserUse.version, LOCKED_VERSION);
  assert.ok(args.includes(`browser-use@${lock.browserUse.version}`), "mcp.json pin == upstream.lock version");
  assert.equal(lock.browserHarness.version, "0.1.13", "Browser Harness baseline from §10");
});

test("upstream.lock.json records full provenance identities (§15)", () => {
  const lock = loadUpstreamLock();
  assert.equal(lock.agentPlugins.specVersion, "1.0.0");
  assert.equal(lock.agentPlugins.specVersion, loadPluginManifest().$schema.match(/schemas\/(\d+\.\d+\.\d+)\//)[1]);
  assert.match(lock.browserUse.pyprojectBlobSha, /^[0-9a-f]{40}$/, "pyproject blob sha is a git blob SHA");
  assert.match(lock.officialPlugin.blobSha, /^[0-9a-f]{40}$/);
  assert.match(lock.officialSkill.blobSha, /^[0-9a-f]{40}$/);
  assert.equal(lock.officialPlugin.repository, "browser-use/plugins");
  assert.equal(lock.officialPlugin.path, "browser-use/.mcp.json");
  assert.equal(lock.officialSkill.repository, "browser-use/browser-use");
  assert.equal(lock.officialSkill.path, "skills/browser-use/SKILL.md");
});

test("upstream.lock.json is a provenance artifact only — not referenced by discovery (§16)", () => {
  const manifest = loadPluginManifest();
  const serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes("upstream.lock"), "plugin.json must not depend on upstream.lock.json");
});
