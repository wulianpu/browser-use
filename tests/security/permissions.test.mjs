// §24/§25/§27/§44 Permission Tests — browser_exec is local code execution and
// must require local.code-execution; skill documents the classification.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizeTool, ERROR_CODES } from "../helpers/hostPolicy.mjs";
import { repoRoot } from "../helpers/runtime.mjs";

test("browser_exec requires local.code-execution (§25/§85)", () => {
  const partial = authorizeTool("browser_exec", ["browser.interact", "browser.debug"]);
  assert.equal(partial.allowed, false);
  assert.deepEqual(partial.missing, ["local.code-execution"]);
  assert.equal(partial.code, "BROWSER_USE_PERMISSION_DENIED");

  const none = authorizeTool("browser_exec", []);
  assert.equal(none.allowed, false, "no permissions -> exec denied");
});

test("browser_exec with the full permission set is allowed", () => {
  const decision = authorizeTool("browser_exec", ["browser.observe", "browser.interact", "browser.debug", "local.code-execution"]);
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, null);
});

test("browser_screenshot maps to browser.observe (§25/§85)", () => {
  const allowed = authorizeTool("browser_screenshot", ["browser.observe"]);
  assert.equal(allowed.allowed, true);
  const denied = authorizeTool("browser_screenshot", []);
  assert.equal(denied.allowed, false);
});

test("unknown tools are TOOL_UNAVAILABLE, never silently allowed", () => {
  const decision = authorizeTool("browser_click", ["local.code-execution"]);
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "BROWSER_USE_TOOL_UNAVAILABLE");
});

test("SKILL.md classifies browser_exec as local code execution (§44)", () => {
  const skill = readFileSync(join(repoRoot, "skills", "browser-use", "SKILL.md"), "utf8");
  assert.ok(/local code execution/i.test(skill), "skill states browser_exec is local code execution");
  assert.ok(skill.includes("local.code-execution"), "skill names the host permission");
});

test("SKILL.md carries the V1 behavioral policy (§44)", () => {
  const skill = readFileSync(join(repoRoot, "skills", "browser-use", "SKILL.md"), "utf8");
  assert.ok(/sensitive files/i.test(skill), "no local sensitive files");
  assert.ok(/subprocess/i.test(skill), "no unrelated subprocesses");
  assert.ok(/filesystem/i.test(skill), "no filesystem scanning");
  assert.ok(/localhost services/i.test(skill), "no unrelated localhost services");
  assert.ok(/Browser Use Cloud/i.test(skill), "no automatic cloud");
  assert.ok(/recording/i.test(skill), "no automatic recording");
  assert.ok(/agent_helpers\.py/i.test(skill), "no persistent helpers");
  assert.ok(/never replay/i.test(skill), "no replay after unknown outcome");
});

test("the host error contract is the documented stable API (§75)", () => {
  const reference = [
    "BROWSER_USE_RUNTIME_MISSING",
    "BROWSER_USE_RUNTIME_START_FAILED",
    "BROWSER_USE_MCP_HANDSHAKE_FAILED",
    "BROWSER_USE_TOOL_UNAVAILABLE",
    "BROWSER_USE_BUSY",
    "BROWSER_USE_PERMISSION_DENIED",
    "BROWSER_USE_TIMEOUT",
    "BROWSER_USE_RESULT_TOO_LARGE",
    "BROWSER_USE_RUNTIME_CRASHED",
    "BROWSER_USE_OUTCOME_UNKNOWN",
    "BROWSER_USE_BROWSER_PERMISSION_REQUIRED",
  ];
  assert.deepEqual([...ERROR_CODES].sort(), [...reference].sort());
  const troubleshooting = readFileSync(join(repoRoot, "skills", "browser-use", "references", "troubleshooting.md"), "utf8");
  for (const code of reference) {
    assert.ok(troubleshooting.includes(code), `troubleshooting documents ${code}`);
  }
  const skill = readFileSync(join(repoRoot, "skills", "browser-use", "SKILL.md"), "utf8");
  assert.ok(skill.includes("BROWSER_USE_OUTCOME_UNKNOWN"), "skill surfaces the unknown-outcome code");
});
