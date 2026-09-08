// §76 Manifest Tests — Agent Plugins 1.0.0 conformance (structural, offline).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMcpConfig, loadPluginManifest, repoRoot } from "../helpers/runtime.mjs";

const SCHEMA_BASE = "https://agent-plugins.org/schemas/";
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function schemaVersion(url) {
  assert.equal(typeof url, "string", "$schema must be a string");
  const match = url.match(/^https:\/\/agent-plugins\.org\/schemas\/(\d+\.\d+\.\d+)\//);
  assert.ok(match, `$schema must live under ${SCHEMA_BASE}<version>/ — got ${url}`);
  return match[1];
}

test("plugin.json and mcp.json exist at the plugin root (§4/§6)", () => {
  assert.ok(existsSync(join(repoRoot, "plugin.json")), "plugin.json must be at root");
  assert.ok(existsSync(join(repoRoot, "mcp.json")), "mcp.json must be at root");
});

test("plugin.json manifest structure", () => {
  const manifest = loadPluginManifest();
  assert.equal(manifest.name, "browser-use");
  assert.match(manifest.name, /^[a-z0-9.-]+$/, "name uses only a-z 0-9 - . (§4)");
  assert.equal(manifest.version, "1.0.0");
  assert.match(manifest.version, VERSION_RE, "version is semver");
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0);
  assert.equal(typeof manifest.author.name, "string");
  assert.ok(manifest.author.name.length > 0);
  assert.ok(Array.isArray(manifest.keywords));
  for (const keyword of manifest.keywords) assert.equal(typeof keyword, "string");
});

test("plugin.json must not claim to be published by the Browser Use team (§8)", () => {
  const author = loadPluginManifest().author.name.toLowerCase();
  const forbidden = ["browser-use", "browser use", "browseruse", "browser-use team", "browser use team"];
  assert.ok(!forbidden.includes(author), `author.name must be the actual adapter publisher — got "${author}"`);
});

test("plugin.json is a closed schema: no non-standard core fields (§9)", () => {
  const manifest = loadPluginManifest();
  const forbidden = ["runtime", "permissions", "dependencies", "browser", "installer", "mcp", "extensions"];
  for (const field of forbidden) {
    assert.ok(!(field in manifest), `plugin.json must not contain "${field}"`);
  }
});

test("no fabricated homepage/repository (§7)", () => {
  const manifest = loadPluginManifest();
  assert.equal(manifest.homepage, undefined, "homepage only when a real one exists");
  assert.equal(manifest.repository, undefined, "repository only when a real one exists");
});

test("plugin.json and mcp.json declare the same Agent Plugins schema version (§76)", () => {
  const pluginVersion = schemaVersion(loadPluginManifest().$schema);
  const mcpVersion = schemaVersion(loadMcpConfig().$schema);
  assert.equal(pluginVersion, "1.0.0");
  assert.equal(pluginVersion, mcpVersion, "plugin.json and mcp.json $schema versions must match");
});

test("mcp.json declares exactly one stdio server with only spec-allowed fields (§4)", () => {
  const config = loadMcpConfig();
  assert.deepEqual(Object.keys(config.mcpServers), ["browser-use"]);
  const server = config.mcpServers["browser-use"];
  assert.equal(server.type, "stdio");
  assert.equal(server.command, "uvx");
  const allowed = new Set(["type", "command", "args", "env", "cwd"]);
  for (const field of Object.keys(server)) {
    assert.ok(allowed.has(field), `unexpected mcp server field "${field}"`);
  }
});

test("plugin discovery artifacts: skill is present and portable (§4/§42)", () => {
  const skillPath = join(repoRoot, "skills", "browser-use", "SKILL.md");
  assert.ok(existsSync(skillPath), "skills/browser-use/SKILL.md must exist");
  const text = readFileSync(skillPath, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "SKILL.md has YAML frontmatter");
  assert.match(frontmatter[1], /^name:\s*browser-use\s*$/m, "skill name matches its directory");
  assert.match(frontmatter[1], /^description:\s*\S/m, "skill has a description");
  assert.ok(
    existsSync(join(repoRoot, "skills", "browser-use", "references", "troubleshooting.md")),
    "references/troubleshooting.md must exist",
  );
});
