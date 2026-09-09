// Chrome state probes for the qualification scenarios (§82/§83/§84).
// Preconditions must be asserted BEFORE a scenario claims to prove anything.
//
// Browser identity is TARGETED, not aggregated: each probe accepts a target
// browser key ("chrome" | "chromium" | "edge") and evaluates only that
// browser's processes/profiles/endpoints, plus a competing-endpoint check so
// another qualified browser cannot silently steal the attach. Without this, a
// scenario named "Chrome qualification" could attach Edge and record the
// wrong evidence.
//
// Known limitation: on Windows, Chrome and Chromium both run as chrome.exe —
// process identity alone cannot separate them; the profile/endpoint targeting
// and the competing-endpoint guard carry the identity, and a dedicated
// machine remains the clean way to disambiguate chrome vs chromium.
//
// Remote-debugging state follows what Browser Use itself looks at: the
// profile's "Local State" flag devtools.remote_debugging.user-enabled, plus a
// live DevToolsActivePort in the profile root.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export const QUALIFICATION_BROWSERS = ["chrome", "chromium", "edge"];

const PROCESS_NAMES = {
  chrome: { win32: ["chrome.exe"], darwin: ["Google Chrome"], linux: ["chrome"] },
  chromium: { win32: ["chrome.exe"], darwin: ["Chromium"], linux: ["chromium", "chrome-browser"] },
  edge: { win32: ["msedge.exe"], darwin: ["Microsoft Edge"], linux: ["msedge", "microsoft-edge"] },
};

function dataDirFor(browser) {
  const home = process.env.HOME || process.env.USERPROFILE;
  const perBrowser = {
    chrome: {
      win32: process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data") : null,
      darwin: home ? join(home, "Library", "Application Support", "Google", "Chrome") : null,
      linux: home ? join(home, ".config", "google-chrome") : null,
    },
    chromium: {
      win32: process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Chromium", "User Data") : null,
      darwin: home ? join(home, "Library", "Application Support", "Chromium") : null,
      linux: home ? join(home, ".config", "chromium") : null,
    },
    edge: {
      win32: process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "User Data") : null,
      darwin: home ? join(home, "Library", "Application Support", "Microsoft Edge") : null,
      linux: home ? join(home, ".config", "microsoft-edge") : null,
    },
  };
  return perBrowser[browser]?.[process.platform] ?? null;
}

function targetsOf(target) {
  if (target) return [target];
  return QUALIFICATION_BROWSERS;
}

// With a target: is THAT browser's process running? Without: any qualified browser.
export function chromeProcessRunning(target = null) {
  // Best-effort probe per platform; false negatives on exotic setups are
  // acceptable (a scenario then fails its precondition loudly).
  for (const key of targetsOf(target)) {
    const names = PROCESS_NAMES[key][process.platform] ?? PROCESS_NAMES[key].linux;
    if (process.platform === "win32") {
      for (const image of names) {
        const out = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
        });
        if (new RegExp(image.replace(".", "\\."), "i").test(out.stdout ?? "")) return true;
      }
    } else {
      for (const name of names) {
        const out = spawnSync("pgrep", ["-x", name], { encoding: "utf8", timeout: 15_000 });
        if (out.status === 0) return true;
      }
    }
  }
  return false;
}

// The Local State flag the chrome://inspect/#remote-debugging flow sets.
// Tri-state per target: enabled / disabled / unknown (profile missing or
// unreadable — only a determined state satisfies a scenario precondition).
export function remoteDebuggingState(target = null) {
  const evaluated = [];
  for (const key of targetsOf(target)) {
    const dir = dataDirFor(key);
    if (!dir || !existsSync(join(dir, "Local State"))) {
      evaluated.push({ browser: key, state: "unknown", reason: `no ${key} profile / Local State found` });
      continue;
    }
    let localState;
    try {
      localState = JSON.parse(readFileSync(join(dir, "Local State"), "utf8"));
    } catch {
      evaluated.push({ browser: key, state: "unknown", reason: `${key} Local State unreadable` });
      continue;
    }
    const flag = localState?.devtools?.remote_debugging?.["user-enabled"];
    evaluated.push({ browser: key, state: flag === true ? "enabled" : "disabled", dir });
  }
  if (target) return evaluated[0];
  if (evaluated.some((e) => e.state === "enabled")) {
    return evaluated.find((e) => e.state === "enabled");
  }
  if (evaluated.some((e) => e.state === "unknown")) {
    return { state: "unknown", reason: "at least one qualified profile unreadable" };
  }
  return { state: "disabled" };
}

