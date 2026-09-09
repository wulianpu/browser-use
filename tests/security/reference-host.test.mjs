// Composition tests for the reference host wrapper (review item 11): verify
// that the chained policies actually compose — in the right order, with the
// right interactions — using a scripted fake MCP transport. The real runtime
// surface is covered by tests/mcp/contract.test.mjs and by the real-runtime
// classification test at the bottom.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReferenceHostRuntime } from "../helpers/referenceHostRuntime.mjs";
import { assertAttachableTarget, hasExplicitTarget } from "../helpers/targetPreflight.mjs";
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

test("worst-case JSON escaping within the 128 KiB source bound still passes the wrapped-payload valve (§56)", async () => {
  // Control characters JSON-escape 1 byte -> 6 chars (\u0001); a pathological
  // source near the input bound is the largest possible wrapped payload.
  const pathological = "\x01".repeat(120 * 1024);
  const transport = makeFakeTransport({ respond: runtimeLikeRespond({ mode: "ok" }) });
  const host = hostWith(transport);
  const result = await host.withTask("t1", (task) => task.exec(pathological));
  assert.equal(result.ok, true, "the valve must tolerate worst-case escaping of in-bounds source");
  const wrappedBytes = Buffer.byteLength(transport.callLog[0].args.code, "utf8");
  assert.ok(wrappedBytes > 700 * 1024, "the payload really was escape-inflated");
  assert.ok(wrappedBytes <= 1024 * 1024, "and stayed under the wrapped cap");
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
  assert.match(sent, /__exec\(__compile\(/, "user code still executes through exec(compile(...))");
  assert.match(sent, /__globals, __globals\)/, "persistent-namespace semantics preserved (persistent globals for both scopes)");
  assert.match(sent, /__exec=__bu_b\.exec/, "instrumentation captures builtins at definition time (shadowing-proof)");
  assert.match(sent, /except __base_exception:/, "the wrapper mirrors the runtime's own catch-all");
  assert.ok(extractSentinels(sent).ok && extractSentinels(sent).err, "both sentinels present in the wrapped payload");
});

test("textual failures are classified as failures — never ok:true (review P0)", async () => {
  const expectedOutcome = { "user-error": "unknown-effects", "pre-exec-failure": "known-failed", "mcp-error": "known-failed" };
  for (const mode of Object.keys(expectedOutcome)) {
    const transport = makeFakeTransport({ respond: runtimeLikeRespond({ mode }) });
    const host = hostWith(transport);
    const result = await host.withTask(mode, (task) => task.exec("click_at_xy(1, 1)"));
    assert.equal(result.ok, false, `${mode} must not be classified as success`);
    assert.equal(result.code, "BROWSER_USE_EXEC_FAILED", mode);
    assert.equal(result.outcome, expectedOutcome[mode], mode);
    assert.equal(result.replay, false, mode);
    assert.equal(transport.stopped, 1, `${mode}: a determined failure still recycles the transport at task end`);
  }
});

test("a user-printed fake traceback with the OK sentinel is still a success (collision-resistant)", async () => {
  const transport = makeFakeTransport({
    respond: runtimeLikeRespond({ mode: "ok", extra: "Traceback (most recent call last):\n  ... (printed by the user's own code)\n" }),
  });
  const host = hostWith(transport);
  const result = await host.withTask("t1", (task) => task.exec("print('Traceback (most recent call last):')"));
  assert.equal(result.ok, true, "the per-call OK sentinel decides, not traceback-ish text");
  assert.ok(!result.text.includes("__BROWSER_USE_EXEC"), "sentinels are stripped from delivered output");
});

test("user-code exception after possible side effects → unknown-effects, inspect before retry (review P0)", async () => {
  const transport = makeFakeTransport({
    respond: (name, args, timeoutMs, callIndex) => {
      const mode = callIndex === 1 ? "user-error" : "ok";
      return runtimeLikeRespond({ mode, extra: callIndex === 2 ? "page state: order #4212 already created\n" : "" })(name, args);
    },
  });
  const host = hostWith(transport);
  const outcome = await host.withTask("t1", async (task) => {
    // Submit clicked, page accepted, then the agent's own code raised.
    const failure = await task.exec('click_at_xy(submit_x, submit_y)\nwait_for_load()\nraise ValueError("unexpected page")');
    // Guidance must be inspect-first; the transport is still usable for that.
    const inspection = await task.exec("print(page_state)");
    return { failure, inspection };
  });
  assert.equal(outcome.failure.ok, false);
  assert.equal(outcome.failure.code, "BROWSER_USE_EXEC_FAILED");
  assert.equal(outcome.failure.failureClass, "user-code-exception");
  assert.equal(outcome.failure.outcome, "unknown-effects", "side effects may have happened before the raise");
  assert.equal(outcome.failure.replay, false, "never blind-retry a possibly-mutated call");
  const steps = outcome.failure.nextStep.join(" | ").toLowerCase();
  const inspectIndex = steps.indexOf("inspect");
  const decideIndex = steps.indexOf("only then decide");
  assert.ok(inspectIndex !== -1 && decideIndex > inspectIndex, "inspect comes before deciding");
  assert.ok(!/^retry/.test(outcome.failure.nextStep[0].trim()), "retry is not the first suggested step");
  assert.equal(outcome.inspection.ok, true, "the same transport serves the state inspection");
  assert.ok(outcome.inspection.text.includes("order #4212"), "inspection reveals the already-created order");
});

test("pre-exec failures never ran user code → known-failed, deliberate retry is safe", async () => {
  const transport = makeFakeTransport({
    respond: (name, args, timeoutMs, callIndex) => {
      const mode = callIndex === 1 ? "pre-exec-failure" : "ok";
      return runtimeLikeRespond({ mode })(name, args);
    },
  });
  const host = hostWith(transport);
  const outcome = await host.withTask("t1", async (task) => {
    const failure = await task.exec("print('never runs')");
    const retry = failure.outcome === "known-failed" ? await task.exec("print('after runtime fix')") : null;
    return { failure, retry };
  });
  assert.equal(outcome.failure.failureClass, "pre-exec-runtime-failure");
  assert.equal(outcome.failure.outcome, "known-failed", "user code never started, so no side effects are pending");
  assert.equal(outcome.retry.ok, true, "a diagnosed pre-exec failure may be retried deliberately");
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
  // When a target browser is explicitly named (sentinel follow-up runs),
  // prove the attachable browser IS that target AND that a live
  // process-attributed endpoint exists — a flag without the endpoint (instance
  // not yet Allow-approved) would only yield pre-exec failures, letting the
  // suite go green without proving the OK/ERR paths. Without an explicit
  // target this test is browser-agnostic by design and keeps its
  // machine-dependent leniency (classifier correctness on headless machines).
  if (hasExplicitTarget()) {
    await assertAttachableTarget(RUNTIME_GATES.qualificationBrowser, { requireRunning: true, requireLiveEndpoint: true });
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
    if (hasExplicitTarget()) {
      // Qualification sentinel mode: both paths must be GENUINELY exercised —
      // no pre-exec leniency, or the green run proves nothing about OK/ERR.
      assert.equal(outcome.healthy.ok, true, "qualification sentinel mode: the OK path must really succeed on the live target");
      assert.ok(outcome.healthy.text.includes("2"), "success carries the computed output");
      assert.equal(outcome.failing.ok, false, "a raising exec is never a success");
      assert.equal(outcome.failing.code, "BROWSER_USE_EXEC_FAILED");
      assert.equal(outcome.failing.failureClass, "user-code-exception", "the ERR path must be a genuine user-code exception");
      assert.equal(outcome.failing.outcome, "unknown-effects");
      assert.equal(outcome.failing.replay, false);
    } else {
      // Machine-dependent by design: with an attachable browser the success
      // path runs; without one (headless dev machine) BOTH come back as
      // pre-exec daemon failures. Never ok:true for a traceback either way.
      for (const result of [outcome.healthy, outcome.failing]) {
        assert.ok(result.ok === true || result.code === "BROWSER_USE_EXEC_FAILED", "no third state exists");
      }
      assert.equal(outcome.failing.ok, false, "a raising exec is never a success");
      assert.equal(outcome.failing.code, "BROWSER_USE_EXEC_FAILED");
      assert.ok(["user-code-exception", "pre-exec-runtime-failure"].includes(outcome.failing.failureClass));
      assert.equal(
        outcome.failing.outcome,
        outcome.failing.failureClass === "user-code-exception" ? "unknown-effects" : "known-failed",
      );
      assert.equal(outcome.failing.replay, false);
      if (outcome.healthy.ok) {
        assert.ok(outcome.healthy.text.includes("2"), "success carries the computed output");
      } else {
        assert.equal(outcome.healthy.failureClass, "pre-exec-runtime-failure", "no attachable runtime on this machine");
      }
    }
  } finally {
    await runtime.stop();
  }
});
