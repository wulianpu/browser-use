# Changelog

## 1.0.0 — 2026-09-08

Initial release, implementing the frozen V1 baseline (`Browser Use Agent Plugin.md`).

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
