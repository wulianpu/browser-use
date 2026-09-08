// §58/§59/§60/§88 Unknown-Outcome Tests — possibly-mutating calls that end in
// timeout/disconnect/crash must be classified unknown, never auto-replayed,
// and always followed by state inspection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAfterFailure } from "../helpers/hostPolicy.mjs";

test("timeout after a possibly-mutating call → outcome unknown, replay forbidden", () => {
  const decision = decideAfterFailure({ sideEffectPossible: true, failure: "timeout" });
  assert.equal(decision.outcome, "unknown");
  assert.equal(decision.replay, false);
  assert.equal(decision.code, "BROWSER_USE_OUTCOME_UNKNOWN");
  assert.ok(decision.nextStep.join(" ").includes("inspect"), "next step must inspect state before acting");
});

test("MCP crash / disconnect / Chrome crash after mutation → outcome unknown (§60)", () => {
  for (const failure of ["disconnect", "mcp-crash", "chrome-crash"]) {
    const decision = decideAfterFailure({ sideEffectPossible: true, failure });
    assert.equal(decision.outcome, "unknown", failure);
    assert.equal(decision.replay, false, failure);
  }
});

test("timeout without possible side effects is a known failure, still not blindly replayed", () => {
  const decision = decideAfterFailure({ sideEffectPossible: false, failure: "timeout" });
  assert.equal(decision.outcome, "known-failed");
  assert.equal(decision.replay, false, "retry must be deliberate after diagnosis, never automatic");
  assert.equal(decision.code, "BROWSER_USE_TIMEOUT");
});

test("read-only observation failures never produce unknown outcomes", () => {
  const decision = decideAfterFailure({ sideEffectPossible: false, failure: "mcp-crash" });
  assert.equal(decision.outcome, "known-failed");
  assert.equal(decision.code, "BROWSER_USE_RUNTIME_CRASHED");
});

test("the recovery order is fixed: recover → inspect → determine → decide (§59)", () => {
  const decision = decideAfterFailure({ sideEffectPossible: true, failure: "timeout" });
  const joined = decision.nextStep.join(" | ").toLowerCase();
  const inspectIndex = joined.indexOf("inspect");
  const determineIndex = joined.indexOf("determine");
  const decideIndex = joined.indexOf("then decide");
  assert.ok(inspectIndex !== -1 && determineIndex > inspectIndex && decideIndex > determineIndex);
});
