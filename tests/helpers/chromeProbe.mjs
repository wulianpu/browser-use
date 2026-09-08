// Chrome state probes for the qualification scenarios (§82/§83/§84).
// Preconditions must be asserted BEFORE a scenario claims to prove anything.
//
// Remote-debugging state follows what Browser Use itself looks at, not a
// fixed port guess: the Chrome profile's "Local State" flag
// devtools.remote_debugging.user-enabled, plus a live DevToolsActivePort file
// in the profile root (authoritative while Chrome runs).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export function chromeProcessRunning() {
  // Best-effort process probe per platform; false negatives on exotic setups
  // are acceptable (a scenario then fails its precondition loudly).
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

export function chromeUserDataDir() {
  const perPlatform = {
    win32: process.env.LOCALAPPDATA ? [process.env.LOCALAPPDATA, "Google", "Chrome", "User Data"] : null,
    darwin: process.env.HOME ? [process.env.HOME, "Library", "Application Support", "Google", "Chrome"] : null,
    linux: process.env.HOME ? [process.env.HOME, ".config", "google-chrome"] : null,
  };
  const parts = perPlatform[process.platform];
  return parts ? join(...parts) : null;
}

// The Local State flag Chrome's chrome://inspect/#remote-debugging flow sets.
// Returns true/false, or null when the profile/flag cannot be read (the
// scenario precondition then fails with an actionable message).
export function remoteDebuggingUserEnabled() {
  const dataDir = chromeUserDataDir();
  if (!dataDir) return null;
  const localStatePath = join(dataDir, "Local State");
  if (!existsSync(localStatePath)) return null;
  try {
    const localState = JSON.parse(readFileSync(localStatePath, "utf8"));
    return localState?.devtools?.remote_debugging?.["user-enabled"] === true;
  } catch {
    return null;
  }
}

// While Chrome runs with debugging active, it writes DevToolsActivePort
// ("port\npath") into the profile root; the port must actually be listening.
export async function activeDevToolsEndpoint() {
  const dataDir = chromeUserDataDir();
  if (!dataDir) return null;
  const portFilePath = join(dataDir, "DevToolsActivePort");
  if (!existsSync(portFilePath)) return null;
  let port;
  try {
    port = Number.parseInt(readFileSync(portFilePath, "utf8").split("\n")[0], 10);
  } catch {
    return null;
  }
  if (!Number.isInteger(port) || port <= 0) return null;
  return (await tcpPortOpen(port)) ? { port } : null;
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
