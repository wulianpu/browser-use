# Browser Qualification Evidence

Running record of real qualification runs (§81-§84). A scenario counts as
qualified only with a dated PASS entry on the target platform. No page URLs or
tab contents are recorded here (§73).

## Scenario matrix

| Scenario | Windows 11 | macOS | Linux |
| --- | --- | --- | --- |
| existing-browser | **PASS 2026-09-09 — Microsoft Edge**; **PASS 2026-09-09 — Google Chrome** | — | — |
| cold-start (prerequisite off) | **PASS 2026-09-08 (flag-off machine state)**; **PASS 2026-09-09 — Chrome-targeted re-proof at current SHA** (browser stayed cold; daemon-failure tool text + instance-level enable-chrome://inspect diagnostic in the log) | — | — |
| cold-start (prerequisite on) | **PASS 2026-09-09 — Edge via `chrome-not-running` diagnostic**; **PASS 2026-09-09 — Chrome via instance-level `remote debugging is turned off` diagnostic** (browser stays cold in both; launch-automation not observed on Windows) | — | — |
| real OK / ERR sentinel paths | **PASS 2026-09-09 — Edge**; **PASS 2026-09-09 — Google Chrome** | — | — |
| remote-debugging-disabled | **PASS 2026-09-09 — Google Chrome** (flow-trigger evidence within the bounded window) | — | — |

Scope note (2026-09-09): per the frozen V1 product scope, **Google Chrome +
Chromium are the REQUIRED qualification matrix** — their evidence is pending
and Gate 1 cannot close without it. **Microsoft Edge is an owner-approved
ADDITIONAL qualified browser on Windows 11** (probe covers msedge.exe and the
Edge profile dir); Edge runs below are extra coverage, not a substitute for
the Chrome/Chromium matrix.

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

### 2026-09-09 — cold-start, prerequisite-on (Windows 11, Edge, browser-use 0.13.10)

- Preconditions asserted: Edge fully quit and verified stable (0 processes, no
  self-respawn over 10 s — note Edge's startup-boost can respawn after a force
  kill, which initially masqueraded as a harness launch); remote-debugging
  state `enabled`; no live endpoint.
- Two controlled runs: the harness did **not** launch a browser. `browser_exec`
  returned bounded (~35-43 s) actionable text and the daemon log carried
  `fatal: chrome-not-running: no supported Chromium-family browser is running
  -- start Chrome, then retry`. msedge process count 0 before and after each
  run.
- Conclusion: on Windows the upstream "harness launches a not-running browser"
  claim does not hold in EITHER prerequisite state; the qualified contract is
  the bounded diagnostic. SKILL.md/troubleshooting.md updated to the observed
  behavior; the scenario now asserts launch-or-diagnostic and the evidence
  records which occurred.
- Additional observed outcome (same day, later run): after a force-kill, Edge
  self-relaunched with the debugging flag; the harness connected to the 9222
  endpoint and entered the interactive approval flow — daemon log:
  `handshake-wait: if Chrome shows an 'Allow remote debugging?' popup, click
  Allow` → `fatal: permission-blocked: Chrome did not approve the remote
  debugging connection; browser-harness did not retry or create another
  connection`. This is the §84 approval path firing for real: bounded,
  actionable, no silent retry. The cold-start ON assertion vocabulary now
  covers all three observed outcomes (launch / chrome-not-running /
  permission-blocked).

### 2026-09-09 — chrome cold-start OFF attempt at current SHA: INCONCLUSIVE (stale-endpoint contamination)

- Preconditions held at start: Chrome not running, Chrome debugging state
  determined `disabled`, no live endpoint anywhere. Edge had been gracefully
  closed but its remote-debugging flag stayed user-enabled.
- During the run the harness dialed `ws://127.0.0.1:9222` (from Edge's stale
  DevToolsActivePort metadata) and reported `handshake-wait` → `fatal: CDP WS
  handshake failed: connection refused -- click Allow in Chrome if prompted`.
  Process counts stayed 0 for both browsers throughout — nothing restarted.
- Verdict: INCONCLUSIVE for cold-start (recorded as auxiliary §84-flow
  evidence), not a Chrome OFF PASS. The current-SHA prerequisite-OFF re-proof
  remains pending; it requires Edge's debugging flag OFF (or a dedicated
  machine). The identity guard now rejects this interference upfront
  (`enabled-flag` kind) instead of failing mid-run.

### 2026-09-09 — Chrome matrix completion: remote-debugging-disabled + cold-start OFF re-proof

- **remote-debugging-disabled PASS (chrome)**: Chrome running with the flag
  newly disabled (probe-verified determined-disabled), no live endpoint, no
  interference. The fired browser action entered the official
  permission/diagnostic flow, and flow-trigger evidence surfaced within the
  45 s bounded window (MCP stderr / harness state under PLUGIN_DATA); the
  scenario tore down without zombie waits. §84 flow verified on the
  required browser.
