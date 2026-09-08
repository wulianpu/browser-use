// Reference composed host runtime (test-only). It chains every host policy in
// the order a real Agent Host must apply them, so tests can verify the POLICY
// COMPOSITION, not just each pure function in isolation:
//
//   permission check (§25) → input bound (§56) → single-flight (§39/§87)
//   → MCP call with timeout (§55) → output bound (§57) → failure
//   classification / no-replay (§58-§60) → transport poisoning + recovery
//   (§59/§60) → task-boundary recycle (§37)
//
// Two deliberate posture choices:
//   - every browser_exec is treated as side-effect-possible: the host cannot
//     reliably analyze arbitrary Python, so agents never get to declare a call
//     "read-only";
//   - a timeout/transport failure poisons the transport: the MCP process is
//     stopped immediately (killing any still-running browser_exec with it) and
//     all further calls on it are rejected. Recovery means an explicit fresh
//     process (§59: recover → inspect → decide), never a silent retry.
//
// NOT plugin runtime code. Hosts integrate this plugin behind their own
// equivalent of this wrapper; the real-Host proof is a product release gate.

import {
  authorizeTool,
  boundImageOutput,
  boundTextOutput,
  checkCodeInput,
  createBrowserRuntimeGate,
  decideAfterFailure,
  DEFAULT_TIMEOUTS_MS,
  policyError,
} from "./hostPolicy.mjs";

function textOf(result) {
  return (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function imageBytesOf(result) {
  return (result?.content ?? [])
    .filter((part) => part.type === "image" && typeof part.data === "string")
    .reduce((sum, part) => sum + Buffer.byteLength(part.data, "base64"), 0);
}

export function createReferenceHostRuntime({
  // transport: { callTool(name, args, timeoutMs), stop() } — real MCP client or test double
  transportFactory,
  granted = ["browser.observe", "browser.interact", "browser.debug", "local.code-execution"],
  gateMode = "queue",
  timeouts = DEFAULT_TIMEOUTS_MS,
} = {}) {
  const gate = createBrowserRuntimeGate({ mode: gateMode });
  const calls = []; // { task, tool } — audit trail without payloads for logging policy (§73)

  // One logical task = one transport = one MCP process (§37/§38).
  async function withTask(taskId, fn) {
    return gate.submit(taskId, async () => {
      const task = {
        taskId,
        recycles: 0,
        _transport: await transportFactory(taskId),
        _poisoned: null,
        get poisoned() {
          return this._poisoned;
        },
        // §59 recovery: an explicit fresh MCP process to inspect page state on,
        // after an unknown outcome poisoned the previous transport. The poisoned
        // transport was already stopped at failure time — recovery only replaces.
        async recover() {
          if (!this._poisoned) return; // healthy transport, nothing to recover from
          this._transport = await transportFactory(`${taskId}#recovered-${++this.recycles}`);
          this._poisoned = null;
        },
        async exec(code) {
          assertNotPoisoned(this);
          const permission = authorizeTool("browser_exec", granted);
          if (!permission.allowed) {
            throw policyError(permission.code, `browser_exec denied (missing: ${permission.missing.join(", ")})`);
          }
          const input = checkCodeInput(code);
          if (!input.ok) {
            throw policyError(input.code, `browser_exec code exceeds ${input.limit} bytes`);
          }
          calls.push({ task: taskId, tool: "browser_exec" });
          try {
            const raw = await this._transport.callTool("browser_exec", { code }, timeouts.browser_exec);
            const bounded = boundTextOutput(textOf(raw));
            return {
              ok: true,
              code: bounded.truncated ? "BROWSER_USE_RESULT_TOO_LARGE" : null,
              truncated: bounded.truncated,
              text: bounded.text,
            };
          } catch (error) {
            // §58/§59: a timed-out call may still be executing server-side.
            // Poison + stop the process NOW so nothing keeps running, classify
            // the outcome as unknown, and never resubmit this code.
            this._poisoned = String(error?.message ?? error);
            await this._transport.stop().catch(() => {});
            const failure = /timed out/i.test(this._poisoned) ? "timeout" : "disconnect";
            const decision = decideAfterFailure({ sideEffectPossible: true, failure });
            return {
              ok: false,
              code: decision.code,
              outcome: decision.outcome,
              replay: decision.replay,
              nextStep: decision.nextStep,
            };
          }
        },
        async screenshot(options = {}) {
          assertNotPoisoned(this);
          const permission = authorizeTool("browser_screenshot", granted);
          if (!permission.allowed) {
            throw policyError(permission.code, `browser_screenshot denied (missing: ${permission.missing.join(", ")})`);
          }
          calls.push({ task: taskId, tool: "browser_screenshot" });
          const raw = await this._transport.callTool("browser_screenshot", { ...options }, timeouts.browser_screenshot);
          const bounded = boundImageOutput(imageBytesOf(raw) || 1);
          if (!bounded.ok) {
            throw policyError(bounded.code, "screenshot payload exceeds the image budget");
          }
          return { ok: true, content: raw.content };
        },
      };
      try {
        return await fn(task);
      } finally {
        await task._transport.stop().catch(() => {}); // task-boundary recycle (§37)
      }
    });
  }

  function assertNotPoisoned(task) {
    if (task._poisoned) {
      throw policyError(
        "BROWSER_USE_RUNTIME_CRASHED",
        "transport poisoned after an unknown-outcome failure; recover with task.recover() (fresh MCP process), inspect state, then decide (§59)",
      );
    }
  }

  return { withTask, calls };
}
