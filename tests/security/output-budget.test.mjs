// §56/§57/§89 Output Budget Tests — input code and textual/image outputs stay
// bounded; oversized results are truncated/failed, never passed through.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boundImageOutput, boundTextOutput, checkCodeInput, LIMITS } from "../helpers/hostPolicy.mjs";

const MiB = 1024 * 1024;

test("2 MiB of stdout is truncated to the 1 MiB text budget and flagged (§89)", () => {
  const huge = "x".repeat(2 * MiB);
  const bounded = boundTextOutput(huge);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.bytes, 2 * MiB);
  assert.ok(Buffer.byteLength(bounded.text, "utf8") <= LIMITS.textOutputBytes, "delivered text respects the budget");
  assert.ok(bounded.note.includes("BROWSER_USE_RESULT_TOO_LARGE"));
});

test("multibyte truncation never emits U+FFFD and never exceeds the byte budget (R5)", () => {
  // 1 MiB is not divisible by 3, so the byte cut necessarily lands inside a
  // "你" character; a naive cut would emit U+FFFD (itself 3 bytes) and could
  // push delivered bytes back over the limit.
  const multibyte = "你".repeat(600_000); // 1.8 MB of 3-byte characters
  const bounded = boundTextOutput(multibyte);
  assert.equal(bounded.truncated, true);
  assert.ok(!bounded.text.includes("\uFFFD"), "no replacement characters from mid-character cuts");
  assert.ok(bounded.text.length > 0, "truncation still delivers content");
  assert.ok(Buffer.byteLength(bounded.text, "utf8") <= LIMITS.textOutputBytes, "byte budget holds after re-encoding");
  // The cut point must be a whole number of characters.
  assert.equal(bounded.text, "你".repeat(bounded.text.length));
});

test("small outputs pass through unmodified", () => {
  const bounded = boundTextOutput("page loaded");
  assert.equal(bounded.truncated, false);
  assert.equal(bounded.text, "page loaded");
});

test("oversized screenshots exceed the image budget and fail closed (§89)", () => {
  const oversized = boundImageOutput(17 * MiB);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, "BROWSER_USE_RESULT_TOO_LARGE");
  const fine = boundImageOutput(14 * MiB);
  assert.equal(fine.ok, true);
});

test("browser_exec code input above 128 KiB is rejected before dispatch (§56)", () => {
  const oversized = checkCodeInput("# comment\n".repeat(20_000)); // ~200 KB
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, "BROWSER_USE_INPUT_TOO_LARGE");
  const normal = checkCodeInput('print(page_info())');
  assert.equal(normal.ok, true);
});
