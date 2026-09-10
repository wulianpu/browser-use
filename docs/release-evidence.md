# Release Evidence

Auditable record for the `browser-use@1.0.0` release decision. The two open
gates mirror the review verdict: browser qualification and real-Host
integration. Checkbox semantics: an item closes only with a dated PASS entry
naming the commit SHA it was run against.

## Gate 0 — suite and verification gates (record runs here)

| Date | Commit | Command | Result |
| --- | --- | --- | --- |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `npm ci` | PASS (5 packages) |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `npm test` (full default mode, one command: runtime tests real, browser-gated tests skip with reasons) | PASS — 15/15 test files |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `node scripts/verify-runtime-contract.mjs` | PASS — contract matches snapshot, runtime 0.13.10 |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `node scripts/verify-upstream.mjs` | PASS — lock matches live upstream |

Note: CI runs these as separate jobs (static with `BROWSER_USE_SKIP_RUNTIME=1`,
plus the runtime-contract job); the table above records the single-shot full
run that CI does not perform. The README checkbox for this gate closes at the
formal release-evidence stage — re-run the sequence at the final commit and
append the row here.

## Gate 1 — browser qualification

Scenario matrix and run log live in
[`qualification-evidence.md`](qualification-evidence.md). Current summary
(2026-09-09, owner decision extended the qualified matrix to include
Microsoft Edge):

- PASS — Windows 11 / Google Chrome (frozen-scope REQUIRED browser) —
  full required matrix: existing-browser; cold-start OFF (current-SHA
  re-proof) + ON; real OK/ERR sentinel paths (strict mode verified);
  remote-debugging-disabled (§84 flow-trigger evidence); browser smoke.
- PASS — Windows 11 / Chromium (frozen-scope REQUIRED browser) — full
  required matrix (all six families) in a dedicated environment
  (Chrome/Edge closed with flags off): existing-browser; cold-start
  OFF + ON; real OK/ERR sentinel paths (strict mode); browser smoke;
  remote-debugging-disabled.
- PASS — Windows 11 / Edge (ADDITIONAL qualified browser, owner-approved
  2026-09-09): existing-browser; cold-start ON; real OK/ERR paths.
  Launch-automation not observed on Windows for any browser.
- PASS — Windows 11 (earlier, flag-off machine state): cold-start OFF;
  real pre-exec failure classification.
- Platform scope DECISION (owner, 2026-09-10): **1.0.0 claims Windows 11 only.**
  macOS/Linux qualification (incl. the macOS mac-approve product-diagnostics flow)
  moves to post-1.0.0 targets and is not a Gate-1 blocker for this release.
  GitHub workflow_dispatch qualification runs: 0 (all evidence above is local
  controlled runs with reproduction commands — accepted as evidence).
- Evidence type: local controlled runs recorded above (with reproduction
  commands and per-target browser identity); GitHub workflow_dispatch
  qualification runs: 0.

- [x] All scenarios dated-PASS on the claimed platform matrix (Windows 11, per the 2026-09-10 owner scope decision). **GATE 1 CLOSED.**

## Gate 2 — real-Host integration proof

The reference contract (`tests/helpers/hostPolicy.mjs`,
`tests/helpers/referenceHostRuntime.mjs`) must be implemented/reused in the
actual Agent Plugin Host and the same contract acceptance verified there.
No evidence exists in this repository yet.

Required in the real Host:

- [ ] `local.code-execution` authorization (exec denied without it)
- [ ] environment sanitization (host secrets invisible to the subprocess)
- [ ] input/output bounds (128 KiB source / 1 MiB wrapped / 1 MiB text / 16 MiB image)
- [ ] single-flight (one logical browser task per runtime)
- [ ] textual `browser_exec` failure classification (sentinel scheme or equivalent)
- [ ] unknown-effects handling (user-code exception → inspect before retry)
- [ ] timeout → poison → fresh-process recovery
- [ ] task-boundary recycle (no cross-task namespace/state)
- [ ] workspace sanitation (symlink-safe, credential-free retention)
- [ ] Browser Harness daemon lifecycle (finding #8): with a stable
      per-instance BH_HOME, sequential MCP task recycle does not
      accumulate daemons — the next MCP process either reuses the healthy
      daemon or replaces an unhealthy one deterministically; browser
      state remains inspectable across the recycle; no cross-security-
      context daemon reuse; plugin-instance teardown leaves no owned
      orphan daemon. (Task boundary recycles the MCP process and the
      Python namespace; the daemon itself MAY stay long-lived — it must
      not fan out unboundedly.)

Evidence format: host repository + commit SHA implementing the contract, the
acceptance run log, and a pointer from this file.

## Release decision

- [ ] Gate 0 re-run at final commit
- [ ] Gate 1 PASS
- [ ] Gate 2 PASS
- [ ] `v1.0.0` tagged; CHANGELOG `[Unreleased]` → `1.0.0 — <date>`
