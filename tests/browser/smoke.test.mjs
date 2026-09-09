// §81 Browser Smoke Tests — real end-to-end qualification of the official
// runtime: new_tab(example.com), fixture-page navigation, page_info, filtered
// AX tree, click/type/press/scroll with effect verification, wait_for_load,
// and browser_screenshot (image tool, max_dim=1800).
//
// Opt-in via BROWSER_USE_BROWSER_TESTS=1 (drives a real Chrome — §35).
// Fixture page served from 127.0.0.1 (test-owned, so no unrelated services).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { assertAttachableTarget, hasExplicitTarget } from "../helpers/targetPreflight.mjs";
import { RUNTIME_GATES, requireRuntimeOrSkip, startRuntime } from "../helpers/runtime.mjs";

const MARKER = "bu-smoke-7331";

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>browser-use plugin smoke fixture</title></head>
<body style="height:3000px">
  <h1>${MARKER}</h1>
  <button id="btn" aria-label="click-me-${MARKER}">click me</button>
  <input id="field" aria-label="type-here-${MARKER}" placeholder="type here">
  <div id="state">waiting</div>
  <script>
    window.__state = { clicked: 0, value: "", entered: 0, scrolled: 0 };
    var sync = function () {
      document.getElementById("state").textContent = JSON.stringify(window.__state);
    };
    document.getElementById("btn").addEventListener("click", function () {
      window.__state.clicked += 1; sync();
    });
    document.getElementById("field").addEventListener("input", function (e) {
      window.__state.value = e.target.value; sync();
    });
    document.getElementById("field").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { window.__state.entered += 1; sync(); }
    });
    window.addEventListener("scroll", function () {
      if (window.scrollY > 50) { window.__state.scrolled = 1; sync(); }
    });
  </script>
</body>
</html>`;

function textContent(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function urlsOfRepr(tabListRepr) {
  return tabListRepr.match(/https?:\/\/[^'"\s,)]+/g) ?? [];
}

async function startFixture() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE_HTML);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}/` };
}

