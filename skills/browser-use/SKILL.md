---
name: browser-use
description: "Direct browser control via the official Browser Use MCP runtime (browser_exec + browser_screenshot) over CDP: web interaction, automation, scraping, testing, and work inside the user's real Chrome/Chromium with existing logged-in sessions. Use when a task needs interaction (click, type, navigate), login state, JS rendering, or bot-protected pages — not for public static content a plain HTTP fetch can read."
license: MIT
---

# Browser Use

Direct browser control via CDP, provided by the official Browser Use runtime (pinned `browser-use@0.13.10`, Python 3.12) through two MCP tools:

- `browser_exec` — run Python with Browser Harness helpers preloaded (`page_info()`, `new_tab()`, `cdp(...)`, ...). The Python namespace persists across calls **within one logical task** and is reset between tasks.
- `browser_screenshot` — capture the current page as an image.

This plugin drives the user's local browser through Browser Use. Browser Use can attach to local Chromium-family browsers (Chrome, Chromium, and others it discovers, such as Edge or Brave); **this plugin's V1 qualification covers Chrome/Chromium only** — other Chromium-family browsers may work but are unqualified here. The browser lifecycle (launch, attach, remote-debugging setup, tabs, daemon) belongs to Browser Use — do not reimplement or work around it.

## Security classification — read first

`browser_exec` is **not** a "click API". It executes arbitrary Python (`exec(code, ns)`) in a local process with CDP access. Treat every `browser_exec` call as **local code execution** requiring the host permission `local.code-execution` (plus `browser.interact` + `browser.debug`). `browser_screenshot` maps to `browser.observe`.

Policy for every task:

- Normal browser tasks do not access local sensitive files (credentials, dotfiles, documents, keychains).
- Do not run subprocesses unrelated to the browser task; do not shell out to install, download, or execute tools.
- Do not scan the local filesystem.
- Do not call unrelated localhost services.
- Do not use Browser Use Cloud or start remote daemons (see "Out of scope").
- Do not enable recordings (see "Out of scope").
- Do not persist helpers or executable state into the agent workspace (no `agent_helpers.py`).
- After a timeout, disconnect, or crash of a possibly-mutating call, never replay the same action automatically (see "Unknown outcome").

These are behavioral instructions on top of the host's security boundary — the host, not this skill, enforces authorization and isolation.

## When Not to Use

A basic fetch of public information needs no browser. If a plain HTTP request can read it — a public page, an API, docs — use your fetch tool and leave the browser alone. Use this skill when the task needs interaction (click, type, navigate), the user's logged-in session, JS rendering, or a bot-protected page. If a direct fetch fails or returns a shell page, then escalate to the browser.

## Usage

Send Python to `browser_exec` as one bounded unit of work — navigate, loop, filter, extract, aggregate, verify, and return the result in a single call where possible. Prefer one meaningful `browser_exec` over many micro-calls alternating with model turns.

Helpers are pre-imported into the namespace. Example:

```python
new_tab("https://example.com")
print(page_info())
```

Key usage facts:

- First navigation for a task is `new_tab(url)`, not `goto_url(url)`.
- Keep one working tab per task/site. Before opening another, inspect `current_tab()` and `list_tabs()` and use `switch_tab()` to reuse a matching tab. Do not leave duplicate tabs on the same URL.
- Do not close tabs you did not create in this task.
- Tabs work in the background by default; this plugin runs with `BH_TAB_MARKER=0`, so page titles are never modified.
- If a timed-out `scroll(...)` on an attached background tab suggests the page pauses rendering while hidden: call `activate_tab(current_tab())`, retry the same scroll once, then re-read the scroll position. This visibly switches tabs — only do it when the user allows foreground changes. Do not invent a `Runtime.evaluate` scroll replacement.
- Raw CDP is available as `cdp("Domain.method", ...)`.

## Page Workflow

- Prefer to find elements with the accessibility tree, not screenshots: `cdp("Accessibility.getFullAXTree")["nodes"]` has every element's role, name, and `backendDOMNodeId` — filter in Python before printing (it is thousands of nodes).
- Coordinates from an AX node: `q = cdp("DOM.getBoxModel", backendNodeId=n)["model"]["content"]; x, y = sum(q[0::2])/4, sum(q[1::2])/4` (viewport px, ready for `click_at_xy`; negative/oversized means scroll first).
- Clicking: AX node -> box center -> `click_at_xy(x, y)` -> verify with a targeted `js(...)`/`page_info()` check.
- Fall back to raw HTML via `js(...)` only when the AX tree lacks the element (canvas, exotic widgets); screenshot when layout or imagery matters.
- After navigation, call `wait_for_load()`.
- If the current tab is stale or internal, call `ensure_real_tab()`.
- Use `js(...)` for DOM inspection or extraction when coordinates are the wrong tool.
- When entering unusually long text, avoid slow per-character typing: find a faster page-appropriate input method, then verify the page kept the exact value.
- Login walls: stop and ask. Exception: use available SSO automatically when Chrome is already signed in; still stop for passwords, MFA/OTP, security verification, new consent screens, or ambiguous account choice.

## Observation budget — filter before printing

Never print a full AX tree, full HTML, raw network results, or whole tables. Filter, dedupe, sort, and aggregate in Python first:

