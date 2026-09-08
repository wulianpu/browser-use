// verify-upstream.mjs — upstream drift detection and provenance gate (§15/§71/§77).
//
// Compares the upstream identities recorded in upstream.lock.json against the
// live upstream repositories, and cross-checks the mcp.json runtime pin:
//
//   browser-use/browser-use  pyproject.toml        @ tag <lock version>  (runtime pin provenance)
//   browser-use/plugins      browser-use/.mcp.json @ main               (official plugin drift)
//   browser-use/browser-use  skills/.../SKILL.md   @ main               (official skill drift)
//
// Blobs are fetched from raw.githubusercontent.com and hashed locally
// (git blob SHA-1), so no GitHub API token or rate budget is needed.
//
// Usage:
//   node scripts/verify-upstream.mjs
//   node scripts/verify-upstream.mjs --allow-drift   # warn instead of exit 3
//   node scripts/verify-upstream.mjs --json
//
// Exit codes:
//   0 = lock matches upstream, pin consistent
//   3 = UPSTREAM_BROWSER_USE_CHANGED — human review required; pins are NEVER auto-modified
//   1 = operational error (network, unparsable artifacts)

import { get as httpsGet } from "node:https";
import { createHash } from "node:crypto";
import { loadMcpConfig, loadUpstreamLock, repoRoot } from "../tests/helpers/runtime.mjs";

const args = process.argv.slice(2);
const ALLOW_DRIFT = args.includes("--allow-drift");
const JSON_MODE = args.includes("--json");

function gitBlobSha(buf) {
  const header = Buffer.from(`blob ${buf.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, buf])).digest("hex");
}

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      { headers: { "User-Agent": "browser-use-plugin-verify-upstream" }, timeout: 30_000 },
      (response) => {
        if (response.statusCode === 404) {
          response.resume();
          resolve({ status: 404, buf: null, text: "" });
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GET ${url} -> HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: 200, buf, text: buf.toString("utf8") });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`GET ${url} timed out`)));
    request.on("error", reject);
  });
}

const lock = loadUpstreamLock();
const mcp = loadMcpConfig();
const problems = [];
const drifts = [];

// §13/§77: @latest is forbidden; the mcp.json pin must be the locked version.
const mcpArgs = mcp.mcpServers["browser-use"].args ?? [];
const pinArg = mcpArgs.find((arg) => /^browser-use@/.test(arg));
if (!pinArg) problems.push("mcp.json: no browser-use@<version> pin found in args");
if (mcpArgs.some((arg) => /@latest/.test(arg))) problems.push("mcp.json: @latest is forbidden (§13)");
if (pinArg && pinArg !== `browser-use@${lock.browserUse.version}`) {
  problems.push(`mcp.json pin "${pinArg}" != upstream.lock version "${lock.browserUse.version}"`);
}

const targets = [
  {
    label: "browserUse.pyprojectBlobSha",
    url: `https://raw.githubusercontent.com/${lock.browserUse.package}/browser-use/${lock.browserUse.version}/pyproject.toml`,
    expected: lock.browserUse.pyprojectBlobSha,
    checkText: (text) => {
      const match = text.match(/^version\s*=\s*"([^"]+)"/m);
      if (!match) return `pyproject.toml at tag ${lock.browserUse.version} has no version field`;
      if (match[1] !== lock.browserUse.version) {
        return `tag ${lock.browserUse.version} carries pyproject version ${match[1]}`;
      }
      return null;
    },
  },
  {
    label: "officialPlugin.blobSha",
    url: `https://raw.githubusercontent.com/${lock.officialPlugin.repository}/main/${lock.officialPlugin.path}`,
    expected: lock.officialPlugin.blobSha,
  },
  {
    label: "officialSkill.blobSha",
    url: `https://raw.githubusercontent.com/${lock.officialSkill.repository}/main/${lock.officialSkill.path}`,
    expected: lock.officialSkill.blobSha,
  },
];

for (const target of targets) {
  try {
    const response = await fetchRaw(target.url);
    if (response.status === 404) {
      drifts.push(`${target.label}: upstream file not found (removed or moved?) — review required`);
      continue;
    }
    const actual = gitBlobSha(response.buf);
    if (actual !== target.expected) {
      drifts.push(`${target.label}: upstream changed (expected ${target.expected}, got ${actual}) — review required`);
    }
    if (target.checkText) {
      const textProblem = target.checkText(response.text);
      if (textProblem) problems.push(`${target.label}: ${textProblem}`);
    }
  } catch (error) {
    problems.push(`${target.label}: fetch failed: ${error.message}`);
  }
}

const result = {
  ok: problems.length === 0 && drifts.length === 0,
  pin: pinArg ?? null,
  problems,
  drifts,
  allowDrift: ALLOW_DRIFT,
};

if (JSON_MODE) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  for (const drift of drifts) console.warn(`DRIFT: ${drift}`);
  if (problems.length === 0 && drifts.length === 0) {
    console.log(`OK: upstream.lock.json matches live upstream (pin ${pinArg}).`);
  }
}

if (problems.length > 0) process.exit(1);
if (drifts.length > 0 && !ALLOW_DRIFT) {
  console.error("UPSTREAM_BROWSER_USE_CHANGED — review required (§71); this tool never modifies pins automatically.");
  process.exit(3);
}
process.exit(0);
