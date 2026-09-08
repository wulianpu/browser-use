// §69/§70/§80 MCP Integration Tests — the real runtime over stdio:
// initialize → tools/list → contract snapshot → shutdown. No mocks.
// Passive only: this test never calls browser_exec, so it never opens Chrome (§34).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadUpstreamLock, repoRoot, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

const REQUIRED_TOOLS = ["browser_exec", "browser_screenshot"];

test("real runtime: initialize, tools/list, both tools present (§80)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  const runtime = await startRuntime();
  try {
    assert.equal(runtime.client.serverInfo?.name, "browser-use");
    assert.equal(runtime.client.serverInfo?.version, loadUpstreamLock().browserUse.version, "served runtime is the pinned one");
    const names = runtime.tools.map((tool) => tool.name);
    for (const tool of REQUIRED_TOOLS) {
      assert.ok(names.includes(tool), `tools/list must expose ${tool}`);
    }
  } finally {
    const exit = await runtime.client.stop();
    assert.notEqual(exit?.code, null, "graceful shutdown expected");
  }
});

test("tool schemas match the reviewed contract snapshot (§70)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  const runtime = await startRuntime();
  try {
    const snapshot = JSON.parse(readFileSync(join(repoRoot, "tests", "mcp", "contract-snapshot.json"), "utf8"));
    const live = Object.fromEntries(runtime.tools.map((tool) => [tool.name, tool]));

    assert.deepEqual(
      Object.keys(live).sort(),
      snapshot.tools.map((tool) => tool.name).sort(),
      "tool set must exactly match the snapshot — upstream drift is a release-gate failure",
    );

    const exec = live.browser_exec.inputSchema;
    assert.equal(exec.type, "object");
    assert.deepEqual(exec.required, ["code"], "browser_exec requires code:string (§70)");
    assert.equal(exec.properties.code.type, "string");

    const shot = live.browser_screenshot.inputSchema;
    assert.equal(shot.type, "object");
    assert.equal(shot.properties.full?.type, "boolean", "optional full:boolean");
    assert.equal(shot.properties.max_dim?.type, "integer", "optional max_dim:integer");
    assert.equal(shot.required, undefined, "screenshot has no required fields");
  } finally {
    await runtime.client.stop();
  }
});