```python
nodes = cdp("Accessibility.getFullAXTree")["nodes"]
matches = [n for n in nodes if n.get("role", {}).get("value") == "button"
           and "checkout" in (n.get("name", {}).get("value") or "").lower()]
print(matches[:20])
```

If a call fails with `BROWSER_USE_RESULT_TOO_LARGE`, do not retry the same code — re-filter, aggregate, or summarize harder. Keep each `browser_exec` under 128 KiB of code; larger procedures are rejected with `BROWSER_USE_INPUT_TOO_LARGE` — split the work instead of inflating the payload.

## Screenshots

Use the `browser_screenshot` tool (option `max_dim`, recommended default `1800`) — never build a base64 screenshot yourself via `browser_exec`. Only screenshot when vision actually matters: canvas, charts, maps, WebGL, image-heavy UI, or visual placement. Screenshots are the last observation resort, after AX and DOM/JS.

## Consequential actions

After Send, Submit, Purchase, Delete, Publish, or account-changing actions, verify the business effect before reporting success — a returned `click_at_xy` is not proof. Re-read the page state (`page_info()`, targeted `js(...)`) and confirm the expected outcome.

## Failures, timeouts, unknown outcome

- Harness/runtime failures arrive as **ordinary text output** (`isError` stays false): a Python traceback whose last line names the real problem (for example `daemon didn't come up` with the daemon-log path). Always read the returned text before deciding a call succeeded — a returned traceback means failure, not success.
- `browser_exec` calls are bounded (default 300 s; `browser_screenshot` 30 s). Keep procedures well under the budget; split long workflows into verified steps.
- If a possibly-mutating call ends in timeout, connection loss, MCP crash, or Chrome crash, the outcome is **unknown**: mark it `BROWSER_USE_OUTCOME_UNKNOWN` and do NOT resubmit the same code. Recover the runtime if needed, inspect the current page state, determine whether the effect already occurred, then decide the next action.
- A crashed MCP runtime is replaced with a fresh process for the next task. Never replay the previous task's code into it.

Host error codes you may see: `BROWSER_USE_RUNTIME_MISSING`, `BROWSER_USE_RUNTIME_START_FAILED`, `BROWSER_USE_MCP_HANDSHAKE_FAILED`, `BROWSER_USE_TOOL_UNAVAILABLE`, `BROWSER_USE_BUSY`, `BROWSER_USE_PERMISSION_DENIED`, `BROWSER_USE_TIMEOUT`, `BROWSER_USE_RESULT_TOO_LARGE`, `BROWSER_USE_INPUT_TOO_LARGE`, `BROWSER_USE_EXEC_FAILED`, `BROWSER_USE_RUNTIME_CRASHED`, `BROWSER_USE_OUTCOME_UNKNOWN`, `BROWSER_USE_BROWSER_PERMISSION_REQUIRED`. Treat these as the stable API, not Python tracebacks.

## Local browser connection

The normal local flow attaches to the running browser's CDP endpoint (Chrome/Chromium qualified for V1; Browser Use may discover other local Chromium-family browsers). No browser ids or local profile selection.

- Whether the harness can launch the browser depends on the remote-debugging prerequisite: with it satisfied, the harness launches a not-running browser and retries; without it (no user-enabled remote debugging and no live DevToolsActivePort), nothing is launched — `browser_exec` returns a traceback ending in `daemon didn't come up` pointing at the daemon log, which names the `chrome://inspect/#remote-debugging` step.
- If Chrome is running but remote debugging is not enabled, the harness opens `chrome://inspect/#remote-debugging`; report this state to the user.
- macOS remote-debugging permission (`mac-approve`) is **not** exposed as an agent tool by this plugin. Route it through the host's product diagnostics / user instruction flow.
- On connection problems, see [references/troubleshooting.md](references/troubleshooting.md).

## Out of scope in this plugin

- **Browser Use Cloud / remote daemons** — disabled. Do not call `start_remote_daemon(...)`, `browser-use auth login`, or use `BROWSER_USE_API_KEY`. If a task genuinely needs an isolated cloud browser, stop and tell the user this plugin's scope is local browsers.
- **Recordings** — `BH_RECORD=0`. Never enable recording; recording requires explicit user opt-in that this plugin does not provide.
- **Domain skills** — `BH_DOMAIN_SKILLS=0`. Do not enable or write site-specific domain-skill directories.
- **Persistent helpers** — do not create or modify `agent_helpers.py` or any executable helper state in the agent workspace. Keep task-specific logic inside your `browser_exec` code.

## Gotchas

- `chrome://inspect/#remote-debugging` must be enabled for local Chrome control.
- Omnibox popups are not real work tabs.
- CDP target order is not Chrome's visible tab-strip order.
- `BU_CDP_URL` is an HTTP DevTools endpoint; the daemon resolves it to WebSocket.
- First runtime start may be slow while `uvx` resolves the pinned package; this is expected.

## Interaction skills reference

If stuck on a browser mechanic, check the upstream Browser Harness interaction-skill docs: <https://github.com/browser-use/browser-harness/tree/main/interaction-skills> (connection, cookies, cross-origin-iframes, dialogs, downloads, drag-and-drop, dropdowns, iframes, network-requests, print-as-pdf, screenshots, scrolling, shadow-dom, tabs, uploads, viewport).
