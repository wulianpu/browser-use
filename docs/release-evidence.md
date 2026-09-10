# Release Evidence

Auditable record for the completed `browser-use@1.0.0` release decision.
All three release gates are closed below with their supporting evidence
(dated PASS entries naming the commit SHA each run executed against).

## Gate 0 — suite and verification gates (record runs here)

| Date | Commit | Command | Result |
| --- | --- | --- | --- |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `npm ci` | PASS (5 packages) |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `npm test` (full default mode, one command: runtime tests real, browser-gated tests skip with reasons) | PASS — 15/15 test files |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `node scripts/verify-runtime-contract.mjs` | PASS — contract matches snapshot, runtime 0.13.10 |
| 2026-09-09 | `d5e9f3be12522b4972160df4abf5514081d24a53` | `node scripts/verify-upstream.mjs` | PASS — lock matches live upstream |
| 2026-09-10 | `12f4034fc0710c3bdd72e9a62285fc47ff013257` | `npm ci` | PASS (5 packages) |
| 2026-09-10 | `12f4034fc0710c3bdd72e9a62285fc47ff013257` | `npm test` (full default mode) | PASS — 15/15 test files |
| 2026-09-10 | `12f4034fc0710c3bdd72e9a62285fc47ff013257` | `node scripts/verify-runtime-contract.mjs` | PASS — contract matches snapshot, runtime 0.13.10 |
| 2026-09-10 | `12f4034fc0710c3bdd72e9a62285fc47ff013257` | `node scripts/verify-upstream.mjs` | PASS — lock matches live upstream |

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

## Gate 2 — real-Host integration proof — CLOSED (2026-09-10)

Host: **agent-plugin-host** — local repository at
`C:/Users/WuLianpu/Workspace/ai/agent-plugin-host` (remote pending; SHA verifiable
on this machine and via the source bundle below), commit `f2f2ba74ce575e7196876407aaa38f709267ea1e` —
"Implement real Agent Plugin Host acceptance suite". Built with Codex
(glm-5.3) against a frozen TASK.md spec that ports the reference contract
(hostPolicy / referenceHostRuntime / mcpClient / runtime semantics); the plugin
repository was referenced READ-ONLY and verified untouched after the build
(git clean, in sync with origin/main).

Acceptance run (2026-09-10): `node --test` in the host repository —
**11/11 test files PASS, 0 failures, 0 skips**, independently re-executed by
the plugin repo maintainer rather than relying on the builder's self-report:

- [x] `local.code-execution` authorization — tests/authorization.test.mjs
- [x] environment sanitization — tests/env-sanitization.test.mjs
- [x] input/output bounds (128 KiB source / 1 MiB wrapped / 1 MiB UTF-8-safe text / 16 MiB image) — tests/bounds.test.mjs
- [x] single-flight — tests/single-flight.test.mjs
- [x] textual `browser_exec` failure classification (dual-sentinel, shadowing-proof) — tests/textual-classification.test.mjs
- [x] unknown-effects handling (user-code exception → inspect before retry; pre-exec → known-failed) — tests/unknown-effects.test.mjs
- [x] timeout → poison → fresh-process recovery — tests/timeout-poison-recovery.test.mjs
- [x] task-boundary recycle (fresh MCP per task, namespace isolation) — tests/task-recycle.test.mjs
- [x] workspace sanitation (symlink-safe, credential-free retention, fail-closed) — tests/workspace-sanitation.test.mjs
- [x] Browser Harness daemon lifecycle (finding #8) — tests/daemon-lifecycle.test.mjs,
      REAL uvx runtime with a stable per-instance BH_HOME: each task receives a
      fresh MCP process identity; sequential recycle does not accumulate daemons;
      at most one daemon owns the BH_HOME; teardown via the scoped official
      `--reload` leaves no owned orphan.
- [x] bonus: integration-plugin-load.test.mjs — loads the REAL plugin (read-only),
      spawns the real MCP server, passive initialize + tools/list contract,
      graceful stop.

Auditable artifacts (in this repository):
- run log: `docs/evidence/gate2-host-acceptance-2026-09-10.log` (the 11/11 acceptance run,
  independently re-executed 2026-09-10);
- source: `docs/evidence/agent-plugin-host-f2f2ba7.bundle` (git bundle of the host
  repository at `f2f2ba7` — `git clone agent-plugin-host-f2f2ba7.bundle` reproduces the
  exact audited source).

Backlink: this file is the release-side record; the host repository carries the
implementation and its own README mapping the ten items.
## Release decision

- [x] Gate 0 re-run at final commit (2026-09-10 @ 12f4034; the release commit adds only release documentation on top)
- [x] Gate 1 PASS (2026-09-10, Windows 11 scope — Chrome + Chromium required matrices, Edge additional)
- [x] Gate 2 PASS (2026-09-10, agent-plugin-host @ f2f2ba7)
- [x] `v1.0.0` tagged; CHANGELOG `[Unreleased]` → `1.0.0 — 2026-09-10`
