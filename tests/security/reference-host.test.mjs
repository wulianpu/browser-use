// Composition tests for the reference host wrapper (review item 11): verify
// that the chained policies actually compose — in the right order, with the
// right interactions — using a scripted fake MCP transport. The real runtime
// surface is covered by tests/mcp/contract.test.mjs and by the real-runtime
// classification test at the bottom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReferenceHostRuntime } from "../helpers/referenceHostRuntime.mjs";
import { RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

const MiB = 1024 * 1024;

function extractSentinels(code) {
  return {
    ok: (code.match(/__BROWSER_USE_EXEC_OK_[0-9a-f]+__/) ?? [])[0],
    err: (code.match(/__BROWSER_USE_EXEC_ERR_[0-9a-f]+__/) ?? [])[0],
  };
}

function makeFakeTransport({ respond } = {}) {
  const transport = {
    callLog: [],
    stopped: 0,
    async callTool(name, args, timeoutMs) {
      transport.callLog.push({ name, args, timeoutMs });
      return respond(name, args, timeoutMs, transport.callLog.length);
    },
    async stop() {
      // Idempotent, like the real McpStdioClient (a stopped process stays stopped).
      if (transport.stopped === 0) transport.stopped += 1;
    },
  };
  return transport;
}

// Simulate the official runtime's behavior for our wrapped code.
function runtimeLikeRespond({ mode = "ok", extra = "" } = {}) {
  return (name, args) => {
    if (name !== "browser_exec") return { content: [] };
    const sentinels = extractSentinels(args.code);
    if (mode === "ok") {
      return { content: [{ type: "text", text: `${extra}${sentinels.ok}` }] };
    }
    if (mode === "user-error") {
      return { content: [{ type: "text", text: `${sentinels.err}\nTraceback (most recent call last):\n  ...\nValueError: boom` }] };
    }
    if (mode === "pre-exec-failure") {
      // What the real runtime returned on this repo's dev machine: a daemon
      // traceback printed as ordinary text, isError false, sentinels absent
      // because the wrapped code never ran.
      return { content: [{ type: "text", text: `${extra}Traceback (most recent call last):\n  ...\nRuntimeError: daemon default didn't come up -- check C:\\\\...\\\\bu-default.log` }] };
    }
    if (mode === "mcp-error") {
      return { isError: true, content: [{ type: "text", text: "protocol error" }] };
    }
    throw new Error(`unknown mode ${mode}`);
  };
}

function hostWith(transport, options = {}) {
  return createReferenceHostRuntime({
    transportFactory: async () => transport,
    ...options,
  });
}

test("denied exec never reaches the transport — permission precedes dispatch (§25)", async () => {
  const transport = makeFakeTransport({ respond: runtimeLikeRespond() });
  const host = hostWith(transport, { granted: ["browser.observe"] });
  await assert.rejects(
    host.withTask("t1", (task) => task.exec("print(1)")),
    (error) => error.code === "BROWSER_USE_PERMISSION_DENIED",
  );
  assert.equal(transport.callLog.length, 0, "no MCP call may be dispatched without authorization");
  assert.equal(transport.stopped, 1, "transport still recycled after the failed task");
});

test("oversized code is rejected before dispatch with INPUT_TOO_LARGE (§56)", async () => {
  const transport = makeFakeTransport({ respond: runtimeLikeRespond() });
  const host = hostWith(transport);
  await assert.rejects(
    host.withTask("t1", (task) => task.exec("# x\n".repeat(40_000))),
    (error) => error.code === "BROWSER_USE_INPUT_TOO_LARGE",
  );
  assert.equal(transport.callLog.length, 0);
});

test("the wrapper preserves the official runtime contract, not a reimplementation", async () => {
  const transport = makeFakeTransport({ respond: runtimeLikeRespond() });
  const host = hostWith(transport);
  await host.withTask("t1", (task) => task.exec("print(page_info())"));
  const sent = transport.callLog[0].args.code;
  assert.match(sent, /exec\(compile\(/, "user code still executes through exec(compile(...))");
  assert.match(sent, /globals\(\), globals\(\)/, "persistent-namespace semantics preserved");
  assert.match(sent, /except BaseException:/, "the wrapper mirrors the runtime's own catch-all");
  assert.ok(extractSentinels(sent).ok && extractSentinels(sent).err, "both sentinels present in the wrapped payload");
});

test("textual failures are classified as failures — never ok:true (review P0)", async () => {
  const cases = ["user-error", "pre-exec-failure", "mcp-error"];
  for (const mode of cases) {
    const transport = makeFakeTransport({ respond: runtimeLikeRespond({ mode }) });
    const host = hostWith(transport);
    const result = await host.withTask(mode, (task) => task.exec("click_at_xy(1, 1)"));
    assert.equal(result.ok, false, `${mode} must not be classified as success`);
    assert.equal(result.code, "BROWSER_USE_EXEC_FAILED", mode);
    assert.equal(result.outcome, "known-failed", mode);
    assert.equal(result.replay, false, mode);
    assert.equal(transport.stopped, 1, `${mode}: a determined failure still recycles the transport at task end`);
  }
});

test("a user-printed fake traceback with the OK sentinel is still a success (no false positives)", async () => {
  const transport = makeFakeTransport({
    respond: runtimeLikeRespond({ mode: "ok", extra: "Traceback (most recent call last):\n  ... (printed by the user's own code)\n" }),
  });
  const host = hostWith(transport);
  const result = await host.withTask("t1", (task) => task.exec("print('Traceback (most recent call last):')"));
  assert.equal(result.ok, true, "unforgeable OK sentinel decides, not traceback-ish text");
  assert.ok(!result.text.includes("__BROWSER_USE_EXEC"), "sentinels are stripped from delivered output");
});

test("determined textual failure keeps the transport usable (unlike timeouts)", async () => {
  const transport = makeFakeTransport({
    respond: (name, args, timeoutMs, callIndex) => {
      const mode = callIndex === 1 ? "user-error" : "ok";
      return runtimeLikeRespond({ mode })(name, args);
    },
  });
  const host = hostWith(transport);
  const outcome = await host.withTask("t1", async (task) => {
    const failure = await task.exec("raise ValueError('boom')");
    assert.equal(failure.ok, false);
    const retry = await task.exec("print('after fix')");
    return { failure, retry };
  });
  assert.equal(outcome.failure.failureClass, "user-code-exception");
  assert.equal(outcome.retry.ok, true, "the same transport serves the deliberate retry");
});

test("timeout poisons the transport: unknown outcome, process stopped, no replay, explicit recovery (§58-§60)", async () => {
  const transport = makeFakeTransport({
    respond: (name, args, timeoutMs) => new Promise((resolve, reject) => {
      // Simulate the MCP transport timing out while the exec keeps running.
      setTimeout(() => reject(new Error(`MCP request "tools/call" timed out after ${timeoutMs} ms`)), 10);
    }),
  });
  const hostFast = createReferenceHostRuntime({
    transportFactory: async () => transport,
    timeouts: { browser_exec: 5, browser_screenshot: 30_000 },
  });

  let recovered;
  const result = await hostFast.withTask("t1", async (task) => {
    const first = await task.exec("click_at_xy(10, 10)"); // read-only or not: treated as mutating
    assert.equal(first.ok, false);
    assert.equal(first.code, "BROWSER_USE_OUTCOME_UNKNOWN");
    assert.equal(first.outcome, "unknown");
    assert.equal(first.replay, false);
    assert.ok(first.nextStep.join(" ").includes("inspect"));
    assert.equal(transport.callLog.length, 1, "the wrapper never auto-resubmits the same code");
    assert.equal(transport.stopped, 1, "the MCP process is stopped immediately (no zombie browser_exec)");

    // The poisoned transport rejects further calls — including screenshots.
    await assert.rejects(task.exec("print(1)"), (error) => error.code === "BROWSER_USE_RUNTIME_CRASHED");
    await assert.rejects(task.screenshot({}), (error) => error.code === "BROWSER_USE_RUNTIME_CRASHED");

    // §59 recovery: explicit fresh process, then inspect state on it.
    await task.recover();
    recovered = task.recycles;
    return first;
  });
  assert.equal(result.outcome, "unknown");
  assert.equal(recovered, 1);
});

test("recovery inspection runs on a fresh transport, not the poisoned one (§59)", async () => {
  const transports = [];
  let failNext = true;
  const factory = async (taskId) => {
    const transport = makeFakeTransport({
      respond: (name, args) => {
        if (failNext) {
          failNext = false;
          return new Promise((resolve, reject) =>
            setTimeout(() => reject(new Error('MCP request "tools/call" timed out after 5 ms')), 5),
          );
        }
        return runtimeLikeRespond({ mode: "ok", extra: "state: form submitted\n" })(name, args);
      },
    });
    transports.push({ taskId, transport });
    return transport;
  };
  const host = createReferenceHostRuntime({
    transportFactory: factory,
    timeouts: { browser_exec: 20, browser_screenshot: 30_000 },
  });

  const summary = await host.withTask("t1", async (task) => {
    const click = await task.exec("click_at_xy(1, 1)");
    if (!click.ok && click.code === "BROWSER_USE_OUTCOME_UNKNOWN") {
      await task.recover(); // fresh MCP process
      const inspection = await task.exec("print(state)");
      return { click, inspection };
    }
    return { click, inspection: null };
  });

  assert.equal(summary.click.outcome, "unknown");
  assert.ok(summary.inspection.text.includes("form submitted"), "page-state inspection succeeds on the fresh process");
  assert.equal(transports.length, 2, "poisoned process replaced by a new one");
  assert.equal(transports[0].transport.stopped, 1);
  assert.equal(transports[1].transport.stopped, 1, "recovered process also recycled at task end");
});

test("oversized textual output is truncated once, valid UTF-8, within budget (§57/§89)", async () => {
  const payload = "你".repeat(700_000); // 2.1 MB of 3-byte characters
  const transport = makeFakeTransport({
    respond: runtimeLikeRespond({ mode: "ok", extra: payload }),
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
        respond: runtimeLikeRespond({ mode: "ok", extra: `task:${taskId}\n` }),
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
        respond: runtimeLikeRespond({ mode: "ok", extra: `${taskId}\n` }),
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
  const transport = makeFakeTransport({ respond: runtimeLikeRespond({ mode: "ok" }) });
  const host = hostWith(transport);
  await host.withTask("t1", async (task) => {
    await task.exec("print('sensitive-code-payload')");
  });
  assert.deepEqual(host.calls, [{ task: "t1", tool: "browser_exec" }]);
  assert.ok(!JSON.stringify(host.calls).includes("sensitive"), "no code payloads in the audit trail");
});

test("real runtime: textual failure classification holds against browser-use@0.13.10", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  if (!RUNTIME_GATES.browserTests) {
    t.skip("BROWSER_USE_BROWSER_TESTS=1 required — browser_exec may start the harness daemon/Chrome");
    return;
  }
  const runtime = await startRuntime();
  const host = createReferenceHostRuntime({
    transportFactory: async () => ({
      callTool: (name, args, timeoutMs) => runtime.client.callTool(name, args, timeoutMs),
      stop: () => Promise.resolve(),
    }),
  });
  try {
    const outcome = await host.withTask("real", async (task) => {
      const healthy = await task.exec("print(1 + 1)");
      const failing = await task.exec("raise ValueError('qualification-boom')");
      return { healthy, failing };
    });
    // Machine-dependent but each side must be classified exactly right:
    // with an attachable browser the first succeeds; without one (dev machine)
    // BOTH come back as pre-exec daemon failures. Never ok:true for a traceback.
    for (const result of [outcome.healthy, outcome.failing]) {
      assert.ok(result.ok === true || result.code === "BROWSER_USE_EXEC_FAILED", "no third state exists");
    }
    assert.equal(outcome.failing.ok, false, "a raising exec is never a success");
    assert.equal(outcome.failing.code, "BROWSER_USE_EXEC_FAILED");
    assert.ok(["user-code-exception", "pre-exec-runtime-failure"].includes(outcome.failing.failureClass));
    if (outcome.healthy.ok) {
      assert.ok(outcome.healthy.text.includes("2"), "success carries the computed output");
    } else {
      assert.equal(outcome.healthy.failureClass, "pre-exec-runtime-failure", "no attachable runtime on this machine");
    }
  } finally {
    await runtime.client.stop();
  }
});
