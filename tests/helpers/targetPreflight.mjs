// Target-browser identity preflight for the smoke and real-sentinel
// follow-up suites (qualification scenarios keep their own inline checks).
//
// A runner label is a SCHEDULING constraint, not a runtime identity proof:
// a chromium-labeled run on a machine where Chrome/Edge happen to be
// attachable would pass while attaching the wrong browser. When
// BROWSER_USE_QUALIFICATION_BROWSER is explicitly set, these suites must
// first prove the machine's attachable browser IS the requested target:
// no competing interference, the target is running, and its endpoint is
// attributable to it (by listening-process ownership).

import assert from "node:assert/strict";
import {
  activeDevToolsEndpoint,
  chromeProcessRunning,
  competingBrowserInterference,
  QUALIFICATION_BROWSERS,
  remoteDebuggingState,
} from "./chromeProbe.mjs";

export function hasExplicitTarget() {
  return Boolean(process.env.BROWSER_USE_QUALIFICATION_BROWSER);
}

export async function assertAttachableTarget(target, { requireRunning = true } = {}) {
  assert.ok(
    QUALIFICATION_BROWSERS.includes(target),
    `identity preflight: target must be one of ${QUALIFICATION_BROWSERS.join("|")} — got "${target}"`,
  );
  const interference = await competingBrowserInterference(target);
  assert.equal(
    interference,
    null,
    `identity preflight: ${interference?.browser} ${interference?.kind === "live-endpoint" ? `holds a live DevTools endpoint (port ${interference?.port}) that would steal the attach` : "has remote debugging user-enabled; its persisted state can redirect the harness"} — this run would not prove ${target}`,
  );
  if (requireRunning) {
    assert.ok(chromeProcessRunning(target), `identity preflight: ${target} must be running for this suite`);
    const endpoint = await activeDevToolsEndpoint(target);
    const debugging = remoteDebuggingState(target);
    assert.ok(
      endpoint !== null || debugging.state === "enabled",
      `identity preflight: ${target} must be attachable (a live, process-attributed endpoint or a user-enabled debugging flag)`,
    );
  }
}
