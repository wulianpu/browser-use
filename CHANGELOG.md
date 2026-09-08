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
