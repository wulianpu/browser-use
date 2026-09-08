// §76 Manifest Tests — real Agent Plugins 1.0.0 JSON Schema validation plus
// the semantic invariants the schema cannot express.
//
// The official schemas are vendored (pristine) at tests/manifest/schemas/:
//   plugin.schema.json  blob 8fed0e1fe45d0464aee880d3fbab228b71ecfc1e
//   mcp.schema.json     blob a9139a4259b932c60b5351c8d9da6a5c60c97646
// scripts/verify-upstream.mjs checks them for drift against agent-plugins.org.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { loadMcpConfig, loadPluginManifest, repoRoot } from "../helpers/runtime.mjs";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function schemaVersion(url) {
  assert.equal(typeof url, "string", "$schema must be a string");
  const match = url.match(/^https:\/\/agent-plugins\.org\/schemas\/(\d+\.\d+\.\d+)\//);
  assert.ok(match, `$schema must live under https://agent-plugins.org/schemas/<version>/ — got ${url}`);
  return match[1];
}

function makeValidator(schemaFile) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = JSON.parse(readFileSync(join(repoRoot, "tests", "manifest", "schemas", schemaFile), "utf8"));
  return ajv.compile(schema);
}

test("plugin.json validates against the official Agent Plugins 1.0.0 schema (§76)", () => {
  const validate = makeValidator("plugin.schema.json");
  const ok = validate(loadPluginManifest());
  assert.ok(ok, `schema validation failed: ${JSON.stringify(validate.errors)}`);
});

test("mcp.json validates against the official Agent Plugins 1.0.0 schema (§76)", () => {
  const validate = makeValidator("mcp.schema.json");
  const ok = validate(loadMcpConfig());
  assert.ok(ok, `schema validation failed: ${JSON.stringify(validate.errors)}`);
});

test("the official name pattern is exercised, not just our own regex", () => {
  const validate = makeValidator("plugin.schema.json");
  const manifest = loadPluginManifest();
  const bad = [
    "BrowserUse",    // uppercase
    "-browser-use",  // leading hyphen
    "browser-use-",  // trailing hyphen
    "browser--use",  // double hyphen (forbidden by the official pattern)
    "browser..use",  // double dot
    "a".repeat(65),  // over the 64-char limit
  ];
  for (const name of bad) {
    assert.equal(validate({ ...manifest, name }), false, `official schema must reject "${name.slice(0, 20)}"`);
  }
});

test("plugin.json and mcp.json exist at the plugin root (§4/§6)", () => {
  assert.ok(existsSync(join(repoRoot, "plugin.json")), "plugin.json must be at root");
  assert.ok(existsSync(join(repoRoot, "mcp.json")), "mcp.json must be at root");
});

test("plugin.json manifest semantics", () => {
  const manifest = loadPluginManifest();
  assert.equal(manifest.name, "browser-use");
  assert.equal(manifest.version, "1.0.0");
  assert.match(manifest.version, VERSION_RE, "version is semver");
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0);
  assert.equal(typeof manifest.author.name, "string");
  assert.ok(manifest.author.name.length > 0);
  assert.equal(typeof manifest.license, "string");
  assert.ok(manifest.license.length > 0, "license is decided before release (R1)");
  assert.ok(Array.isArray(manifest.keywords));
  for (const keyword of manifest.keywords) assert.equal(typeof keyword, "string");
});

test("plugin.json must not claim to be published by the Browser Use team (§8)", () => {
  const author = loadPluginManifest().author.name.toLowerCase();
  const forbidden = ["browser-use", "browser use", "browseruse", "browser-use team", "browser use team"];
  assert.ok(!forbidden.includes(author), `author.name must be the actual adapter publisher — got "${author}"`);
});

test("repository is the real, resolvable project repository (§7/R14)", () => {
  const manifest = loadPluginManifest();
  assert.equal(manifest.repository, "https://github.com/wulianpu/browser-use");
  assert.match(manifest.repository, /^https:\/\/github\.com\//, "no fabricated addresses");
});

test("plugin.json stays a closed schema: no non-standard core fields (§9)", () => {
  const manifest = loadPluginManifest();
  const forbidden = ["runtime", "permissions", "dependencies", "browser", "installer", "mcp", "extensions"];
  for (const field of forbidden) {
    assert.ok(!(field in manifest), `plugin.json must not contain "${field}"`);
  }
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
  assert.match(frontmatter[1], /^license:\s*MIT\s*$/m, "adapted upstream skill carries its MIT provenance");
  assert.ok(
    existsSync(join(repoRoot, "skills", "browser-use", "references", "troubleshooting.md")),
    "references/troubleshooting.md must exist",
  );
});
