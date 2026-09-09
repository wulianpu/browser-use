// Sentinel-wrapper unit tests, executed by a REAL Python interpreter.
//
// The wrapper is plain Python run by browser_exec in a persistent namespace it
// shares with arbitrary agent code, so its correctness against ordinary name
// shadowing (`print = lambda *a: None`) must be proven against a real
// interpreter — fake transports can only exercise the host-side classifier.
// These tests run the generated wrapper payloads directly through python,
// no Chrome involved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapWithSentinels } from "../helpers/referenceHostRuntime.mjs";

function pythonBin() {
  for (const bin of ["python", "python3"]) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    if (!probe.error) return bin;
  }
  return null;
}

async function runInPython(payloads) {
  const dir = await mkdtemp(join(tmpdir(), "bu-sentinel-"));
  const script = payloads.join("\n");
  const scriptPath = join(dir, "wrapper.py");
  await writeFile(scriptPath, script, "utf8");
  try {
    const bin = pythonBin();
    if (!bin) return { skipped: true };
    const run = spawnSync(bin, [scriptPath], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    return { skipped: false, stdout: run.stdout ?? "", stderr: run.stderr ?? "", status: run.status };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function maybeSkipPython(t, result) {
  if (result.skipped) {
    t.skip("no python/python3 interpreter on PATH — wrapper semantics not exercised");
    return false;
  }
  return true;
}

test("plain success emits the OK sentinel", async (t) => {
  const result = await runInPython([wrapWithSentinels("print('hello from user code')").wrapped]);
  if (!maybeSkipPython(t, result)) return;
  const { okSentinel, errSentinel } = wrapWithSentinels("pass");
  assert.ok(result.stdout.includes("__BROWSER_USE_EXEC_OK_"), "OK sentinel present");
  assert.ok(!result.stdout.includes("__BROWSER_USE_EXEC_ERR_"), "no ERR sentinel");
  assert.ok(result.stdout.includes("hello from user code"));
  assert.equal(result.status, 0, `python itself must not fail: ${result.stderr}`);
});

test("a user-code raise emits the ERR sentinel with the traceback", async (t) => {
  const result = await runInPython([wrapWithSentinels("raise ValueError('boom')").wrapped]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("__BROWSER_USE_EXEC_ERR_"), "ERR sentinel present");
  assert.ok(result.stdout.includes("ValueError: boom"), "traceback carried");
  assert.ok(!result.stdout.includes("__BROWSER_USE_EXEC_OK_"));
  assert.equal(result.status, 0, "the wrapper converts the exception into output, not a process failure");
});

test("user code shadowing print cannot swallow the OK sentinel (review P0)", async (t) => {
  const result = await runInPython([
    wrapWithSentinels("print = lambda *args, **kwargs: None\nprint('this print goes nowhere')").wrapped,
  ]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("__BROWSER_USE_EXEC_OK_"), "success is still reported despite the shadowed print");
});

test("user code shadowing print/exec/compile/BaseException cannot swallow the ERR sentinel (review P0)", async (t) => {
  const shadow = [
    "print = lambda *args, **kwargs: None",
    "exec = lambda *args, **kwargs: None",
    "compile = lambda *args, **kwargs: None",
    "BaseException = int",
    "click_happened = True",
    "raise ValueError('after the click')",
  ].join("\n");
  const result = await runInPython([wrapWithSentinels(shadow).wrapped]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("__BROWSER_USE_EXEC_ERR_"), "the failure is still reported despite shadowing");
  assert.ok(result.stdout.includes("ValueError: after the click"), "traceback still carried");
});

test("shadowing from an EARLIER call cannot break a LATER wrapper (persistent namespace)", async (t) => {
  // browser_exec execs every call in one persistent namespace; simulate two
  // sequential calls in a single interpreter sharing module globals. Call 1
  // shadows the global print — call 2's OWN user code must live with that
  // (that is the persistent namespace working as designed), but the wrapper's
  // sentinel reporting must be immune.
  const call1 = wrapWithSentinels("print = lambda *args, **kwargs: None\nexec = None");
  const call2 = wrapWithSentinels("import sys\nsys.stdout.write('second call output\\n')");
  const result = await runInPython([call1.wrapped, call2.wrapped]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("second call output"), "user output still flows via sys.stdout");
  assert.ok(result.stdout.includes(call1.okSentinel), "call 1 reports success");
  assert.ok(result.stdout.includes(call2.okSentinel), "call 2's wrapper is immune to call 1's shadowing");
});

test("persistent-namespace semantics survive the wrapper: call 2 sees call 1's definitions", async (t) => {
  const call1 = wrapWithSentinels('shared_marker = "defined-in-call-one"').wrapped;
  const call2 = wrapWithSentinels('print("marker:", shared_marker)').wrapped;
  const result = await runInPython([call1, call2]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("marker: defined-in-call-one"), "definitions still land in the shared namespace");
  assert.equal((result.stdout.match(/__BROWSER_USE_EXEC_OK_/g) ?? []).length, 2);
});

test("sentinels are per-call and do not collide across calls", async () => {
  const first = wrapWithSentinels("pass");
  const second = wrapWithSentinels("pass");
  assert.notEqual(first.okSentinel, second.okSentinel);
  assert.notEqual(first.errSentinel, second.errSentinel);
  assert.match(first.okSentinel, /^__BROWSER_USE_EXEC_OK_[0-9a-f]{32}__$/);
});

test("instrumentation is transient: __bu_* names are cleaned from the namespace after a call", async (t) => {
  const probe = [
    "print('leftovers:',",
    "    '__bu_b' in globals(),",
    "    '__bu_sys' in globals(),",
    "    '__bu_tb' in globals(),",
    "    '__bu_g' in globals(),",
    "    any(name.startswith('__bu_run_') for name in globals()),",
    ")",
  ].join("\n");
  const result = await runInPython([wrapWithSentinels("pass").wrapped, probe]);
  if (!maybeSkipPython(t, result)) return;
  assert.match(result.stdout, /leftovers:\s*False\s+False\s+False\s+False\s+False/, "no instrumentation names persist");
  assert.ok(result.stdout.includes("__BROWSER_USE_EXEC_OK_"), "the call itself still succeeded");
});

test("cleanup also runs after a raising call", async (t) => {
  const probe = "print('bu_b_left:', '__bu_b' in globals())";
  const result = await runInPython([wrapWithSentinels("raise ValueError('boom')").wrapped, probe]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("__BROWSER_USE_EXEC_ERR_"));
  assert.ok(result.stdout.includes("bu_b_left: False"), "the runner catches the exception, so cleanup always executes");
});

test("a user's own __bu_run variable is not clobbered by the nonce-named emitter (P2.1)", async (t) => {
  const call1 = wrapWithSentinels("__bu_run = 42\n__bu_marker = 'kept'");
  const probe = "print('user __bu_run:', __bu_run, '| marker:', __bu_marker)";
  const result = await runInPython([call1.wrapped, probe]);
  if (!maybeSkipPython(t, result)) return;
  assert.ok(result.stdout.includes("user __bu_run: 42"), "user variable of the same base name survives");
  assert.ok(result.stdout.includes("marker: kept"));
  assert.ok(result.stdout.includes(call1.okSentinel), "and the call still reports success");
});