test("browser smoke: navigation, AX observation, input, screenshot (§81)", async (t) => {
  if (!requireRuntimeOrSkip(t)) return;
  if (!RUNTIME_GATES.browserTests) {
    t.skip("BROWSER_USE_BROWSER_TESTS=1 required — this test drives a real Chrome");
    return;
  }
  // When a target browser is explicitly named, prove the attachable browser
  // IS that target before claiming any smoke evidence for it (a runner label
  // is a scheduling constraint, not a runtime identity proof).
  if (hasExplicitTarget()) {
    await assertAttachableTarget(RUNTIME_GATES.qualificationBrowser, { requireRunning: true });
  }

  const fixture = await startFixture();
  const runtime = await startRuntime();
  const exec = async (code, timeoutMs) => textContent(
    await runtime.client.callTool("browser_exec", { code }, timeoutMs ?? 120_000),
  );

  try {
    // §50: first task navigation is new_tab, not goto_url.
    // Parsed in memory; real URLs never enter logs or assertion messages (§73).
    const beforeUrls = (await exec("print(repr(list_tabs()))")).match(/https?:\/\/[^'"\s,)]+/g) ?? [];

    await exec('new_tab("https://example.com")\nprint(wait_for_load())\nprint(page_info())');
    await exec(`goto_url(${JSON.stringify(fixture.url)})\nprint(wait_for_load())\ninfo = page_info()\nprint(str(info)[:400])`);

    // Background tabs throttle input (upstream-documented, qualified
    // 2026-09-09): the attached tab may be hidden while the user's own tab is
    // in the foreground — hit-testing degrades (elementFromPoint misses the
    // target) and coordinate clicks / raw CDP input stall. Activate the task
    // tab and let layout settle before any coordinate interaction (§52 allows
    // activation exactly when background throttling breaks operations).
    await exec(`
if js("document.visibilityState") == "hidden":
    activate_tab(current_tab())
    import time
    time.sleep(1.0)
print("visibility:", js("document.visibilityState"))
`);

    // §47: AX tree first, filtered in Python, never dumped raw (§48).
    const axProbe = await exec(`
nodes = cdp("Accessibility.getFullAXTree")["nodes"]
matches = [n for n in nodes if "${MARKER}" in str(n.get("name", {}).get("value", ""))]
print("ax_matches:", len(matches))
for n in matches[:5]:
    print(n.get("role", {}).get("value"), "|", n.get("name", {}).get("value"), "|", n.get("backendDOMNodeId"))
`);
    assert.ok(/ax_matches: [1-9]/.test(axProbe), "AX tree exposes the fixture controls");

    // Click: AX node -> box center -> click_at_xy -> verify effect (§54).
    const clicked = await exec(`
nodes = cdp("Accessibility.getFullAXTree")["nodes"]
btn = next(n for n in nodes if n.get("role", {}).get("value") == "button" and "click-me-${MARKER}" in str(n.get("name", {}).get("value", "")))
q = cdp("DOM.getBoxModel", backendNodeId=btn["backendDOMNodeId"])["model"]["content"]
x, y = sum(q[0::2]) / 4, sum(q[1::2]) / 4
click_at_xy(x, y)
state = js("JSON.stringify(window.__state)")
print("after_click:", state)
`);
    assert.ok(/"clicked":\s*[1-9]/.test(clicked), "click effect verified in page state, not just command return");

    // Type: focus the input (AX -> box -> click), then type_text.
    const typed = await exec(`
nodes = cdp("Accessibility.getFullAXTree")["nodes"]
field = next(n for n in nodes if "type-here-${MARKER}" in str(n.get("name", {}).get("value", "")))
q = cdp("DOM.getBoxModel", backendNodeId=field["backendDOMNodeId"])["model"]["content"]
click_at_xy(sum(q[0::2]) / 4, sum(q[1::2]) / 4)
type_text("hello-browser-use")
print("after_type:", js("JSON.stringify(window.__state)"))
`);
    assert.ok(/hello-browser-use/.test(typed), "typed text reached the page input");

    // Press: raw CDP key event (documented escape hatch).
    const pressed = await exec(`
cdp("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13)
cdp("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13)
print("after_press:", js("JSON.stringify(window.__state)"))
`);
    assert.ok(/"entered":\s*[1-9]/.test(pressed), "Enter key press reached the page");

    // Scroll: the harness's own scroll(x, y, dy) helper (upstream-documented
    // surface). Observed 2026-09-09: POSITIVE dy scrolls down (dy=-300 moved
    // scrollY from 600 up to 300) — CDP wheel convention. Short settle so the
    // page's scroll listener lands before we read state. (page_info exposes
    // viewport dims as w/h.)
    const scrolled = await exec(`
info = page_info()
w = int(info.get("w", 800)) if isinstance(info, dict) else 800
h = int(info.get("h", 600)) if isinstance(info, dict) else 600
print("ret:", scroll(w // 2, h // 2, dy=600))
import time
time.sleep(0.5)
print("scrollY:", js("window.scrollY"))
print("after_scroll:", js("JSON.stringify(window.__state)"))
`);
    assert.ok(/"scrolled":\s*1/.test(scrolled), "scroll moved the page: " + scrolled.slice(-200));

    // §49: screenshot through the dedicated image tool, never via exec base64.
    const shot = await runtime.client.callTool("browser_screenshot", { max_dim: 1800 }, 60_000);
    const hasImage = (shot.content ?? []).some((part) => part.type === "image");
    assert.ok(hasImage, "browser_screenshot returns image content");

    // §51: close only the tab this task created; pre-existing tabs must survive.
    const cleanup = await exec(`
closed = "none"
for name in ("close_tab", "close_current_tab"):
    if name in dir():
        try:
            closed = name
            eval(name + "(current_tab())")
            break
        except Exception:
            closed = name + ":error"
print("cleanup:", closed)
`);
    const firstLine = cleanup.trim().split("\n")[0] ?? "";
    assert.ok(
      /^cleanup: (close_tab|close_current_tab)$/.test(firstLine),
      "a task-tab close helper must exist and the task tab must be closed",
    );
    const after = urlsOfRepr(await exec("print(repr(list_tabs()))"));
    for (const url of beforeUrls) {
      // Compared in memory only; real URLs never enter logs or messages (§73).
      assert.ok(after.includes(url), "a pre-existing tab disappeared during the smoke task");
    }
  } finally {
    await runtime.stop();
    fixture.server.close();
  }
});
