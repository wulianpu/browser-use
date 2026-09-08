# Troubleshooting

Bounded diagnostics for the `browser-use` plugin (runtime `browser-use@0.13.10` via `uvx --cli-mcp`).
The browser lifecycle (launch, attach, remote debugging, daemon) belongs to Browser Use — report
states to the user; do not reimplement or work around them.

## Error codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `BROWSER_USE_RUNTIME_MISSING` | `uvx` not found / runtime not resolvable | Ensure `uvx` is installed and on `PATH`; first run needs network access to resolve `browser-use@0.13.10` |
| `BROWSER_USE_RUNTIME_START_FAILED` | MCP process failed to spawn | Check `uvx --python 3.12 browser-use@0.13.10 --help` runs; check `PLUGIN_DATA` is writable |
| `BROWSER_USE_MCP_HANDSHAKE_FAILED` | `initialize` failed | Runtime resolved but MCP handshake broke — collect bounded stderr diagnostics, retry with a fresh process |
| `BROWSER_USE_TOOL_UNAVAILABLE` | `tools/list` lacks `browser_exec`/`browser_screenshot` | Upstream contract changed — do not proceed; surface for upstream review (§70 of the spec) |
| `BROWSER_USE_BUSY` | Another logical browser task holds the runtime | Queue or ask the user; never interleave tasks |
| `BROWSER_USE_PERMISSION_DENIED` | Host denied the required permission | `browser_exec` needs `browser.interact` + `browser.debug` + `local.code-execution`; `browser_screenshot` needs `browser.observe` |
| `BROWSER_USE_TIMEOUT` | Tool call exceeded its bound (exec 300 s, screenshot 30 s defaults) | Split the procedure into smaller verified steps; if the call may have mutated state, treat outcome as unknown |
| `BROWSER_USE_RESULT_TOO_LARGE` | Output exceeded bounds (text 1 MiB, screenshot 16 MiB) | Re-run with harder filtering/aggregation/summarization in Python; never print raw dumps |
| `BROWSER_USE_INPUT_TOO_LARGE` | browser_exec code exceeded 128 KiB | Split the procedure into smaller verified steps; never inflate the payload |
| `BROWSER_USE_RUNTIME_CRASHED` | MCP process exited abnormally | Next task starts a fresh process; inspect page state before any next action; never replay prior code |
| `BROWSER_USE_OUTCOME_UNKNOWN` | Possible side effect + timeout/disconnect/crash | Do NOT resubmit. Recover, inspect current page state, decide whether the effect already occurred |
| `BROWSER_USE_BROWSER_PERMISSION_REQUIRED` | Chrome remote debugging not granted/ready | See connection flow below |

## Connection flow (local Chrome)

- Normal flow attaches to the running Chrome/Chromium CDP endpoint. No browser ids or profile selection.
- **Chrome not running** — the harness launches it automatically and retries; first launch may be slow.
- **Chrome running, remote debugging not enabled** — the harness opens `chrome://inspect/#remote-debugging`; report this to the user and wait for their action.
- **macOS remote-debugging permission** — handled by the `mac-approve` flow, which this plugin does **not** expose as an agent tool. Route it through the host's product diagnostics / user instruction flow. It applies to local Chrome only, never to `BU_CDP_URL`/`BU_CDP_WS` endpoints or cloud browsers.
- Diagnostics command (for the user, not an agent tool): `browser-use --doctor`.

## First run is slow

`uvx` resolves `browser-use@0.13.10` and its dependencies on first use (network + registry required). Subsequent starts use the local uv cache. This is the accepted V1 supply-chain model; it is not a fault.

## Stale or internal tab

If the current tab is stale or an internal page (omnibox popup, `chrome://` surface), call `ensure_real_tab()` before working. Omnibox popups are not real work tabs; CDP target order is not Chrome's visible tab-strip order.

## Background tab stalls

A timed-out `scroll(...)` on an attached background tab means the page pauses rendering while hidden: `activate_tab(current_tab())`, retry the same scroll once, re-read scroll position. This visibly switches tabs — only with user consent. Do not invent `Runtime.evaluate` scroll replacements or cross-frame JS walkers.

## What NOT to do

- Do not restart the daemon or kill Chrome processes to "fix" a connection; use the documented flows above.
- Do not enable recordings, domain skills, cloud daemons, or write persistent `agent_helpers.py` to work around a problem — those are out of plugin scope (see SKILL.md).
- Do not retry a possibly-mutating call after a timeout/crash; inspect state first.
