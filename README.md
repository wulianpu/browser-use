# browser-use — Agent Plugins v1 adapter for the official Browser Use runtime

`browser-use` is a thin, spec-compliant [Agent Plugins v1](https://agent-plugins.org) packaging of the
**official Browser Use CLI/MCP runtime**. It does not implement a browser runtime, does not fork
Browser Use, does not implement CDP, and does not provide a second browser agent. It only packages
the official runtime and the usage guidance around it.

> **Runtime upstream:** [Browser Use](https://github.com/browser-use/browser-use) (pinned `0.13.10`, Python 3.12)
> **Portable Agent Plugin adapter maintainer:** `<ACTUAL_PLUGIN_PUBLISHER>` — fill before publishing (see [Release checklist](#release-checklist))
>
> This plugin is **not** published by the Browser Use team. It is an independent adapter of the
> official `.mcp.json` launch line (`uvx --python 3.12 browser-use@<pin> --cli-mcp`).

## Architecture

```text
Agent
  ▼
Agent Plugin Host            ← authorization / isolation / lifecycle / bounds
  ▼
browser-use Plugin
  ├── plugin.json            ← Agent Plugins 1.0.0 manifest
  ├── mcp.json               ← stdio MCP server declaration
  └── skills/browser-use/SKILL.md
  ▼  MCP stdio
uvx --python 3.12 browser-use@0.13.10 --cli-mcp
  ▼
Browser Use Official MCP
  ├── browser_exec           ← Python execution + Browser Harness + CDP
  └── browser_screenshot     ← image capture
  ▼
Browser Harness → CDP → local Chrome / Chromium
```

Runtime core is exactly three files: `plugin.json`, `mcp.json`, `skills/browser-use/SKILL.md`.
`upstream.lock.json` is a provenance/development artifact — it does not define runtime semantics.

## Ownership model (do not violate)

| Layer | Owns |
| --- | --- |
| Browser Use (upstream) | browser automation: harness, CDP, Chrome lifecycle, tabs, MCP server |
| this plugin | packaging + version pinning + usage guidance |
| Agent Host | trust, authorization, secret isolation, process lifecycle, timeout, output bounds, security-context isolation |
| Agent | reasoning + browser task strategy |

Any contribution that adds a CDP layer, browser driver, tab manager, provider abstraction, or
`browser_click`-style wrapper tools will be rejected in architecture review.

## What the Agent Host must provide

The plugin intentionally stays thin; the following are **host obligations**, with an executable
reference implementation in [`tests/helpers/hostPolicy.mjs`](tests/helpers/hostPolicy.mjs):

- **Authorization (§25):** `browser_screenshot` → `browser.observe`; `browser_exec` →
  `browser.interact` + `browser.debug` + `local.code-execution`. Without
  `local.code-execution`, `browser_exec` must be denied. Per-browser-action permissions are
  **not achievable** with this runtime (see Security below) — V1 accepts that.
- **Sanitized base environment (§28/§29):** the subprocess env must be allowlist-based.
  Host secrets (`OPENAI_API_KEY`, `AWS_*`, `GITHUB_TOKEN`, `*_TOKEN`, …) must never be inherited.
- **`PLUGIN_ROOT` / `PLUGIN_DATA` (§4/§17/§18):** provide both to the subprocess; `PLUGIN_DATA` is
  per-instance, writable, persistent across updates. All Browser Harness state is contained there
  via `BH_HOME`/`BH_AGENT_WORKSPACE`.
- **Lifecycle (§32-§38):** lazy start on first tool need; passive health = `initialize` +
  `tools/list` only (never auto-open Chrome); one logical browser task per MCP process
  (`browser_exec`'s Python namespace persists across calls); recycle the process at task
  boundaries; single-flight for concurrent tasks (`BROWSER_USE_BUSY` or queue).
- **Bounds (§55-§57):** `browser_exec` ≤ 300 s default / 1 800 s max, code ≤ 128 KiB, textual
  output ≤ 1 MiB, screenshots ≤ 16 MiB (`BROWSER_USE_RESULT_TOO_LARGE`).
- **Unknown outcome (§58-§60):** after timeout/disconnect/crash of a possibly-mutating call →
  outcome unknown, **never auto-replay**; recover, inspect page state, then decide.
- **Helper quarantine (§41):** before a new independent execution context, quarantine
  `${PLUGIN_DATA}/agent-workspace/agent_helpers.py` (persistent self-modifying helpers are out of scope).
- **Error contract (§75):** map failures to the stable `BROWSER_USE_*` codes; never surface raw
  Python tracebacks as the business API.
- **Uninstall:** remove only `PLUGIN_ROOT` and `PLUGIN_DATA`. The user's Chrome profile is never touched.

## Security model

- `browser_exec` **is local code execution** (it ultimately runs `exec(code, ns)` in a local Python
  process with CDP access). It must be authorized and audited as such. This plugin must never be
  described as a "browser-only sandbox" (§30).
- SKILL.md adds behavioral policy (no sensitive-file access, no unrelated subprocesses, no
  filesystem scans, no unrelated localhost services), but **a skill is not a sandbox** — the real
  boundary is the host (§27).
- Telemetry is disabled by default (`BH_TELEMETRY=false`, `BROWSER_HARNESS_TELEMETRY=false`,
  `ANONYMIZED_TELEMETRY=false`), recordings disabled (`BH_RECORD=0`), domain skills disabled
  (`BH_DOMAIN_SKILLS=0`), tab-title marker disabled (`BH_TAB_MARKER=0`).
- Browser Use Cloud is out of scope: no `BROWSER_USE_API_KEY`, no remote daemons (§64).
- macOS `mac-approve` is not an agent tool; route it through product diagnostics (§63).

## Supply chain

The runtime resolves via `uvx` from the package registry on first use (network required; slow
first start is expected). The pin is exact — `browser-use@0.13.10` — so one PluginRevision always
maps to one runtime. `@latest` is forbidden and CI-enforced. Runtime upgrades require a **new
plugin revision** with reviewed `upstream.lock.json` + skill sync + contract re-qualification (§72).

Upstream provenance currently locked in [`upstream.lock.json`](upstream.lock.json):

| Identity | Ref | Blob SHA |
| --- | --- | --- |
| `browser-use` pyproject.toml | tag `0.13.10` | `5c79c94f…` |
| `browser-use/plugins` `browser-use/.mcp.json` | `main` | `fcaab790…` |
| `browser-use/browser-use` `skills/browser-use/SKILL.md` | `main` | `d47beef3…` |

## Repository layout

```text
plugin.json                     Agent Plugins 1.0.0 manifest (runtime core)
mcp.json                        stdio MCP declaration (runtime core)
upstream.lock.json              reviewed upstream provenance (dev artifact)
skills/browser-use/SKILL.md     synced from upstream + V1 policy (runtime core)
skills/browser-use/references/troubleshooting.md
tests/
  manifest/  upstream/  security/  mcp/  browser/   (node:test suites)
  helpers/   mcpClient / runtime launcher / host policy reference
scripts/
  verify-upstream.mjs           upstream drift + pin consistency gate
  verify-runtime-contract.mjs   live MCP contract vs. snapshot gate
README.md  CHANGELOG.md  LICENSE  THIRD_PARTY_NOTICES.md
```

## Development

Requires Node ≥ 16.17 (`node --test`), `uv`/`uvx` for runtime tests, and network access for the
first runtime resolution.

```bash
npm test                        # full suite (runtime tests run for real — §80)
BROWSER_USE_SKIP_RUNTIME=1 npm test   # static-only (manifest, pins, security policy, budget)
node scripts/verify-runtime-contract.mjs      # live MCP contract vs. snapshot (§70)
node scripts/verify-upstream.mjs             # upstream drift + pin consistency (§71)
node scripts/verify-runtime-contract.mjs --update   # only during a reviewed upgrade
```

Test gating:

| Env var | Effect |
| --- | --- |
| `BROWSER_USE_SKIP_RUNTIME=1` | skip everything that spawns the runtime |
| `BROWSER_USE_BROWSER_TESTS=1` | also run tests that call `browser_exec` (may start the harness daemon and attach/launch Chrome — §35) |
| `BROWSER_USE_QUALIFICATION=1` | also run interactive qualification against the user's real Chrome (§82-§84) |

CI (`.github/workflows/ci.yml`): static suite on Ubuntu + Windows; live contract test with uv
installed; upstream drift check as a non-blocking review hint; browser qualification as a manual
`workflow_dispatch` job for a Chrome-equipped runner.

## Upstream upgrade flow (§72)

1. `node scripts/verify-upstream.mjs` reports `UPSTREAM_BROWSER_USE_CHANGED` (exit 3) — review only, pins are never auto-modified.
2. Human review of the upstream diffs (runtime, official `.mcp.json`, official skill).
3. Update the pin in `mcp.json`, `upstream.lock.json` blob SHAs, sync `SKILL.md` (only the three allowed adaptation classes), `node scripts/verify-runtime-contract.mjs --update`.
4. Run the full suite + browser qualification.
5. Publish a **new plugin revision** (e.g. `1.1.0` → Browser Use `0.14.x`); never silently re-pin an existing revision.

## Release checklist

Before publishing `browser-use@1.0.0`:

- [ ] Replace `<ACTUAL_PLUGIN_PUBLISHER>` in `plugin.json` / `LICENSE` with the real publisher identity (never the Browser Use team — §8).
- [ ] Replace `<PLUGIN_LICENSE>` in `plugin.json` and finalize `LICENSE` accordingly.
- [ ] Add `homepage`/`repository` only when real URLs exist (never fabricated — §7).
- [ ] `npm test`, `node scripts/verify-runtime-contract.mjs`, `node scripts/verify-upstream.mjs` all green.
- [ ] Browser qualification matrix run on the target Chrome/OS combinations.
- [ ] Review gates in the frozen spec (`Browser Use Agent Plugin.md` §90-§96) all checked.

## License

`<PLUGIN_LICENSE>` — see [LICENSE](LICENSE). Upstream runtime licenses: MIT (Browser Use,
Browser Harness) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