// Live DevToolsActivePort endpoint for the target (or the first live one
// across qualified browsers when no target is given). Attribution is by the
// LISTENING socket's owning process: a DevToolsActivePort file only counts
// when the port it names is actually listened to by THAT browser's process.
// This defeats stale files (observed 2026-09-09: Edge's leftover file said
// 9222 while Chrome was listening on 9222). Modern Chrome no longer serves
// /json/version (HTTP 404), so process ownership is the reliable signal.
// Known limitation: on Windows, Chrome and Chromium both run as chrome.exe —
// process ownership separates Edge from the chrome family, and the profile-dir
// association carries chrome-vs-chromium (dedicated machine for full rigor).
const LISTENER_IMAGE_TO_BROWSER = {
  "chrome.exe": ["chrome", "chromium"],
  "chrome": ["chrome", "chromium"],
  "google chrome": ["chrome"],
  "chromium": ["chromium"],
  "msedge.exe": ["edge"],
  "msedge": ["edge"],
  "microsoft edge": ["edge"],
};

export async function activeDevToolsEndpoint(target = null) {
  for (const key of targetsOf(target)) {
    const dir = dataDirFor(key);
    if (!dir) continue;
    const portFilePath = join(dir, "DevToolsActivePort");
    if (!existsSync(portFilePath)) continue;
    let port;
    try {
      port = Number.parseInt(readFileSync(portFilePath, "utf8").split("\n")[0], 10);
    } catch {
      continue;
    }
    if (!Number.isInteger(port) || port <= 0 || !(await tcpPortOpen(port))) continue;
    const owner = await listeningPortOwnerImage(port);
    if (!owner) continue;
    const attributed = LISTENER_IMAGE_TO_BROWSER[owner.toLowerCase()] ?? [];
    if (!attributed.includes(key)) continue;
    return { port, browser: key, dir, ownerProcess: owner };
  }
  return null;
}

// The image name of the process LISTENING on the given local port, or null.
function listeningPortOwnerImage(port) {
  if (process.platform === "win32") {
    const stats = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    const pids = new Set();
    for (const line of (stats.stdout ?? "").split("\n")) {
      const match = line.trim().match(new RegExp(`^TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)$`, "i"));
      if (match) pids.add(match[1]);
    }
    if (pids.size === 0) return null;
    for (const pid of pids) {
      const task = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
      const image = (task.stdout ?? "").trim().split(/\s+/)[0];
      if (image && image !== "信息:" && !image.startsWith("INFO:")) return image;
    }
    return null;
  }
  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8", timeout: 15_000 });
  const pid = (lsof.stdout ?? "").split("\n").find((l) => l.startsWith("p"));
  if (!pid) return null;
  const ps = spawnSync("ps", ["-p", pid.slice(1), "-o", "comm="], { encoding: "utf8", timeout: 15_000 });
  return (ps.stdout ?? "").trim() || null;
}

// Identity guard: nothing about ANOTHER qualified browser may redirect the
// harness's attach attempt. Two interference forms are both disqualifying
// (observed 2026-09-09): a live DevTools endpoint (steals the attach), or a
// persisted user-enabled debugging flag whose stale DevToolsActivePort
// metadata made the harness dial a dead port and surface an approval-flow
// error during a chrome-targeted cold-start with every browser closed.
export async function competingBrowserInterference(target) {
  const others = QUALIFICATION_BROWSERS.filter((key) => key !== target);
  for (const key of others) {
    const endpoint = await activeDevToolsEndpoint(key);
    if (endpoint) return { kind: "live-endpoint", browser: key, port: endpoint.port };
  }
  for (const key of others) {
    const state = remoteDebuggingState(key);
    if (state.state === "enabled") {
      return { kind: "enabled-flag", browser: key };
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
