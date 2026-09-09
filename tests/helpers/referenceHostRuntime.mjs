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
// A third, evidence-backed choice (qualified on browser-use 0.13.10): the
// runtime prints Python/harness exceptions into the result buffer as ordinary
// text (isError stays false), so a Host MUST NOT treat a returned result as
// success. exec() therefore wraps the user's code with unpredictable
// per-call sentinels and classifies:
//
//   OK sentinel present  → user code ran to completion        → ok
//   ERR sentinel present → user code raised                   → BROWSER_USE_EXEC_FAILED
//   neither sentinel     → the wrapper never ran (daemon/runtime pre-exec
//                          failure, e.g. "daemon didn't come up") → BROWSER_USE_EXEC_FAILED
//
// Outcome semantics differ by class, and this is the reliability-critical
// distinction (review P0):
//
//   pre-exec-runtime-failure / mcp-error → outcome "known-failed": the user
//       code never started, so a deliberate retry after diagnosis is safe.
//   user-code-exception → outcome "unknown-effects": the code RAN, possibly
//       performed consequential browser actions, and then raised — the business
//       result is unknown. Blind retry risks double-submit; the only permitted
//       next step is to inspect the browser state (on the still-usable
//       transport), determine what already happened, and only then decide.
//
// The wrapper exec's user code with globals() for both globals and locals, so
// the runtime's persistent-namespace semantics are preserved.
//
// Sentinel trust model: the nonce is random per call and never shown to the
// agent, which makes normal-execution collisions and accidental forgeries
// effectively impossible. It is RELIABILITY INSTRUMENTATION for trusted,
// authorized agent code — not a security boundary. The code runs as arbitrary
// Python in the same interpreter and could in principle tamper with its own
// reporting (sys._getframe, patched builtins); containing malicious Python is
// the host's local.code-execution boundary, not this wrapper.
//
// NOT plugin runtime code. Hosts integrate this plugin behind their own
// equivalent of this wrapper; the real-Host proof is a product release gate.

import { randomBytes } from "node:crypto";
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
          const { okSentinel, errSentinel, wrapped } = wrapWithSentinels(code);
          try {
            const raw = await this._transport.callTool("browser_exec", { code: wrapped }, timeouts.browser_exec);
            const classification = classifyExecResult(raw, { okSentinel, errSentinel });
            const bounded = boundTextOutput(classification.text);
            if (classification.ok) {
              return {
                ok: true,
                code: bounded.truncated ? "BROWSER_USE_RESULT_TOO_LARGE" : null,
                truncated: bounded.truncated,
                text: bounded.text,
              };
            }
            // Determined textual failure — the call completed, so the
            // transport stays usable (no poison; that is reserved for
            // timeouts). But the outcome depends on WHERE it failed:
            // user-code exceptions leave possible side effects unknown.
            const userCodeFailed = classification.failureClass === "user-code-exception";
            return {
              ok: false,
              code: "BROWSER_USE_EXEC_FAILED",
              outcome: userCodeFailed ? "unknown-effects" : "known-failed",
              replay: false,
              failureClass: classification.failureClass,
              text: bounded.text,
              nextStep: userCodeFailed
                ? ["inspect the current browser state (this transport is still usable)", "determine which side effects already occurred", "only then decide whether any action is still needed — never blind-retry"]
                : ["diagnose the returned runtime error", "fix the environment/procedure", "retry deliberately"],
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

// Wrap user code with unpredictable per-call sentinels. The wrapper is plain
// Python executed by the official browser_exec — no runtime is reimplemented —
// and exec's the user code with the persistent globals dict for both scopes,
// so the runtime's persistent-namespace semantics are preserved.
//
// Shadowing-proof instrumentation: user code shares the persistent globals
// with this wrapper, so perfectly ordinary code (`print = lambda *a: None`)
// would swallow a module-level `print(SENTINEL)` and misclassify the call as
// a pre-exec failure. The emitters therefore live inside __bu_run(), whose
// default arguments capture exec/compile/globals()/BaseException/print/
// traceback/stdout ONCE at definition time — rebinding any of those names
// during user code (or by an earlier call, since the namespace persists)
// cannot affect this call's sentinel reporting.
export function wrapWithSentinels(userCode) {
  const nonce = randomBytes(16).toString("hex");
  const okSentinel = `__BROWSER_USE_EXEC_OK_${nonce}__`;
  const errSentinel = `__BROWSER_USE_EXEC_ERR_${nonce}__`;
  const wrapped = [
    "import builtins as __bu_b, sys as __bu_sys, traceback as __bu_tb",
    "def __bu_run(__code, __ok, __err,",
    "    __exec=__bu_b.exec, __compile=__bu_b.compile, __globals=__bu_b.globals(),",
    "    __base_exception=__bu_b.BaseException, __print=__bu_b.print,",
    "    __traceback=__bu_tb, __output=__bu_sys.stdout):",
    "    try:",
    "        __exec(__compile(__code, '<browser_exec>', 'exec'), __globals, __globals)",
    "    except __base_exception:",
    "        __print(__err, file=__output)",
    "        __traceback.print_exc(file=__output)",
    "    else:",
    "        __print(__ok, file=__output)",
    `__bu_run(${JSON.stringify(userCode)}, ${JSON.stringify(okSentinel)}, ${JSON.stringify(errSentinel)})`,
  ].join("\n");
  return { okSentinel, errSentinel, wrapped };
}

// Classify a finished (non-transport-failing) browser_exec result. Substring
// matching is collision-resistant for normal execution — the nonce is random
// per call and never exposed to the agent, and it also survives user output
// printed without a trailing newline. This is instrumentation for trusted
// agent code, not a security boundary against malicious Python.
function classifyExecResult(raw, { okSentinel, errSentinel }) {
  const text = textOf(raw);
  if (raw && raw.isError === true) {
    return { ok: false, failureClass: "mcp-error", text };
  }
  const hasErr = text.includes(errSentinel);
  const hasOk = text.includes(okSentinel);
  if (hasErr) {
    return { ok: false, failureClass: "user-code-exception", text: stripSentinels(text, okSentinel, errSentinel) };
  }
  if (hasOk) {
    return { ok: true, text: stripSentinels(text, okSentinel, errSentinel) };
  }
  // Neither sentinel: the wrapper never ran — a pre-exec runtime/daemon
  // failure arrived as plain text (observed: "daemon didn't come up"
  // tracebacks) or the result shape is unrecognized. Deterministically a
  // failure, never a success.
  return { ok: false, failureClass: "pre-exec-runtime-failure", text };
}

function stripSentinels(text, okSentinel, errSentinel) {
  return text.split(okSentinel).join("").split(errSentinel).join("");
}