- **cold-start OFF re-proof at current SHA PASS (chrome)**: Chrome gracefully
  closed after the flag was disabled; the browser stayed cold (0 processes
  before and after) and the failure surfaced bounded and actionable — the
  tool text carried the daemon-didn't-come-up error pointing at the log,
  whose diagnostic now reads instance-level (`remote debugging is turned off
  for this browser instance — enable chrome://inspect/#remote-debugging`)
  rather than the 2026-09-08 profile-scan wording (`DevToolsActivePort not
  found in [...]`). Both match the OFF vocabulary (tool text or log); the
  wording difference is recorded honestly.

With these, the Google-Chrome required matrix on Windows 11 is complete:
existing-browser, cold-start OFF + ON, real OK/ERR sentinel paths,
remote-debugging-disabled.

### 2026-09-09 — Google Chrome core matrix (Windows 11, browser-use 0.13.10)

- **existing-browser PASS** (`BROWSER_USE_QUALIFICATION_BROWSER=chrome`):
  Chrome freshly launched with the flag on; the first attach entered the
  interactive approval handshake and exceeded the 180 s call budget until the
  user clicked Allow (recorded below as finding #6); after approval, the run
  attached Google Chrome, preserved the pre-existing tab (seeded — a fresh
  Chrome instance only had chrome://newtab, which carries no http URL),
  created and closed only its own task tab.
- **cold-start prerequisite-ON PASS**: Chrome gracefully closed (clean
  shutdown removed its DevToolsActivePort), flag still enabled, no
  interference. The browser stayed cold (0 processes before and after) and
  the daemon log carried `fatal: remote debugging is turned off for this
  browser instance — enable chrome://inspect/#remote-debugging (tick "Allow
  remote debugging for this browser instance")` — the instance-level notice
  (finding #6). Two consistent runs.
- **real OK/ERR sentinel paths PASS**: reference-host suite 15/15 with the
  real-runtime test on Google Chrome — success branch ok:true with computed
  output; raise branch ERR sentinel → user-code-exception → unknown-effects.
- Endpoint attribution fix (evidence-driven): modern Chrome serves HTTP 404
  for /json/version, and Edge's stale DevToolsActivePort file named the port
  Chrome was listening on — attribution is now by the LISTENING socket's
  owning process (netstat → PID → image), which correctly credited 9222 to
  chrome.exe and null to Edge's stale file.

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
4. **No auto-launch on Windows even with the prerequisite satisfied** (two
   controlled runs, 2026-09-09): the harness reports `chrome-not-running`
   (start the browser, then retry). Hosts/agents must start the browser
   themselves. Also: force-killed Edge can self-respawn via startup-boost —
   qualification harnesses must verify the browser stays down before claiming
   a cold-start state.
5. **Persisted debugging state on ANOTHER browser contaminates targeted runs**
   (2026-09-09): with every browser closed, Edge's user-enabled flag plus its
   stale DevToolsActivePort file made the harness dial the dead port and
   surface an approval-flow error during a chrome-targeted run. Identity
   isolation must reject competing browsers by live endpoint AND by persisted
   enabled flag.
6. **Remote-debugging approval is per-instance and interactive** (2026-09-09,
   Chrome): the Local State `user-enabled` flag arms the browser, but the
   FIRST attach after launch enters `handshake-wait` until a human clicks
   Allow — the harness waits indefinitely, so client-side call budgets expire
   first (our first existing-browser attempt timed out at 180 s mid-approval).
   A COLD browser reports `remote debugging is turned off for this browser
   instance` even with the flag on: the per-instance approval only exists in
   a running browser. Hosts must budget for the interactive approval on first
   attach (or drive it via the §84 flow) and treat cold+flag-on as the
   instance-level diagnostic, not as attachable.

## Pending evidence required for 1.0.0 release

- [x] **Google Chrome / Windows 11 required matrix — PASS 2026-09-09**:
      existing-browser; cold-start prerequisite-off (current-SHA re-proof)
      and prerequisite-on; real OK/ERR sentinel paths;
      remote-debugging-disabled.
- [ ] **Browser smoke dated PASS** — Google Chrome / Windows 11 (suite:
      `tests/browser/smoke.test.mjs` — navigation, AX observation,
      click/type/press/scroll, screenshot, task-tab cleanup; needs an
      attachable target) and, later, Chromium on its dedicated environment.
- [x] **Microsoft Edge / Windows 11 additional qualification — PASS
      2026-09-09**: existing-browser; cold-start prerequisite-on
      (`chrome-not-running` diagnostic); real OK/ERR sentinel paths.
- [ ] **Chromium required matrix** (frozen V1 scope): all five scenarios on a
      Chromium install. A dedicated machine/profile is strongly recommended —
      Chrome closed with its flag off, Edge closed with its flag off, only
      Chromium participating — to sidestep the Windows chrome.exe name
      ambiguity between Chrome and Chromium.
- [ ] macOS qualification incl. the mac-approve product-diagnostics path (§63).
- [ ] Linux, per the claimed platform matrix.
- Note: the launch-automation cold-start path remains unqualified everywhere
      (never observed on Windows; only provable where a harness launch
      actually occurs).
