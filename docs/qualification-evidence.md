# Browser Qualification Evidence

Running record of real qualification runs (§81-§84). A scenario counts as
qualified only with a dated PASS entry on the target platform. No page URLs or
tab contents are recorded here (§73).

## Scenario matrix

| Scenario | Windows 11 (this repo's dev machine) | macOS | Linux |
| --- | --- | --- | --- |
| existing-browser | PENDING — needs remote debugging user-enabled on the machine | — | — |
| cold-start (prerequisite off branch) | **PASS 2026-09-08** | — | — |
| cold-start (prerequisite on branch) | PENDING — needs remote debugging user-enabled | — | — |
| remote-debugging-disabled | PENDING — needs browser running with debugging disabled | — | — |

## Run log

### 2026-09-08 — cold-start, prerequisite-off branch (Windows 11, browser-use 0.13.10)

- Preconditions asserted: no Chrome/Chromium process running; Chrome stable
  profile present; remote-debugging state = determined `disabled`
  (Local State flag off); no live DevToolsActivePort.
- Command: `BROWSER_USE_BROWSER_TESTS=1 BROWSER_USE_QUALIFICATION=1
  BROWSER_USE_QUALIFICATION_SCENARIO=cold-start node tests/browser/qualification.test.mjs`
- Result: **PASS** — `browser_exec` completed in a bounded ~40 s with a
  traceback ending in `RuntimeError: daemon default didn't come up -- check
  …/browser-harness/tmp/bu-default.log`; the daemon log carried the documented
  diagnostic `fatal: DevToolsActivePort not found in […] — enable
  chrome://inspect/#remote-debugging, or set BU_CDP_WS for a remote browser`.
  The harness daemon exited cleanly; no lingering processes; the browser was
  never launched.
- First attempt (before the scenario encoded this behavior) correctly FAILED
  against the then-current expectation "harness launches Chrome automatically":
  that upstream claim does **not** hold on Windows with the debugging
  prerequisite unsatisfied. SKILL.md has been corrected accordingly.

## Behavioral findings for Hosts (from qualification)

1. **`browser_exec` failures are ordinary text, not MCP errors** — the runtime
   prints tracebacks into the result buffer with `isError: false`. Hosts must
   not treat `isError` as the failure signal; scan the textual output for
   tracebacks (the reference host's output bounding already wraps this).
2. **The actionable diagnostic lives in the daemon log** under
   `${PLUGIN_DATA}/browser-harness/tmp/bu-default.log`; the tool text points at
   it. Hosts diagnosing "daemon didn't come up" should read that file.
3. **Browser auto-launch is conditional** on the remote-debugging prerequisite
   (observed Windows / 0.13.10). Without it, nothing is launched and the
   enable-chrome://inspect flow is the documented path forward.

## Pending evidence required for 1.0.0 release

- [ ] existing-browser PASS on at least one machine with remote debugging
      user-enabled (tab-preservation invariant against a real logged-in
      profile). Enabling remote debugging changes the machine's browser
      security posture — machine owner's explicit decision.
- [ ] cold-start prerequisite-on branch PASS (harness actually launches).
- [ ] remote-debugging-disabled PASS (flow-trigger evidence; optionally
      interactive completion via `BROWSER_USE_QUALIFICATION_APPROVE=1`).
- [ ] macOS qualification incl. the mac-approve product-diagnostics path (§63).
- [ ] OS matrix coverage for the platforms the release claims.
