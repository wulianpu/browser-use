// §39/§87 Concurrency Tests — one logical browser task per MCP runtime; a second
// independent task queues or gets BROWSER_USE_BUSY; never interleaves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrowserRuntimeGate } from "../helpers/hostPolicy.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("queue mode: task B waits for task A; execution never interleaves (§39)", async () => {
  const gate = createBrowserRuntimeGate({ mode: "queue" });
  const order = [];
  const releaseA = deferred();

  const taskA = gate.submit("A", async () => {
    order.push("A:start");
    await releaseA.promise;
    order.push("A:end");
    return "a-result";
  });
  await sleep(20); // let A actually start
  const taskB = gate.submit("B", async () => {
    order.push("B:start");
    order.push("B:end");
    return "b-result";
  });
  await sleep(20);
  assert.deepEqual(order, ["A:start"], "B must not run while A holds the runtime");

  releaseA.resolve();
  assert.equal(await taskA, "a-result");
  assert.equal(await taskB, "b-result");
  assert.deepEqual(order, ["A:start", "A:end", "B:start", "B:end"], "strict task ordering, no interleave");
});

test("busy mode: task B fails fast with BROWSER_USE_BUSY (§39)", async () => {
  const gate = createBrowserRuntimeGate({ mode: "busy" });
  const releaseA = deferred();
  const taskA = gate.submit("A", () => releaseA.promise);
  await sleep(20);
  await assert.rejects(
    gate.submit("B", async () => "b"),
    (error) => error.code === "BROWSER_USE_BUSY",
  );
  releaseA.resolve();
  assert.equal(await taskA, undefined);
});

test("failure of the running task still releases the gate for queued tasks (§60 recovery)", async () => {
  const gate = createBrowserRuntimeGate({ mode: "queue" });
  const taskA = gate.submit("A", async () => {
    throw new Error("mcp crashed");
  });
  const taskB = gate.submit("B", async () => "fresh-process-result");
  await assert.rejects(taskA, /mcp crashed/);
  assert.equal(await taskB, "fresh-process-result", "next task gets a clean runtime slot");
});
