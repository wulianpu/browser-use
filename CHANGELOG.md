# Changelog

## [Unreleased]

Target release: **1.0.0** — not yet released. The date and this heading change to
`## 1.0.0 — <date>` only when the release gates in README.md pass (browser
qualification matrix + real-Host integration proof) and `v1.0.0` is actually
tagged. No GitHub Release exists yet.

Initial implementation of the frozen V1 baseline (`Browser Use Agent Plugin.md`).

### Workflow YAML fix + follow-up target attribution (2026-09-09, post-review)

- P0: the dynamic runner label broke YAML parsing (unquoted ${{ }} inside
  a flow-style sequence — the push run created zero jobs). Now quoted:
  runs-on: [self-hosted, "${{ inputs.qualification-browser || 'chrome' }}"].
- P1: the smoke and real-sentinel follow-up suites now perform a
  target-browser identity preflight when BROWSER_USE_QUALIFICATION_BROWSER
  is explicitly set (new tests/helpers/targetPreflight.mjs): no competing
  browser interference, target running, endpoint attributable by
  listening-process ownership. A runner label is a scheduling constraint,
  not a runtime identity proof — without this, a chromium-labeled run on
  a machine where Chrome happened to be attachable could record the wrong
  evidence. The sentinel workflow step now passes the browser target too.
  Local/default runs stay browser-agnostic; the reference-host contract
  itself is unchanged.

### Qualification job isolation + runner labels (2026-09-09, post-review)

- P1: the manual qualification job no longer runs the whole suite. The
  selected scenario runs as an isolated single file
  (node --test tests/browser/qualification.test.mjs) — the Node runner's
  default file concurrency would otherwise run smoke + reference-host
  real-runtime suites against the same browser mid-scenario, breaking the
  controlled-prerequisite / dedicated-target / no-competing-endpoint
  assumptions. Browser smoke and real sentinel paths are separate,
  explicitly selected serial follow-up steps (run-smoke / run-sentinel
  workflow inputs); the ordinary suite stays in push CI / Gate 0.
- P2: the self-hosted runner label now matches the target browser
  (chrome|chromium|edge), so a dedicated Chromium runner is never handed
  a chrome run.
- Evidence checklist gains the browser-smoke dated-PASS item (Chrome +
  Chromium) — the suite exists but had no recorded evidence entry.

### Qualification runner audit semantics + workflow browser selector (2026-09-09)

- P1: a SELECTED scenario that goes INCONCLUSIVE mid-run now fails with a
  QUALIFICATION-INCONCLUSIVE assert instead of t.skip — a green
  qualification job always means the contract was proved (previously the
  process could exit 0 on an inconclusive selected scenario, letting a
  manual CI job show success without evidence). Skip remains only for
  not-selected scenarios.
- P1: workflow_dispatch gains a qualification-browser choice
  (chrome|chromium|edge, default chrome) wired to
  BROWSER_USE_QUALIFICATION_BROWSER; the job name shows browser /
  scenario. Required for the upcoming Chromium matrix runs.
- P2: qualification-evidence pending checklist synced with the matrix
  (Chrome required matrix checked complete; Chromium/macOS/Linux remain).

### Chrome required matrix complete on Windows 11 (2026-09-09)

- remote-debugging-disabled PASS (chrome): §84 flow-trigger evidence within
  the bounded window against a running, flag-disabled Chrome — the last
  unproven scenario family for the required browser.
- cold-start OFF re-proof at current SHA PASS (chrome): browser stayed
  cold; bounded actionable diagnostic in tool text and daemon log (now
  instance-level wording vs the 2026-09-08 profile-scan wording — recorded
  honestly).
- Google Chrome required matrix on Windows 11 now complete:
  existing-browser, cold-start OFF + ON, real OK/ERR sentinel paths,
  remote-debugging-disabled. Remaining Gate 1: Chromium matrix,
  macOS/Linux per claimed platform matrix.

### Chrome core matrix PASS + endpoint attribution by process owner (2026-09-09)

