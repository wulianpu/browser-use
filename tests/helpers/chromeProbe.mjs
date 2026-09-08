// Chrome state probes for the qualification scenarios (§82/§83/§84).
// Preconditions must be asserted BEFORE a scenario claims to prove anything.

import { spawnSync } from "node:child_process";
import net from "node:net";

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
