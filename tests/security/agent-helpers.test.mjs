// §40/§41/§85 Persistent Helper Tests — agent_helpers.py and other unapproved
// executable helper state is quarantined before a new independent execution
// context; Browser Harness runtime state is untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExecutionContext } from "../helpers/hostPolicy.mjs";

async function makePluginData() {
  const pluginData = await mkdtemp(join(tmpdir(), "bu-helpers-"));
  await mkdir(join(pluginData, "browser-harness", "runtime"), { recursive: true });
  await writeFile(join(pluginData, "browser-harness", "runtime", "state.json"), '{"ok":true}');
  return pluginData;
}

test("a leftover agent_helpers.py is quarantined, harness state untouched (§41)", async () => {
  const pluginData = await makePluginData();
  const helperPath = join(pluginData, "agent-workspace", "agent_helpers.py");
  await mkdir(join(pluginData, "agent-workspace"), { recursive: true });
  await writeFile(helperPath, "def task_a_leftover():\n    pass\n");

  const context = await prepareExecutionContext(pluginData);

  assert.ok(context.quarantined, "quarantine path returned");
  assert.ok(!existsSync(helperPath), "agent_helpers.py no longer executable state");
  assert.ok(context.quarantined.startsWith(join(pluginData, "quarantine")), "quarantine stays inside PLUGIN_DATA");
  assert.equal(await readFile(context.quarantined, "utf8"), "def task_a_leftover():\n    pass\n", "content preserved for review");
  assert.equal(
    await readFile(join(pluginData, "browser-harness", "runtime", "state.json"), "utf8"),
    '{"ok":true}',
    "harness runtime/config state is not affected",
  );
});

test("clean PLUGIN_DATA: no quarantine, workspace ensured (§18 layout)", async () => {
  const pluginData = await makePluginData();
  const context = await prepareExecutionContext(pluginData);
  assert.equal(context.quarantined, null);
  assert.ok(existsSync(join(pluginData, "agent-workspace")), "agent-workspace exists per §18 layout");
});

test("repeated preparation is idempotent and never deletes user state", async () => {
  const pluginData = await makePluginData();
  await prepareExecutionContext(pluginData);
  const second = await prepareExecutionContext(pluginData);
  assert.equal(second.quarantined, null);
  assert.ok(existsSync(join(pluginData, "browser-harness", "runtime", "state.json")));
});