- Google Chrome (frozen-scope required browser) core paths qualified on
  Windows 11: existing-browser (tab preservation; pre-existing tab seeded
  because a fresh instance only had chrome://newtab), cold-start
  prerequisite-on (browser stays cold + the harness's instance-level
  "remote debugging is turned off for this browser instance" diagnostic,
  two consistent runs), and real OK/ERR sentinel paths (reference-host
  15/15 on Chrome).
- Evidence-driven probe fix: modern Chrome returns HTTP 404 for
  /json/version, and a stale DevToolsActivePort file can name a port now
  owned by ANOTHER browser — endpoint attribution now resolves the
  LISTENING socket's owning process (netstat → PID → image), correctly
  crediting 9222 to chrome.exe and rejecting Edge's stale file.
- Behavioral finding #6 recorded: remote-debugging approval is per-instance
  and interactive — first attach waits for the human Allow click (our first
  attempt expired its 180 s budget mid-approval); a cold browser reports
  the instance-turned-off notice even with the Local State flag enabled.
- Remaining for Gate 1: Chrome-targeted cold-start OFF re-proof at current
  SHA, Chromium matrix, remote-debugging-disabled, macOS/Linux.

### Qualification identity isolation + cold-start tightening (2026-09-09, post-review)

- Browser identity is now targeted, not aggregated:
  BROWSER_USE_QUALIFICATION_BROWSER selects chrome | chromium | edge; every
  probe (process / debugging state / endpoint) is evaluated for that browser
  only, and an identity guard rejects interference from other qualified
  browsers — live DevTools endpoints (attach theft) AND persisted
  user-enabled debugging flags. The latter is evidence-backed: with every
  browser closed, Edge's enabled flag plus its stale DevToolsActivePort file
  made the harness dial the dead port and surface an approval-flow error
  during a chrome-targeted run (behavioral finding #5).
- cold-start qualifying outcomes tightened: PASS requires (A) the browser
  STAYS cold plus its per-prerequisite diagnostic, or (B) navigation plus
  harness-log launch attribution (navigation alone cannot credit the launch).
  Approval-flow outcomes (external/self restart or stale-endpoint metadata)
  are INCONCLUSIVE, recorded as auxiliary §84 evidence — never a cold-start
  PASS.
- Chrome cold-start OFF at the current SHA: first attempt INCONCLUSIVE due
  to Edge's persisted flag; the re-proof remains pending until Edge's
  debugging flag is disabled (or a dedicated machine is used).
- release-evidence.md duplicate line removed; scenario wording is
  target-specific.

### Qualification regression fix + scope correction (2026-09-09, post-review)

- P0 regression: the merged cold-start diagnostic contract broke the
  prerequisite-OFF branch (its diagnostic vocabulary — DevToolsActivePort /
  enable-chrome://inspect — was gated behind a harness-log match for
  chrome-not-running, which the OFF path never emits). Restored per-state
  branches: navigation-success → launch path; flag-enabled failure →
  chrome-not-running / start Chrome; flag-disabled failure →
  DevToolsActivePort / chrome://inspect. Each state asserts its own
  vocabulary; push CI cannot catch this (browser tests skip there).
- Third observed cold-start-ON outcome recorded: after a force-kill, Edge
  self-relaunched with the flag and the harness entered the interactive
  approval flow (handshake-wait → permission-blocked, bounded, no retry) —
  the §84 approval path firing for real. ON vocabulary widened accordingly.
- Scope wording corrected to frozen Option A: Google Chrome + Chromium are
  the REQUIRED qualification matrix (evidence pending; Gate 1 cannot close
  without them); Microsoft Edge is an owner-approved ADDITIONAL qualified
  browser on Windows 11 — not a substitute for the Chrome/Chromium matrix.
  README/SKILL/evidence docs aligned.
- Stale cold-start comments updated (launch claim → observed platform
  contract).

### Qualification progress (2026-09-09)

- Owner decision extended the V1 qualified browser matrix to include
  Microsoft Edge; the qualification probe now covers msedge.exe and the
  Edge profile directory (README/SKILL scope wording updated).
- Real evidence recorded: existing-browser PASS against the running Edge
  with real user tabs (task tab created/verified/closed; pre-existing tabs
  preserved, compared in memory); real OK-sentinel success and real
  user-code-exception ERR-sentinel paths verified on the attachable Edge
  (reference-host suite 15/15).
- Remaining: remote-debugging-disabled, Google-Chrome/Chromium runs if
  claimed, macOS/Linux matrix.
- Qualification finding (freeze-policy exception, upstream behavior vs
  assumption): on Windows the harness never auto-launches a not-running
  browser — with the prerequisite satisfied it fails fast with the
  bounded `chrome-not-running` diagnostic (two controlled runs, Edge
  confirmed dead before/after). SKILL/troubleshooting updated to the
  observed contract; the cold-start scenario asserts launch-or-diagnostic
  and the evidence records which occurred. PASS recorded for the
  diagnostic contract; the launch-automation path remains unqualified.

- Agent Plugins 1.0.0 packaging: `plugin.json` + `mcp.json` + `skills/browser-use/SKILL.md`.
- Official Browser Use runtime via `uvx --python 3.12 browser-use@0.13.10 --cli-mcp` (stdio).
- `PLUGIN_DATA` containment (`BH_HOME`, `BH_AGENT_WORKSPACE`, `cwd`), telemetry/recordings/
  domain-skills/tab-marker/cloud-sync disabled by default.
- Skill synced from upstream `browser-use/browser-use` (blob `d47beef3…`) with only the three
  allowed adaptation classes: portable frontmatter, host security policy, V1 product scope.
- `upstream.lock.json` provenance (pyproject `5c79c94f…`, official plugin `.mcp.json`
  `fcaab790…`, official skill `d47beef3…`); Browser Harness baseline 0.1.13.
- Test suites: manifest (real JSON Schema validation via ajv against vendored official
  schemas), pin/upstream, environment containment, permissions, secret isolation, no-replay,
  concurrency single-flight, output budget, agent-helper quarantine, namespace isolation,
  reference-host composition, live MCP contract (snapshot-gated), browser smoke, and
  scenario-driven qualification (existing-browser / cold-start / remote-debugging-disabled
  with hard precondition asserts and no real-URL logging).
- Verification gates: `scripts/verify-upstream.mjs` (drift + browser-harness pin + schema
  drift), `scripts/verify-runtime-contract.mjs` (live MCP contract vs. snapshot).

### Release hardening round 7 (post-review)

- P1: parent-directory symlinks close the last sanitation gap —
  ensureRealDirectory() requires agent-workspace and quarantine to be real
  non-symlink directories (lstat-based, fail-closed: missing → create +
  re-verify; anything else aborts preparation), so a swapped parent can no
  longer redirect sanitation unlinks or quarantine/metadata writes outside
  PLUGIN_DATA.
- P2: wrapper instrumentation is now transient and collision-proof — the
  emitter function is nonce-named per call, and __bu_* names are popped from
  the persistent namespace after the call (the runner catches BaseException,
  so cleanup always executes; a user's own __bu_run variable is untouched).
  Verified by new Python-executed tests. Accepted residual (post-1.0
  polish): __bu_b/__bu_sys/__bu_tb are fixed adapter-private names —
  pre-existing agent values under those exact names are overwritten and
  removed, not restored.
- P2: input-bound wording made precise — 128 KiB applies to the
  agent-provided source; the dispatched wrapped payload carries its own
  1 MiB defense-in-depth cap (worst-case JSON escaping of in-bounds source
  stays well under it, covered by a new test).

### Release hardening round 6 (post-review)

- P0 correctness: sentinel instrumentation no longer depends on names shared
  with user code. Ordinary shadowing (`print = lambda *a: None`, reassigning
  exec/compile/BaseException) previously swallowed sentinel output, making a
  succeeded or side-effecting call classify as "pre-exec failure" — the exact
  known-failed/unknown-effects confusion the classification exists to
  prevent. Emitters now live inside __bu_run(), whose default arguments
  capture exec/compile/globals()/BaseException/print/traceback/stdout at
  definition time; persistent-namespace semantics are unchanged. Verified by
  new Python-executed wrapper unit tests (shadowing on success, on raise,
  from an earlier call; namespace persistence; per-call nonce uniqueness).
- Workspace sanitation fail-closed: artifactKind treats only ENOENT/ENOTDIR
  as absent — EACCES/EPERM/EIO/… propagate so a task never starts on a
  workspace that could not be inspected.
- TOCTOU guard: the quarantine destination is re-verified after rename;
  anything but a regular single-link file is unlinked and downgraded to a
  metadata-only record.
- README "Helper quarantine" bullet renamed to "Workspace sanitation" with
  the current semantics.

### Release hardening round 5 (post-review)

- P0 reliability: user-code exceptions no longer classify as "known-failed".
  Outcome now tracks the failure class — pre-exec runtime failures and MCP
  errors (user code never started) are known-failed and safe to retry after
  diagnosis; user-code exceptions are "unknown-effects" (the code ran,
  possibly mutated the browser, then raised) with replay forbidden and
  inspect-before-retry as the only guided next step. Transport stays usable
  for the inspection.
- Workspace sanitation is now symlink/hardlink-safe: lstat-based
  classification (never follows links, catches broken symlinks), plain
  unlink instead of "secure erase" (no physical-erasure claim; encrypted
  PLUGIN_DATA is the host's lever), readable quarantine only for regular
  files with nlink == 1, metadata-only records for everything removed.
- Sentinel trust model corrected in code and docs: per-call nonces are
  collision-resistant reliability instrumentation for trusted agent code,
  not an adversarial security boundary (arbitrary Python shares the
  interpreter and could tamper with its own reporting).
- Release checklist's real-Host gate expanded to the full contract list
  (textual exec classification, unknown-effects handling, workspace-state
  sanitation included); skill teaches the unknown-effects rule; evidence
  doc lists the real success/user-exception sentinel paths as pending
  until an attachable-browser run exists.

### Release hardening round 4 (post-review)

- P0: the reference host no longer classifies textual runtime failures as
  success. browser_exec now wraps agent code with unpredictable per-call
  OK/ERR sentinels (plain Python through the official tool; persistent
  namespace preserved via exec(compile(...), globals(), globals())) and
  classifies three ways: OK sentinel → success; ERR sentinel →
  BROWSER_USE_EXEC_FAILED (user-code exception, transport stays usable);
  neither → BROWSER_USE_EXEC_FAILED (pre-exec runtime/daemon failure such as
  "daemon didn't come up"). isError=true results are failures too. Validated
  against the real browser-use@0.13.10 runtime.
- BROWSER_USE_EXEC_FAILED added to the stable error contract (policy, skill,
  troubleshooting, tests).
- cold-start qualification rejects an "unknown" remote-debugging state
  instead of silently treating it as the disabled branch.
- agent-workspace/.env leftovers are securely deleted (overwrite + unlink)
  with metadata-only records — quarantined text may not retain credentials;
  agent_helpers.py remains quarantined for diagnostics.
- README host-integration gate now includes textual exec-failure
  classification; qualification-evidence.md wording corrected (output
  bounding alone does not classify failures).

### Release hardening round 3 (post-review)

- Qualification probes: remote-debugging state is now tri-state
  (enabled/disabled/unknown — only a determined "disabled" satisfies the
  scenario precondition) and profile discovery covers Chromium alongside
  Google Chrome.
- remote-debugging-disabled scenario redesigned: instead of waiting out a
  browser_exec timeout (upstream returns harness exceptions as ordinary text
  and intentionally waits for user approval), it now proves within a bounded
  window that the official permission flow was triggered (MCP stderr /
  harness state under PLUGIN_DATA), with optional interactive completion via
  BROWSER_USE_QUALIFICATION_APPROVE=1.
- cold-start scenario encodes the evidence-based dual outcome: with the
  debugging prerequisite satisfied the harness must launch and navigate;
  without it, it must surface the documented enable-chrome://inspect
  diagnostic (tool text or daemon log).
- Real qualification evidence started: docs/qualification-evidence.md records
  the first PASS (cold-start prerequisite-off branch, Windows 11,
  browser-use 0.13.10) plus three host-relevant behavioral findings —
  browser_exec failures arrive as text with isError=false; the actionable
  diagnostic lives in the daemon log under PLUGIN_DATA; browser auto-launch
  is conditional on the debugging prerequisite. SKILL.md and
  troubleshooting.md corrected accordingly (also restores the Chromium-family
  scope wording lost to an intermediate checkout).
- CI Actions bumped to current majors, full-SHA pinned: checkout v7.0.1,
  setup-node v7.0.0, setup-uv v10.0.1.

### Release hardening round 2 (post-review)

- Windows CI: manifest frontmatter parsing tolerates CRLF checkouts; `.gitattributes`
  normalizes the repo to LF.
- Browser qualification workflow installs dev dependencies (`npm ci`) before
  the full suite.
- Fixed the existing-browser scenario comparing against a tab-less cleanup
  output; it now lists tabs in a dedicated post-cleanup call.
- Remote-debugging precondition now follows the harness's own signals
  (Local State `devtools.remote_debugging.user-enabled` + live
  DevToolsActivePort) instead of assuming port 9222.
- Reference host: a timeout/transport failure now poisons the transport (MCP
  process stopped immediately, further calls rejected) with explicit
  `task.recover()` on a fresh process (§59); every `browser_exec` is treated
  as side-effect-possible — agents cannot declare calls read-only.
- `prepareExecutionContext` also quarantines `agent-workspace/.env` (the
  harness auto-loads it into the next task's environment).
- Skill/README state the browser scope honestly: Browser Use drives local
  Chromium-family browsers, V1 qualification covers Chrome/Chromium only.

### Release hardening (post-review)

- Publisher/license/repository finalized: WuLianpu, MIT, github.com/wulianpu/browser-use.
- `BROWSER_USE_INPUT_TOO_LARGE` added to the stable error contract (policy, skill,
  troubleshooting, tests).
- Fixed UTF-8 output truncation to back up over partial characters (no U+FFFD; byte budget
  holds after re-encoding).
- Runtime tests can no longer skip implicitly: missing `uvx` fails the suite unless
  `BROWSER_USE_SKIP_RUNTIME=1` is set explicitly.
- Qualification tests assert scenario preconditions, close their own task tab, and never
  write real tab URLs into logs or assertion messages.
- Added the composed reference host wrapper (`referenceHostRuntime`) plus composition tests.
- CI hardening: read-only token, Actions pinned to full commit SHAs, no persisted
  credentials, scenario input for the manual qualification job.
- `verify-upstream.mjs` now also verifies the `browser-harness==0.1.13` pin inside the
  browser-use pyproject and the vendored Agent Plugins schemas against agent-plugins.org.
