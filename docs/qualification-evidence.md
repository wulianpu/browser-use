# Browser Qualification Evidence

Running record of real qualification runs (§81-§84). A scenario counts as
qualified only with a dated PASS entry on the target platform. No page URLs or
tab contents are recorded here (§73).

## Scenario matrix

| Scenario | Windows 11 | macOS | Linux |
| --- | --- | --- | --- |
| existing-browser | **PASS 2026-09-09 — Microsoft Edge** (Google-Chrome run pending) | — | — |
| cold-start (prerequisite off) | **PASS 2026-09-08** | — | — |
| cold-start (prerequisite on) | PENDING — needs Edge fully quit | — | — |
| remote-debugging-disabled | PENDING — needs a machine with debugging disabled (this machine now has it enabled) | — | — |
| real OK / ERR sentinel paths | **PASS 2026-09-09 — Microsoft Edge** | — | — |

Scope note (2026-09-09): the V1 qualified browser matrix was extended by owner
decision to include Microsoft Edge (probe covers msedge.exe and the Edge
profile dir). Google Chrome / Chromium runs remain pending if the release
claims them.

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

### 2026-09-08 — exec failure classification, real runtime (Windows 11, browser-use 0.13.10)

- Command: `BROWSER_USE_BROWSER_TESTS=1 node tests/security/reference-host.test.mjs`
  (test 13, real-runtime branch).
- Result: **PASS** — through the reference host's sentinel wrapper, `print(1+1)`
  and `raise ValueError(...)` both came back from the real MCP server as
  pre-exec daemon-failure text (no sentinel printed, `isError: false`) and were
  classified `BROWSER_USE_EXEC_FAILED` / `pre-exec-runtime-failure`; neither was
  reported as success. On a machine with an attachable browser the same test
  additionally exercises the `user-code-exception` and success branches.

### 2026-09-09 — existing-browser (Microsoft Edge, Windows 11, browser-use 0.13.10)

- Preconditions asserted: Edge running; remote-debugging state `enabled`
  (Edge Local State); live DevToolsActivePort on 9222.
- Command: `BROWSER_USE_QUALIFICATION=1 BROWSER_USE_QUALIFICATION_SCENARIO=existing-browser node tests/browser/qualification.test.mjs`
- Result: **PASS** (~16 s) — attached to the running Edge with the user's real
  tabs, created one task tab (example.com), verified the work, closed only the
  task tab, and asserted every pre-existing tab still present afterwards
  (URLs compared in memory, never logged).

### 2026-09-09 — real OK / ERR sentinel paths on an attachable browser (Edge)

- `BROWSER_USE_BROWSER_TESTS=1 node tests/security/reference-host.test.mjs` —
  15/15 including the real-runtime classification test: on the attachable Edge
  the success branch returned the OK sentinel with computed output, and the
  raise branch returned the ERR sentinel with traceback, classified
  `user-code-exception` → `unknown-effects`.
- Explicit probe re-confirmed both paths: OK sentinel present (`isError: false`),
  ERR sentinel present with traceback carried (`isError: false`).

## Behavioral findings for Hosts (from qualification)

1. **`browser_exec` failures are ordinary text, not MCP errors** — the runtime
   prints tracebacks into the result buffer with `isError: false`. Hosts must
   classify textual traceback results as execution failures; output bounding
   alone is insufficient (the reference host classifies via per-call
   sentinels — see `tests/helpers/referenceHostRuntime.mjs`).
2. **The actionable diagnostic lives in the daemon log** under
   `${PLUGIN_DATA}/browser-harness/tmp/bu-default.log`; the tool text points at
   it. Hosts diagnosing "daemon didn't come up" should read that file.
3. **Browser auto-launch is conditional** on the remote-debugging prerequisite
   (observed Windows / 0.13.10). Without it, nothing is launched and the
   enable-chrome://inspect flow is the documented path forward.

## Pending evidence required for 1.0.0 release

- [ ] cold-start prerequisite-on PASS (fully quit Edge, then run the
      `cold-start` scenario — the harness must launch the browser).
- [ ] remote-debugging-disabled PASS on a machine with debugging disabled
      (flow-trigger evidence; optionally interactive completion via
      `BROWSER_USE_QUALIFICATION_APPROVE=1`).
- [ ] Google Chrome / Chromium qualification runs if the release claims them
      (requires enabling remote debugging in Google Chrome on this machine).
- [x] Reference-host real-runtime test on an attachable browser — **PASS
      2026-09-09 (Edge)**: real OK-sentinel success path and real
      user-code-exception path both verified (fake transports plus this
      machine's earlier pre-exec branch already covered the rest).
- [ ] macOS qualification incl. the mac-approve product-diagnostics path (§63).
- [ ] OS matrix coverage for the platforms the release claims.
