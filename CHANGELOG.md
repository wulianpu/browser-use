# Changelog

## 1.0.0 — 2026-09-08

Initial release, implementing the frozen V1 baseline (`Browser Use Agent Plugin.md`).

- Agent Plugins 1.0.0 packaging: `plugin.json` + `mcp.json` + `skills/browser-use/SKILL.md`.
- Official Browser Use runtime via `uvx --python 3.12 browser-use@0.13.10 --cli-mcp` (stdio).
- `PLUGIN_DATA` containment (`BH_HOME`, `BH_AGENT_WORKSPACE`, `cwd`), telemetry/recordings/
  domain-skills/tab-marker disabled by default.
- Skill synced from upstream `browser-use/browser-use` (blob `d47beef3…`) with only the three
  allowed adaptation classes: portable frontmatter, host security policy, V1 product scope.
- `upstream.lock.json` provenance (pyproject `5c79c94f…`, official plugin `.mcp.json`
  `fcaab790…`, official skill `d47beef3…`); Browser Harness baseline 0.1.13.
- Test suites: manifest, pin/upstream, environment containment, permissions, secret isolation,
  no-replay, concurrency single-flight, output budget, agent-helper quarantine, namespace
  isolation, live MCP contract (snapshot-gated), browser smoke + qualification (opt-in).
- Verification gates: `scripts/verify-upstream.mjs`, `scripts/verify-runtime-contract.mjs`.
