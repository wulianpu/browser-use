// verify-runtime-contract.mjs — MCP contract validation gate (§69/§70/§80).
//
// Spawns the real runtime declared in mcp.json (passive check only: initialize +
// tools/list; it never opens Chrome — §34), then compares the discovered tool
// surface against tests/mcp/contract-snapshot.json. Any drift in tool names,
// input schemas, or the pinned runtime version fails the gate.
//
// Usage:
//   node scripts/verify-runtime-contract.mjs            # verify against snapshot
//   node scripts/verify-runtime-contract.mjs --update   # reviewed upgrade only (§72)
//   node scripts/verify-runtime-contract.mjs --json     # machine-readable output
//
// Exit codes: 0 = contract matches; 1 = mismatch / runtime error.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadUpstreamLock, repoRoot, startRuntime } from "../tests/helpers/runtime.mjs";

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const JSON_MODE = args.includes("--json");
const SNAPSHOT_PATH = join(repoRoot, "tests", "mcp", "contract-snapshot.json");

function fail(message) {
  if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`FAIL: ${message}`);
  process.exit(1);
}

let runtime = null;
try {
  runtime = await startRuntime();

  const lock = loadUpstreamLock();
  const live = {
    capturedFrom: "uvx --python 3.12 browser-use@0.13.10 --cli-mcp",
    serverInfo: runtime.client.serverInfo,
    protocolVersion: runtime.client.protocolVersion,
    tools: runtime.tools
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  if (UPDATE) {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(live, null, 2) + "\n");
    console.log("Snapshot updated from live runtime. Human review required before commit (§72).");
    process.exit(0);
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  snapshot.tools = snapshot.tools.slice().sort((a, b) => a.name.localeCompare(b.name));

  const problems = [];

  const liveToolNames = live.tools.map((t) => t.name);
  const snapToolNames = snapshot.tools.map((t) => t.name);
  for (const name of snapToolNames) {
    if (!liveToolNames.includes(name)) problems.push(`tool missing from live runtime: ${name}`);
  }
  for (const name of liveToolNames) {
    if (!snapToolNames.includes(name)) problems.push(`unexpected new tool from upstream: ${name}`);
  }

  for (const snapTool of snapshot.tools) {
    const liveTool = live.tools.find((t) => t.name === snapTool.name);
    if (!liveTool) continue;
    if (JSON.stringify(liveTool.inputSchema) !== JSON.stringify(snapTool.inputSchema)) {
      problems.push(`input schema changed for "${snapTool.name}"`);
    }
  }

  // The runtime that actually served the contract must be the pinned one.
  if (live.serverInfo?.version !== lock.browserUse.version) {
    problems.push(
      `runtime version drift: served ${live.serverInfo?.version}, pinned ${lock.browserUse.version}`,
    );
  }

  if (problems.length > 0) {
    if (JSON_MODE) {
      console.log(JSON.stringify({ ok: false, problems, live }, null, 2));
    } else {
      for (const problem of problems) console.error(`FAIL: ${problem}`);
      console.error("Upstream MCP contract changed — release gate failed (§70).");
      console.error("Follow the upstream upgrade flow (§72): review, update pin + lock + skill, then --update this snapshot.");
    }
    process.exit(1);
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ ok: true, tools: liveToolNames, runtimeVersion: live.serverInfo?.version }, null, 2));
  } else {
    console.log(`OK: MCP contract matches snapshot (tools: ${liveToolNames.join(", ")}; runtime ${live.serverInfo?.version}).`);
  }
  process.exit(0);
} catch (error) {
  fail(error && error.stack ? error.stack : String(error));
} finally {
  if (runtime) await runtime.client.stop();
}
