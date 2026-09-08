// Composition tests for the reference host wrapper (review item 11): verify
// that the chained policies actually compose — in the right order, with the
// right interactions — using a scripted fake MCP transport. The real runtime
// surface is covered separately by tests/mcp/contract.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReferenceHostRuntime } from "../helpers/referenceHostRuntime.mjs";

const MiB = 1024 * 1024;

function makeFakeTransport({ respond } = {}) {
  const transport = {
    callLog: [],
    stopped: 0,
    async callTool(name, args, timeoutMs) {
      transport.callLog.push({ name, args, timeoutMs });
      return respond(name, args, timeoutMs, transport.callLog.length);
    },
    async stop() {
      transport.stopped += 1;
    },
  };
  return transport;
}

function hostWith(transport, options = {}) {
  return createReferenceHostRuntime({
    transportFactory: async () => transport,
    ...options,
  });
}

test("denied exec never reaches the transport — permission precedes dispatch (§25)", async () => {
  const transport = makeFakeTransport({ respond: () => ({ content: [] }) });
  const host = hostWith(transport, { granted: ["browser.observe"] });
  await assert.rejects(
    host.withTask("t1", (task) => task.exec("print(1)")),
    (error) => error.code === "BROWSER_USE_PERMISSION_DENIED",
  );
  assert.equal(transport.callLog.length, 0, "no MCP call may be dispatched without authorization");
  assert.equal(transport.stopped, 1, "transport still recycled after the failed task");
});

test("oversized code is rejected before dispatch with INPUT_TOO_LARGE (§56)", async () => {
  const transport = makeFakeTransport({ respond: () => ({ content: [] }) });
  const host = hostWith(transport);
  await assert.rejects(
    host.withTask("t1", (task) => task.exec("# x\n".repeat(40_000))),
    (error) => error.code === "BROWSER_USE_INPUT_TOO_LARGE",
  );
  assert.equal(transport.callLog.length, 0);
});

test("timeout on a possibly-mutating exec → OUTCOME_UNKNOWN, exactly one dispatch, never replayed (§58)", async () => {
  const transport = makeFakeTransport({
    respond: (name, args, timeoutMs) => new Promise((resolve, reject) => {
      // Simulate the MCP transport timing out after a click was already sent.
      setTimeout(() => reject(new Error(`MCP request "tools/call" timed out after ${timeoutMs} ms`)), 10);
    }),
  });
  const hostFast = createReferenceHostRuntime({
    transportFactory: async () => transport,
    timeouts: { browser_exec: 5, browser_screenshot: 30_000 },
  });

  const result = await hostFast.withTask("t1", async (task) =>
    task.exec("click_at_xy(10, 10)", { sideEffectPossible: true }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "BROWSER_USE_OUTCOME_UNKNOWN");
  assert.equal(result.outcome, "unknown");
  assert.equal(result.replay, false);
  assert.ok(result.nextStep.join(" ").includes("inspect"));
  assert.equal(transport.callLog.length, 1, "the wrapper never auto-resubmits the same code");
});

test("oversized textual output is truncated once, valid UTF-8, within budget (§57/§89)", async () => {
  const payload = "你".repeat(700_000); // 2.1 MB of 3-byte characters
  const transport = makeFakeTransport({
    respond: () => ({ content: [{ type: "text", text: payload }] }),
  });
  const host = hostWith(transport);
  const result = await host.withTask("t1", (task) => task.exec("print(big)"));
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.code, "BROWSER_USE_RESULT_TOO_LARGE");
  assert.ok(!result.text.includes("\uFFFD"), "no replacement characters from mid-character cuts");
  assert.ok(Buffer.byteLength(result.text, "utf8") <= 1 * MiB, "delivered text respects the byte budget");
});

test("one transport per task; tasks never share and always recycle (§37/§38)", async () => {
  const created = [];
  const host = createReferenceHostRuntime({
    transportFactory: async (taskId) => {
      const transport = makeFakeTransport({
        respond: () => ({ content: [{ type: "text", text: `task:${taskId}` }] }),
      });
      created.push({ taskId, transport });
      return transport;
    },
  });
  const order = [];
  await host.withTask("A", async (task) => {
    order.push("A");
    const a = await task.exec("print(1)");
    assert.ok(a.text.includes("task:A"));
  });
  await host.withTask("B", async (task) => {
    order.push("B");
    const b = await task.exec("print(2)");
    assert.ok(b.text.includes("task:B"));
  });
  assert.deepEqual(order, ["A", "B"]);
  assert.equal(created.length, 2, "each logical task gets a fresh MCP process");
  assert.equal(created[0].transport.stopped, 1, "task A's process was recycled at the boundary");
  assert.equal(created[1].transport.stopped, 1);
});

test("concurrent tasks queue through the wrapper and never interleave (§39/§87)", async () => {
  const created = [];
  const host = createReferenceHostRuntime({
    transportFactory: async (taskId) => {
      const transport = makeFakeTransport({
        respond: () => ({ content: [{ type: "text", text: taskId }] }),
      });
      created.push({ taskId, transport });
      return transport;
    },
  });
  const events = [];
  const taskA = host.withTask("A", async () => {
    events.push("A:start");
    await new Promise((resolve) => setTimeout(resolve, 50));
    events.push("A:end");
  });
  const taskB = host.withTask("B", async () => {
    events.push("B:start");
    events.push("B:end");
  });
  await Promise.all([taskA, taskB]);
  assert.deepEqual(events, ["A:start", "A:end", "B:start", "B:end"]);
  assert.equal(created.length, 2, "queued task B still received its own fresh process");
});

test("the audit trail records tool calls without payloads (§73 logging policy)", async () => {
  const transport = makeFakeTransport({ respond: () => ({ content: [{ type: "text", text: "ok" }] }) });
  const host = hostWith(transport);
  await host.withTask("t1", async (task) => {
    await task.exec("print('sensitive-code-payload')");
  });
  assert.deepEqual(host.calls, [{ task: "t1", tool: "browser_exec" }]);
  assert.ok(!JSON.stringify(host.calls).includes("sensitive"), "no code payloads in the audit trail");
});
