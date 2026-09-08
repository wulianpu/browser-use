// §82/§83/§84 Browser Qualification Tests — scenario-driven, with hard
// precondition asserts so a "pass" actually proves the scenario it names.
//
// Opt-in via BROWSER_USE_QUALIFICATION=1 (implies the browser-test gate).
// Select the scenario with BROWSER_USE_QUALIFICATION_SCENARIO:
//
//   existing-browser          Chrome running with user tabs open (§82)
//   cold-start                Chrome NOT running; harness must launch it (§83)
//   remote-debugging-disabled Chrome running without remote debugging (§84)
//
// Privacy: assertion messages and logs never contain real tab URLs — URLs are
// compared in memory only (§73). Each scenario closes the tab it creates.
//
// macOS mac-approve stays out of agent scope (§63); it is qualified through
// product diagnostics on a controlled macOS machine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeProcessRunning, tcpPortOpen } from "../helpers/chromeProbe.mjs";
import { RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

const SCENARIO = RUNTIME_GATES.qualificationScenario;

function textContent(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function urlsOf(tabListRepr) {
  // Parsed in memory; never embedded into assertion messages or logs (R8).
  return tabListRepr.match(/https?:\/\/[^'"\s,)]+/g) ?? [];
}

function qualificationGate(t) {
  if (!requireRuntimeOrSkip(t)) return false;
  if (!RUNTIME_GATES.qualification) {
    t.skip("BROWSER_USE_QUALIFICATION=1 required — interactive qualification against a real Chrome");
    return false;
  }
  return true;
}

function runScenario(name, fn) {
  test(`qualification [${SCENARIO}]: ${name} (§82-§84)`, async (t) => {
    if (!qualificationGate(t)) return;
    if (!name.startsWith(SCENARIO)) {
      t.skip(`scenario "${SCENARIO}" selected; this test belongs to another scenario`);
      return;
    }
    await fn(t);
  });
}

runScenario("existing-browser: user tabs survive an agent task", async () => {
  assert.ok(chromeProcessRunning(), "precondition: Chrome must be running for the existing-browser scenario");
  const runtime = await startRuntime();
  const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 180_000));
  let taskTabCreated = false;
  try {
    const before = urlsOf(await exec("print(repr(list_tabs()))"));
    assert.ok(before.length > 0, "precondition: at least one existing tab (otherwise run the cold-start scenario)");

    await exec(`
new_tab("https://example.com")
print(wait_for_load())
print(page_info())
`);
    taskTabCreated = true;
    const during = urlsOf(await exec("print(repr(list_tabs()))"));
    assert.ok(during.length > before.length, "task tab added on top of existing tabs");

    const cleanup = await exec(`
closed = "none"
for name in ("close_tab", "close_current_tab"):
    if name in dir():
        try:
            closed = name
            eval(name + "(current_tab())")
            break
        except Exception:
            closed = name + ":error"
print("cleanup:", closed)
`);
    taskTabCreated = false;
    const firstLine = cleanup.trim().split("\n")[0] ?? "";
    assert.ok(
      /^cleanup: (close_tab|close_current_tab)$/.test(firstLine),
      "a task-tab close helper must exist and succeed",
    );

    const after = urlsOf(cleanup);
    for (const url of before) {
      // In-memory comparison; the URL itself is never printed (R8).
      assert.ok(after.includes(url), "a pre-existing tab disappeared during the agent task");
    }
  } finally {
    if (taskTabCreated) {
      await exec(`
for name in ("close_tab", "close_current_tab"):
    if name in dir():
        try:
            eval(name + "(current_tab())")
            break
        except Exception:
            pass
`);
    }
    await runtime.client.stop();
  }
});

runScenario("cold-start: harness launches Chrome and reaches a working state", async () => {
  assert.ok(!chromeProcessRunning(), "precondition: Chrome must NOT be running for the cold-start scenario (quit Chrome first)");
  const runtime = await startRuntime();
  let taskTabCreated = false;
  const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 240_000));
  try {
    const info = await exec(`
new_tab("https://example.com")
print(wait_for_load())
print(str(page_info())[:300])
`);
    taskTabCreated = true;
    assert.ok(/example\.com/.test(info), "harness launched Chrome, attached, and navigated");
  } finally {
    if (taskTabCreated) {
      await exec(`
for name in ("close_tab", "close_current_tab"):
    if name in dir():
        try:
            eval(name + "(current_tab())")
            break
        except Exception:
            pass
`);
    }
    await runtime.client.stop();
  }
});

runScenario("remote-debugging-disabled: runtime reaches a diagnosable state, bounded", async () => {
  assert.ok(chromeProcessRunning(), "precondition: Chrome must be running");
  assert.equal(await tcpPortOpen(9222), false, "precondition: the CDP HTTP endpoint must not already be open");
  const runtime = await startRuntime();
  let taskTabCreated = false;
  try {
    const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 180_000));
    const outcome = await exec(`
new_tab("https://example.com")
print(wait_for_load())
print(str(page_info())[:300])
`).catch((error) => `__failed__:${String(error.message).slice(0, 200)}`);
    taskTabCreated = !outcome.startsWith("__failed__");

    if (outcome.startsWith("__failed__")) {
      // Accept a bounded, diagnosable failure (the chrome://inspect flow or a
      // permission-required state) — the invariant is: no silent hang, and the
      // condition is observable. Product-level UX of the flow is verified on a
      // controlled machine with a display.
      const diagnosable = /inspect|debug|permission|remote|9222|cdp/i.test(outcome);
      assert.ok(
        diagnosable || outcome.length === 0,
        "failure must be diagnosable (mentions the remote-debugging condition) and bounded",
      );
    } else {
      assert.ok(/example\.com/.test(outcome), "if debugging was already usable, the task itself must succeed");
    }
  } finally {
    if (taskTabCreated) {
      await execFinallyClose(runtime);
    }
    await runtime.client.stop();
  }
});

async function execFinallyClose(runtime) {
  try {
    await runtime.client.callTool(
      "browser_exec",
      {
        code: `
for name in ("close_tab", "close_current_tab"):
    if name in dir():
        try:
            eval(name + "(current_tab())")
            break
        except Exception:
            pass
`,
      },
      60_000,
    );
  } catch {
    // Best-effort cleanup during failure handling; never masks the real assertion.
  }
}
