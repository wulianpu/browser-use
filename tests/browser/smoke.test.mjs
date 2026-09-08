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

  const fixture = await startFixture();
  const runtime = await startRuntime();
  const exec = async (code, timeoutMs) => textContent(
    await runtime.client.callTool("browser_exec", { code }, timeoutMs ?? 120_000),
  );

  try {
    // §50: first task navigation is new_tab, not goto_url.
    const tabsBefore = await exec("print(repr(list_tabs()))");

    await exec('new_tab("https://example.com")\nprint(wait_for_load())\nprint(page_info())');
    await exec(`goto_url(${JSON.stringify(fixture.url)})\nprint(wait_for_load())\ninfo = page_info()\nprint(str(info)[:400])`);

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

    // Scroll: raw CDP wheel event at viewport center; page is 3000px tall.
    const scrolled = await exec(`
info = page_info()
width = 800
height = 600
try:
    width = int(info.get("viewport", {}).get("width", 800)) if isinstance(info, dict) else 800
    height = int(info.get("viewport", {}).get("height", 600)) if isinstance(info, dict) else 600
except Exception:
    pass
cdp("Input.dispatchMouseEvent", type="mouseWheel", x=width / 2, y=height / 2, deltaX=0, deltaY=600)
print("after_scroll:", js("JSON.stringify(window.__state)"))
`);
    assert.ok(/"scrolled":\s*1/.test(scrolled), "scroll moved the page");

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
            closed = name + ":" + str(eval(name + "(current_tab())"))
            break
        except Exception as exc:
            closed = name + ":error:" + str(exc)[:120]
print("cleanup:", closed)
print("tabs_after:", repr(list_tabs()))
`);
    assert.ok(!/error/.test(cleanup), "tab cleanup must not fail: " + cleanup);
    const beforeUrls = (tabsBefore.match(/https?:\/\/[^'"\s,)]+/g) ?? []);
    for (const url of beforeUrls) {
      assert.ok(cleanup.includes(url), `pre-existing tab ${url} must still be open after the task`);
    }
  } finally {
    await runtime.client.stop();
    fixture.server.close();
  }
});
