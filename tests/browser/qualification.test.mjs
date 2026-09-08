// §82/§83/§84 Browser Qualification Tests — existing-browser, chrome-startup
// and remote-debugging scenarios against a real desktop Chrome.
//
// Opt-in via BROWSER_USE_QUALIFICATION=1 (implies the browser-test gate).
// Cold-start (§83: Chrome not running) and not-yet-enabled remote debugging (§84)
// need a controlled machine; on a normal desktop these scenarios verify the
// positive path (harness reaches ready state) and the user-tab invariant.
// macOS mac-approve is out of agent scope (§63) and is qualified via product
// diagnostics, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

function textContent(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function urlsFrom(tabListRepr) {
  return tabListRepr.match(/https?:\/\/[^'"\s,)]+/g) ?? [];
}

test("existing browser: user tabs survive an agent task (§82/§51)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  if (!RUNTIME_GATES.qualification) {
    t.skip("BROWSER_USE_QUALIFICATION=1 required — interactive qualification against the user's real Chrome");
    return;
  }

  const runtime = await startRuntime();
  const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 180_000));
  try {
    // Attach to whatever Chrome state exists: running Chrome, existing tabs,
    // possibly logged-in sessions. Record the pre-existing tab URLs.
    const before = urlsFrom(await exec("print(repr(list_tabs()))"));

    // Task-owned tab: do real work in our own tab only.
    await exec(`
new_tab("https://example.com")
print(wait_for_load())
print(page_info())
`);
    const during = urlsFrom(await exec("print(repr(list_tabs()))"));
    assert.ok(during.length >= before.length, "task tab added on top of existing tabs");

    // Close only the task tab; every pre-existing URL must still be present.
    const cleanup = await exec(`
closed = "none"
for name in ("close_tab", "close_current_tab"):
    if name in dir():
        try:
            closed = name + ":" + str(eval(name + "(current_tab())"))
            break
        except Exception as exc:
            closed = name + ":error:" + str(exc)[:120]
print("cleanup:", closed)
print("tabs_after:", repr(list_tabs()))
`);
    const after = urlsFrom(cleanup);
    for (const url of before) {
      assert.ok(after.includes(url), `user tab ${url} must never be closed by the agent task`);
    }
    assert.ok(!cleanup.includes("error"), "tab cleanup must succeed: " + cleanup);
  } finally {
    await runtime.client.stop();
  }
});

test("ready state from the current machine's Chrome condition (§83/§84)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  if (!RUNTIME_GATES.qualification) {
    t.skip("BROWSER_USE_QUALIFICATION=1 required");
    return;
  }
  // Whether Chrome was already running, launched by the harness, or needed the
  // remote-debugging flow, the invariant is the same: the harness reaches a
  // working state through its own lifecycle (§61/§62) and the plugin reports it.
  const runtime = await startRuntime();
  try {
    const info = textContent(
      await runtime.client.callTool(
        "browser_exec",
        { code: 'new_tab("https://example.com")\nprint(wait_for_load())\nprint(str(page_info())[:300])' },
        180_000,
      ),
    );
    assert.ok(/example\.com/.test(info), "harness reached a working browser state and navigated");
  } finally {
    await runtime.client.stop();
  }
});
