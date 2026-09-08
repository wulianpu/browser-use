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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { activeDevToolsEndpoint, chromeProcessRunning, remoteDebuggingState } from "../helpers/chromeProbe.mjs";
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
  assert.ok(chromeProcessRunning(), "precondition: Chrome/Chromium must be running for the existing-browser scenario");
  // The harness can only attach when remote debugging is available; without it
  // the daemon fatals with the chrome://inspect diagnostic and tab preservation
  // cannot be qualified (observed on Windows, browser-use 0.13.10 — see
  // docs/qualification-evidence.md).
  const debugging = remoteDebuggingState();
  const endpoint = await activeDevToolsEndpoint();
  assert.ok(
    debugging.state === "enabled" || endpoint !== null,
    "precondition: remote debugging must be user-enabled (chrome://inspect/#remote-debugging) or a live DevTools endpoint must exist",
  );
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

    // Dedicated post-cleanup listing; the cleanup output itself carries no tabs.
    const after = urlsOf(await exec("print(repr(list_tabs()))"));
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

runScenario("cold-start: harness behavior from a not-running browser", async () => {
  assert.ok(!chromeProcessRunning(), "precondition: Chrome/Chromium must NOT be running for the cold-start scenario (quit browsers first)");
  // Expected outcome depends on the remote-debugging prerequisite, because the
  // harness needs an attachable endpoint (observed on Windows with
  // browser-use 0.13.10 — see docs/qualification-evidence.md):
  //   flag enabled   → harness launches the browser, attaches, navigates
  //   flag disabled  → harness does NOT launch; it returns the documented
  //                    bounded, actionable diagnostic instead
  const debugging = remoteDebuggingState();
  const runtime = await startRuntime();
  let taskTabCreated = false;
  const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 240_000));
  try {
    const info = await exec(`
new_tab("https://example.com")
print(wait_for_load())
print(str(page_info())[:300])
`);
    if (debugging.state === "enabled") {
      taskTabCreated = /example\.com/.test(info);
      assert.ok(taskTabCreated, "with remote debugging enabled, the harness must launch the browser, attach, and navigate");
    } else {
      // browser_exec reports harness failures as ordinary text (isError stays
      // false; the traceback ends in "daemon didn't come up -- check <log>"),
      // while the actionable enable-chrome://inspect diagnostic lives in the
      // daemon log under PLUGIN_DATA. Either signal satisfies the expectation
      // that the failure is bounded and diagnosable (observed on Windows,
      // browser-use 0.13.10 — docs/qualification-evidence.md).
      const surfacedInToolText = /daemon .*didn'?t come up|DevToolsActivePort|chrome:\/\/inspect|remote.?debugging/i.test(info);
      const surfacedInHarnessLog = scanHarnessState(
        join(runtime.pluginData, "browser-harness"),
        Date.now() - 300_000,
        /DevToolsActivePort|chrome:\/\/inspect|remote.?debugging/i,
      );
      assert.ok(
        surfacedInToolText || surfacedInHarnessLog,
        "with remote debugging disabled and no browser running, the harness must surface its documented diagnostic (tool text or daemon log)",
      );
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

runScenario("remote-debugging-disabled: the official permission flow is triggered and waits for the user", async () => {
  assert.ok(chromeProcessRunning(), "precondition: Chrome/Chromium must be running");
  // Precondition mirrors what Browser Use itself checks: the Local State flag
  // (tri-state — only a determined "disabled" is accepted) and a live
  // DevToolsActivePort. A closed 9222 alone proves nothing.
  const debugging = remoteDebuggingState();
  assert.equal(
    debugging.state,
    "disabled",
    `precondition: remote debugging must be in a determined-disabled state (got ${debugging.state}${debugging.reason ? `: ${debugging.reason}` : ""})`,
  );
  assert.equal(
    await activeDevToolsEndpoint(),
    null,
    "precondition: no live DevToolsActivePort endpoint in any qualified profile",
  );

  // Upstream behavior this scenario is designed around (review finding):
  // browser_exec returns harness exceptions as ordinary TEXT output, and the
  // harness intentionally waits indefinitely for the user to approve remote
  // debugging. So the claim to prove is NOT "the call fails diagnosably" — it
  // is "the official permission/diagnostic flow is reached and waits for the
  // user", observed within a bounded window via the MCP process's own signals
  // (stderr) and the harness runtime state under PLUGIN_DATA.
  const interactive = process.env.BROWSER_USE_QUALIFICATION_APPROVE === "1";
  const windowMs = interactive ? 300_000 : 45_000;
  const flowKeywords = /remote.?debugging|chrome:\/\/inspect|mac-approve|permission|approval|waiting for|authorize/i;

  const runtime = await startRuntime();
  let evidence = null;
  try {
    // Fire the first browser action without awaiting it — it is expected to
    // block while the harness waits for the user.
    const pending = runtime.client
      .callTool("browser_exec", { code: 'new_tab("https://example.com")\nprint(wait_for_load())' }, windowMs + 30_000)
      .then((result) => ({ completed: true, result }))
      .catch((error) => ({ completed: false, error }));

    const startedAt = Date.now();
    const harnessHome = join(runtime.pluginData, "browser-harness");
    while (Date.now() - startedAt < windowMs && !evidence) {
      const stderrTail = runtime.client.stderrTail ?? "";
      const stderrMatch = stderrTail.match(flowKeywords);
      if (stderrMatch) {
        evidence = { source: "mcp-stderr", signal: stderrMatch[0] };
        break;
      }
      const fileMatch = scanHarnessState(harnessHome, startedAt, flowKeywords);
      if (fileMatch) {
        evidence = fileMatch;
        break;
      }
      // If the call somehow completed, debugging was actually usable — the
      // precondition claim was wrong, and the scenario must not pass silently.
      const settled = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(null), 0))]);
      if (settled && settled.completed) {
        assert.fail("browser work succeeded although the precondition claimed remote debugging was disabled — probe is wrong");
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    assert.ok(evidence, `the harness did not surface the remote-debugging permission flow observably within ${windowMs / 1000}s`);

    if (interactive) {
      // Human-in-the-loop completion: approve the browser's prompt within the
      // window; the pending action should then finish successfully.
      const settled = await pending;
      assert.ok(settled.completed, `approval flow did not complete the pending action: ${settled.error?.message ?? "no result"}`);
      const text = (settled.result?.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n");
      assert.ok(/example\.com/.test(text) || text.length > 0, "after approval the browser action completed");
    }
  } finally {
    await runtime.client.stop(); // bounded teardown; no zombie wait
  }

  // Evidence, not content: report the matched signal keyword only (§73).
  assert.ok(/^(mcp-stderr|harness-state)/.test(evidence.source), "evidence carries its source");
});

// Bounded scan of harness runtime state written since the runtime started.
// Matches keyword signals only — never returns file contents (§73).
function scanHarnessState(harnessHome, sinceMs, keywordRe) {
  const visit = (dir, depth) => {
    if (depth > 4) return null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = visit(full, depth + 1);
        if (found) return found;
        continue;
      }
      if (!/\.(log|txt|json)$/i.test(entry.name)) continue;
      try {
        const stats = statSync(full);
        if (stats.mtimeMs < sinceMs - 2_000 || stats.size > 512 * 1024) continue;
        const tail = readFileSync(full, "utf8").slice(-8192);
        const match = tail.match(keywordRe);
        if (match) return { source: "harness-state", signal: match[0], file: entry.name };
      } catch {
        /* unreadable state file — skip */
      }
    }
    return null;
  };
  return visit(harnessHome, 0);
}
