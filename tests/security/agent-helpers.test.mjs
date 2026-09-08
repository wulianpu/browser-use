// §40/§41/§85 Persistent Helper Tests — cross-task executable/config state
// (agent_helpers.py and the harness-loaded .env overlay) is quarantined before
// a new independent execution context; Browser Harness runtime state is
// untouched.

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

  assert.equal(context.quarantined.length, 1);
  assert.ok(!existsSync(helperPath), "agent_helpers.py no longer executable state");
  assert.ok(context.quarantined[0].startsWith(join(pluginData, "quarantine")), "quarantine stays inside PLUGIN_DATA");
  assert.equal(await readFile(context.quarantined[0], "utf8"), "def task_a_leftover():\n    pass\n", "content preserved for review");
  assert.equal(
    await readFile(join(pluginData, "browser-harness", "runtime", "state.json"), "utf8"),
    '{"ok":true}',
    "harness runtime/config state is not affected",
  );
});

test("a leftover agent-workspace/.env is securely deleted — never retained (§40/§41, credentials)", async () => {
  const pluginData = await makePluginData();
  await mkdir(join(pluginData, "agent-workspace"), { recursive: true });
  const envPath = join(pluginData, "agent-workspace", ".env");
  await writeFile(envPath, "BU_CDP_URL=http://task-a-endpoint:9222\nSECRET_TOKEN=fake\n");

  const context = await prepareExecutionContext(pluginData);

  assert.ok(!existsSync(envPath), "harness env overlay cannot persist across tasks");
  assert.equal(context.quarantined.length, 0, ".env content is not quarantined-retained");
  assert.ok(context.removedEnv, "removal metadata recorded");
  const metadata = JSON.parse(await readFile(context.removedEnv, "utf8"));
  assert.equal(metadata.original, ".env");
  assert.equal(metadata.originalBytes > 0, true);
  const metadataRaw = await readFile(context.removedEnv, "utf8");
  assert.ok(!metadataRaw.includes("task-a-endpoint"), "no plaintext env content in metadata");
  assert.ok(!metadataRaw.includes("fake"), "no credential values in metadata");
  assert.ok(existsSync(join(pluginData, "browser-harness", "runtime", "state.json")), "harness state untouched");
});

test("both leftovers handled in one pass: helpers quarantined, .env deleted", async () => {
  const pluginData = await makePluginData();
  const workspace = join(pluginData, "agent-workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "agent_helpers.py"), "x = 1\n");
  await writeFile(join(workspace, ".env"), "BU_NAME=task-a\n");

  const context = await prepareExecutionContext(pluginData);

  assert.equal(context.quarantined.length, 1);
  assert.ok(context.removedEnv);
  assert.ok(!existsSync(join(workspace, "agent_helpers.py")));
  assert.ok(!existsSync(join(workspace, ".env")));
});

test("clean PLUGIN_DATA: no quarantine, workspace ensured (§18 layout)", async () => {
  const pluginData = await makePluginData();
  const context = await prepareExecutionContext(pluginData);
  assert.deepEqual(context.quarantined, []);
  assert.equal(context.removedEnv, null, "nothing removed on a clean workspace");
  assert.ok(existsSync(join(pluginData, "agent-workspace")), "agent-workspace exists per §18 layout");
});

test("repeated preparation is idempotent and never deletes user state", async () => {
  const pluginData = await makePluginData();
  await prepareExecutionContext(pluginData);
  const second = await prepareExecutionContext(pluginData);
  assert.deepEqual(second.quarantined, []);
  assert.ok(existsSync(join(pluginData, "browser-harness", "runtime", "state.json")));
});
