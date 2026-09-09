// §40/§41/§85 Workspace Sanitation Tests — cross-task executable/config state
// (agent_helpers.py and the harness-loaded .env overlay) is removed before a
// new independent execution context, with untrusted-filesystem guards:
// symlinks are never followed, shared inodes are never quarantined readable,
// and .env content is never retained anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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

async function makeWorkspace(pluginData) {
  await mkdir(join(pluginData, "agent-workspace"), { recursive: true });
  return join(pluginData, "agent-workspace");
}

async function trySymlink(target, path) {
  try {
    await symlink(target, path);
    return true;
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EINVAL") return false; // Windows without symlink privilege
    throw error;
  }
}

test("a regular leftover agent_helpers.py is quarantined, harness state untouched (§41)", async () => {
  const pluginData = await makePluginData();
  const workspace = await makeWorkspace(pluginData);
  await writeFile(join(workspace, "agent_helpers.py"), "def task_a_leftover():\n    pass\n");

  const context = await prepareExecutionContext(pluginData);

  assert.equal(context.quarantined.length, 1);
  assert.ok(!existsSync(join(workspace, "agent_helpers.py")));
  assert.ok(context.quarantined[0].startsWith(join(pluginData, "quarantine")));
  assert.equal(await readFile(context.quarantined[0], "utf8"), "def task_a_leftover():\n    pass\n", "content preserved for review");
  assert.equal(
    await readFile(join(pluginData, "browser-harness", "runtime", "state.json"), "utf8"),
    '{"ok":true}',
    "harness runtime/config state is not affected",
  );
});

test("a regular leftover .env is unlinked with metadata only — content never retained (§41)", async () => {
  const pluginData = await makePluginData();
  const workspace = await makeWorkspace(pluginData);
  await writeFile(join(workspace, ".env"), "BU_CDP_URL=http://task-a-endpoint:9222\nSECRET_TOKEN=fake\n");

  const context = await prepareExecutionContext(pluginData);

  assert.ok(!existsSync(join(workspace, ".env")));
  assert.deepEqual(context.quarantined, []);
  assert.equal(context.removed.length, 1);
  assert.equal(context.removed[0].original, ".env");
  assert.equal(context.removed[0].kind, "regular");
  const recordRaw = await readFile(context.removed[0].recordPath, "utf8");
  assert.ok(!recordRaw.includes("task-a-endpoint"), "no plaintext env content in the record");
  assert.ok(!recordRaw.includes("fake"), "no credential values in the record");
  assert.ok(existsSync(join(pluginData, "browser-harness", "runtime", "state.json")));
});

test("a symlinked .env is unlinked without following — the target survives intact", async () => {
  const pluginData = await makePluginData();
  const workspace = await makeWorkspace(pluginData);
  const outsideDir = await mkdtemp(join(tmpdir(), "bu-outside-"));
  const target = join(outsideDir, "important.txt");
  await writeFile(target, "do not touch me");
  const created = await trySymlink(target, join(workspace, ".env"));
  if (!created) {
    return; // symlink privilege unavailable (unprivileged Windows)
  }

  const context = await prepareExecutionContext(pluginData);

  assert.ok(!existsSync(join(workspace, ".env")), "the link is gone");
  assert.equal(await readFile(target, "utf8"), "do not touch me", "the symlink target must never be written through");
  assert.equal(context.removed[0].kind, "symlink");
});

test("a hardlinked .env is unlinked only — the sibling link survives untouched", async () => {
  const pluginData = await makePluginData();
  const workspace = await makeWorkspace(pluginData);
  const original = join(pluginData, "outside-secret.env");
  await writeFile(original, "shared inode secret");
  await link(original, join(workspace, ".env"));

  const context = await prepareExecutionContext(pluginData);

  assert.ok(!existsSync(join(workspace, ".env")));
  assert.equal(await readFile(original, "utf8"), "shared inode secret", "the shared inode is not zeroed or damaged");
  assert.equal(context.removed[0].kind, "shared-inode");
});

test("a symlinked agent_helpers.py never enters readable quarantine", async () => {
  const pluginData = await makePluginData();
  const workspace = await makeWorkspace(pluginData);
  const outsideDir = await mkdtemp(join(tmpdir(), "bu-outside-"));
  const target = join(outsideDir, "sensitive.py");
  await writeFile(target, "SECRET = 'external sensitive content'");
  const created = await trySymlink(target, join(workspace, "agent_helpers.py"));
  if (!created) {
    return; // symlink privilege unavailable (unprivileged Windows)
  }

  const context = await prepareExecutionContext(pluginData);

  assert.deepEqual(context.quarantined, [], "a symlink is never quarantined where diagnostics could follow it");
  assert.equal(context.removed[0].original, "agent_helpers.py");
  assert.equal(context.removed[0].kind, "symlink");
  assert.ok(!existsSync(join(workspace, "agent_helpers.py")));
  assert.equal(await readFile(target, "utf8"), "SECRET = 'external sensitive content'", "target untouched");
});

test("regular helpers quarantined and .env removed in one pass", async () => {
  const pluginData = await makePluginData();
  const workspace = await makeWorkspace(pluginData);
  await writeFile(join(workspace, "agent_helpers.py"), "x = 1\n");
  await writeFile(join(workspace, ".env"), "BU_NAME=task-a\n");

  const context = await prepareExecutionContext(pluginData);

  assert.equal(context.quarantined.length, 1);
  assert.equal(context.removed.length, 1);
  assert.ok(!existsSync(join(workspace, "agent_helpers.py")));
  assert.ok(!existsSync(join(workspace, ".env")));
});

test("clean PLUGIN_DATA: nothing quarantined or removed, workspace ensured (§18 layout)", async () => {
  const pluginData = await makePluginData();
  const context = await prepareExecutionContext(pluginData);
  assert.deepEqual(context.quarantined, []);
  assert.deepEqual(context.removed, []);
  assert.ok(existsSync(join(pluginData, "agent-workspace")));
});

test("repeated preparation is idempotent and never deletes harness state", async () => {
  const pluginData = await makePluginData();
  await prepareExecutionContext(pluginData);
  const second = await prepareExecutionContext(pluginData);
  assert.deepEqual(second.quarantined, []);
  assert.deepEqual(second.removed, []);
  assert.ok(existsSync(join(pluginData, "browser-harness", "runtime", "state.json")));
});
