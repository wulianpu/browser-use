// Chrome state probes for the qualification scenarios (§82/§83/§84).
// Preconditions must be asserted BEFORE a scenario claims to prove anything.
//
// Remote-debugging state follows what Browser Use itself looks at, not a
// fixed port guess: the browser profile's "Local State" flag
// devtools.remote_debugging.user-enabled, plus a live DevToolsActivePort file
// in the profile root (authoritative while the browser runs).
//
// Profile discovery covers Google Chrome AND Chromium (V1 qualification
// scope: Chrome/Chromium). Other Chromium-family browsers (Edge/Brave) are
// not probed — they are outside the qualified scope.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export function chromeProcessRunning() {
  // Best-effort process probe per platform; false negatives on exotic setups
  // are acceptable (a scenario then fails its precondition loudly).
  // Chromium builds on Windows also run as chrome.exe, so one filter covers both.
  if (process.platform === "win32") {
    const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    return /chrome\.exe/i.test(out.stdout ?? "");
  }
  const candidates = process.platform === "darwin" ? ["Google Chrome", "Chromium"] : ["chrome", "chromium", "chrome-browser"];
  for (const name of candidates) {
    const out = spawnSync("pgrep", ["-x", name], { encoding: "utf8", timeout: 15_000 });
    if (out.status === 0) return true;
  }
  return false;
}

// Candidate user-data dirs for the qualified browsers, most preferred first.
// Returns only dirs that exist on this machine.
export function chromiumFamilyDataDirs() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const perPlatform = {
    win32: process.env.LOCALAPPDATA
      ? [
          ["chrome", join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data")],
          ["chromium", join(process.env.LOCALAPPDATA, "Chromium", "User Data")],
        ]
      : [],
    darwin: home
      ? [
          ["chrome", join(home, "Library", "Application Support", "Google", "Chrome")],
          ["chromium", join(home, "Library", "Application Support", "Chromium")],
        ]
      : [],
    linux: home
      ? [
          ["chrome", join(home, ".config", "google-chrome")],
          ["chromium", join(home, ".config", "chromium")],
        ]
      : [],
  };
  return (perPlatform[process.platform] ?? [])
    .filter(([, dir]) => existsSync(dir))
    .map(([browser, dir]) => ({ browser, dir }));
}

// Remote-debugging state across the qualified browsers' profiles.
//
// Tri-state per profile, tri-state overall:
//   "enabled"  — Local State readable and devtools.remote_debugging["user-enabled"] === true
//   "disabled" — Local State readable and the flag is false OR absent (Chrome's default is off)
//   "unknown"  — no qualified profile found, or Local State unreadable
//
// The scenario precondition accepts "disabled" only: it must be a determined
// state, not a guess.
export function remoteDebuggingState() {
  const dirs = chromiumFamilyDataDirs();
  if (dirs.length === 0) return { state: "unknown", reason: "no qualified Chrome/Chromium profile dir found" };
  let sawUnknown = false;
  for (const { browser, dir } of dirs) {
    const localStatePath = join(dir, "Local State");
    if (!existsSync(localStatePath)) {
      sawUnknown = true;
      continue;
    }
    let localState;
    try {
      localState = JSON.parse(readFileSync(localStatePath, "utf8"));
    } catch {
      sawUnknown = true;
      continue;
    }
    const flag = localState?.devtools?.remote_debugging?.["user-enabled"];
    if (flag === true) return { state: "enabled", browser, dir };
    // flag === false, or absent (default off): a determined "disabled" for this profile.
  }
  return sawUnknown
    ? { state: "unknown", reason: "Local State missing or unreadable in at least one qualified profile" }
    : { state: "disabled" };
}

// While a browser runs with debugging active, it writes DevToolsActivePort
// ("port\npath") into the profile root; the port must actually be listening.
// Checked across all qualified profiles.
export async function activeDevToolsEndpoint() {
  for (const { browser, dir } of chromiumFamilyDataDirs()) {
    const portFilePath = join(dir, "DevToolsActivePort");
    if (!existsSync(portFilePath)) continue;
    let port;
    try {
      port = Number.parseInt(readFileSync(portFilePath, "utf8").split("\n")[0], 10);
    } catch {
      continue;
    }
    if (Number.isInteger(port) && port > 0 && (await tcpPortOpen(port))) {
      return { port, browser, dir };
    }
  }
  return null;
}

export function tcpPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1_500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
