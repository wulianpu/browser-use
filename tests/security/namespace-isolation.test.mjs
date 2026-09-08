// §36/§37/§38/§86 Namespace Isolation Tests — the browser_exec Python namespace
// persists within one task/MCP process and must NOT leak into the next
// independent execution context (fresh MCP process per task).
//
// Requires BROWSER_USE_BROWSER_TESTS=1: browser_exec may start the harness
// daemon and attach/launch Chrome (§35).

import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

function textContent(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

test("task state persists within one MCP process, not across processes (§86)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  if (!RUNTIME_GATES.browserTests) {
    t.skip("BROWSER_USE_BROWSER_TESTS=1 required — browser_exec may start the harness daemon/Chrome");
    return;
  }

  // Task A: dedicated MCP runtime, defines secret task state.
  const taskA = await startRuntime();
  try {
    await taskA.client.callTool("browser_exec", { code: 'secret_task_state = "A"' });
    const inTaskA = textContent(
      await taskA.client.callTool("browser_exec", { code: 'print("secret_task_state" in globals())' }),
    );
    assert.ok(inTaskA.includes("True"), "namespace persists across calls within the task (§38)");
  } finally {
    await taskA.client.stop(); // task-boundary recycle (§37)
  }

  // Task B: fresh, independent MCP runtime.
  const taskB = await startRuntime();
  try {
    const inTaskB = textContent(
      await taskB.client.callTool("browser_exec", { code: 'print("secret_task_state" not in globals())' }),
    );
    assert.ok(inTaskB.includes("True"), "task B's fresh process must not inherit task A's namespace");
  } finally {
    await taskB.client.stop();
  }
});
