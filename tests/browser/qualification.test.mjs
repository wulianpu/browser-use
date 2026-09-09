// §82/§83/§84 Browser Qualification Tests — scenario-driven, with hard
// precondition asserts so a "pass" actually proves the scenario it names.
//
// Browser identity is explicit: BROWSER_USE_QUALIFICATION_BROWSER selects the
// browser this run qualifies (chrome | chromium | edge). Every precondition
// is evaluated against THAT browser only, plus a competing-endpoint guard so
// another qualified browser cannot silently steal the attach — a run named
// "Chrome qualification" cannot pass by attaching Edge.
//
// Opt-in via BROWSER_USE_QUALIFICATION=1 (implies the browser-test gate).
// Select the scenario with BROWSER_USE_QUALIFICATION_SCENARIO:
//
//   existing-browser          target browser running with user tabs open (§82)
//   cold-start                target browser NOT running; qualify the observed
//                             platform contract (§83):
//                               A. browser stays cold → bounded actionable diagnostic
//                               B. harness-attributed launch → attach + navigate
//                               (external/self restart → approval-flow outcome is
//                                INCONCLUSIVE for cold-start; recorded as auxiliary)
//   remote-debugging-disabled target browser running without remote debugging (§84)
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
import {
  activeDevToolsEndpoint,
  chromeProcessRunning,
  competingBrowserInterference,
  QUALIFICATION_BROWSERS,
  remoteDebuggingState,
} from "../helpers/chromeProbe.mjs";
import { RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

const SCENARIO = RUNTIME_GATES.qualificationScenario;
const TARGET = RUNTIME_GATES.qualificationBrowser;

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
    t.skip("BROWSER_USE_QUALIFICATION=1 required — interactive qualification against a real browser");
    return false;
  }
  return true;
}

function runScenario(name, fn) {
  test(`qualification [${SCENARIO}/${TARGET}]: ${name} (§82-§84)`, async (t) => {
    if (!qualificationGate(t)) return;
    if (!name.startsWith(SCENARIO)) {
      t.skip(`scenario "${SCENARIO}" selected; this test belongs to another scenario`);
      return;
    }
    await fn(t);
  });
}

// Nothing about another qualified browser may redirect the attach: neither a
// live DevTools endpoint (outright attach theft) nor a persisted user-enabled
// debugging flag (observed 2026-09-09: its stale DevToolsActivePort metadata
// made the harness dial a dead port and surface an approval-flow error during
// a chrome-targeted cold-start with every browser closed).
async function assertNoCompetingEndpoint() {
  assert.ok(QUALIFICATION_BROWSERS.includes(TARGET), `target must be one of ${QUALIFICATION_BROWSERS.join("|")}`);
  const interference = await competingBrowserInterference(TARGET);
  assert.equal(
    interference,
    null,
    `identity guard: ${interference?.browser} ${interference?.kind === "live-endpoint" ? `holds a live DevTools endpoint (port ${interference?.port}) that would steal the attach` : "has remote debugging user-enabled; its persisted state can redirect the harness"} — disable it or use a dedicated qualification machine`,
  );
}

runScenario("existing-browser: user tabs survive an agent task", async () => {
  assert.ok(chromeProcessRunning(TARGET), `precondition: ${TARGET} must be running for the existing-browser scenario`);
  await assertNoCompetingEndpoint();
  // The harness can only attach when remote debugging is available on the TARGET.
  const debugging = remoteDebuggingState(TARGET);
  const endpoint = await activeDevToolsEndpoint(TARGET);
  assert.ok(
    debugging.state === "enabled" || endpoint !== null,
    `precondition: remote debugging must be user-enabled (chrome://inspect/#remote-debugging) or a live DevTools endpoint must exist on ${TARGET}`,
  );
  const runtime = await startRuntime();
  const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 180_000));
  let taskTabCreated = false;
  try {
    const before = urlsOf(await exec("print(repr(list_tabs()))"));
    assert.ok(before.length > 0, `precondition: at least one existing tab in ${TARGET} (otherwise run the cold-start scenario)`);

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
    await runtime.stop();
  }
});

runScenario("cold-start: harness behavior from a not-running target browser", async (t) => {
  assert.ok(!chromeProcessRunning(TARGET), `precondition: ${TARGET} must NOT be running for the cold-start scenario (quit it first)`);
  await assertNoCompetingEndpoint();
  const debugging = remoteDebuggingState(TARGET);
  assert.notEqual(
    debugging.state,
    "unknown",
    `precondition could not be determined — the scenario must not claim a branch it cannot verify: ${debugging.reason ?? "unknown probe result"}`,
  );
  const runtime = await startRuntime();
  let taskTabCreated = false;
  const startedAt = Date.now();
  const exec = async (code) => textContent(await runtime.client.callTool("browser_exec", { code }, 240_000));
  const inTextOrLog = (textPattern, logPattern, text) =>
    textPattern.test(text) ||
    Boolean(scanHarnessState(join(runtime.pluginData, "browser-harness"), startedAt, logPattern));
  try {
    const info = await exec(`
new_tab("https://example.com")
print(wait_for_load())
print(str(page_info())[:300])
`);
    const browserStillCold = !chromeProcessRunning(TARGET);

    if (/example\.com/.test(info)) {
      // Outcome B — navigation succeeded. That alone does NOT prove the
      // harness launched the browser; require launch attribution in the
      // harness's own state, or the scenario cannot claim the launch path.
      const attribution = scanHarnessState(
        join(runtime.pluginData, "browser-harness"),
        startedAt,
        /launch|spawn|start(ed|ing).*(browser|chrome|edge|chromium)/i,
      );
      assert.ok(
        attribution,
        "navigated, but the harness log carries no launch attribution — cannot credit the launch to Browser Use (the browser may have been started externally)",
      );
      taskTabCreated = true;
    } else if (/handshake-wait|permission-blocked|Allow remote debugging/i.test(info) ||
      scanHarnessState(join(runtime.pluginData, "browser-harness"), startedAt, /handshake-wait|permission-blocked/i)) {
      // The approval-flow/endpoint state does not prove cold-start behavior.
      // Observed causes: the browser came back (external/self restart) and
      // demanded interactive approval, OR another browser's persisted
      // debugging state made the harness dial a stale endpoint with every
      // browser closed. Valuable as an AUXILIARY §84-flow observation, but
      // never a cold-start PASS — and for a SELECTED scenario it must exit
      // NON-ZERO: a green qualification job must mean the contract was
      // proved (t.skip here would let CI show success without evidence).
      assert.fail(
        `QUALIFICATION-INCONCLUSIVE (selected scenario): the harness reached an approval-flow/endpoint state (external browser restart, or stale endpoint metadata from another qualified browser) that does not prove cold-start behavior — recorded as auxiliary §84 evidence; re-run on a controlled machine`,
      );
    } else if (debugging.state === "enabled") {
      // Outcome A (prerequisite ON): browser must have STAYED cold and the
      // harness must have reported its own diagnostic. Observed Windows
      // vocabulary (docs/qualification-evidence.md): Edge cold →
      // chrome-not-running; Chrome cold → "remote debugging is turned off for
      // this browser instance" (the per-instance approval only exists in a
      // RUNNING browser; a cold one reports this bounded actionable notice).
      assert.ok(
        browserStillCold &&
          inTextOrLog(
            /chrome-not-running|start Chrome|remote debugging is turned off|for this browser instance/i,
            /chrome-not-running|start Chrome|remote debugging is turned off/i,
            info,
          ),
        "prerequisite ON, browser not running: PASS requires the browser to remain cold AND its diagnostic (chrome-not-running, or the instance-level remote-debugging-turned-off notice)",
      );
    } else {
      // Outcome A (prerequisite OFF): observed 2026-09-08 — daemon fails, tool
      // text points at the daemon log, which carries the enable-chrome://inspect
      // diagnostic. The browser must equally have stayed cold.
      assert.ok(
        browserStillCold &&
          inTextOrLog(
            /daemon .*didn'?t come up|DevToolsActivePort|chrome:\/\/inspect|remote.?debugging/i,
            /DevToolsActivePort|chrome:\/\/inspect|remote.?debugging/i,
            info,
          ),
        "prerequisite OFF, browser not running: PASS requires the browser to remain cold AND the DevToolsActivePort / enable-chrome://inspect diagnostic (tool text or daemon log)",
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
    await runtime.stop();
  }
});

runScenario("remote-debugging-disabled: the official permission flow is triggered and waits for the user", async () => {
  assert.ok(chromeProcessRunning(TARGET), `precondition: ${TARGET} must be running`);
  await assertNoCompetingEndpoint();
  // Precondition mirrors what Browser Use itself checks: the Local State flag
  // (tri-state — only a determined "disabled" is accepted) and a live
  // DevToolsActivePort on the TARGET. A closed 9222 alone proves nothing.
  const debugging = remoteDebuggingState(TARGET);
  assert.equal(
    debugging.state,
    "disabled",
    `precondition: remote debugging on ${TARGET} must be in a determined-disabled state (got ${debugging.state}${debugging.reason ? `: ${debugging.reason}` : ""})`,
  );
  assert.equal(
    await activeDevToolsEndpoint(TARGET),
    null,
    `precondition: no live DevToolsActivePort endpoint in the ${TARGET} profile`,
  );

  // Upstream behavior this scenario is designed around: browser_exec returns
  // harness exceptions as ordinary TEXT output, and the harness intentionally
  // waits indefinitely for the user to approve remote debugging. The claim to
  // prove is that the official permission/diagnostic flow is reached and waits
  // for the user, observed within a bounded window via the MCP process's own
  // signals (stderr) and the harness runtime state under PLUGIN_DATA.
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
        assert.fail(`browser work succeeded although the precondition claimed remote debugging was disabled on ${TARGET} — probe is wrong`);
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
    await runtime.stop(); // bounded teardown; no zombie wait
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
