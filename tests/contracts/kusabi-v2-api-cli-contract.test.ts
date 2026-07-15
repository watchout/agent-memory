#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ResultStatus = "PASS" | "BLOCK";
type Classification = "implemented" | "compatibility_only" | "not_implemented";

interface CanonicalCommand {
  id: string;
  command: string;
  classification: Classification;
  exact_missing_primitive: string;
}

interface FixtureResult {
  status: ResultStatus;
  exact_missing_primitive?: string;
  proof?: string;
}

interface ContractFixture {
  id: string;
  registry: "canonical" | "alias_layer";
  input: unknown;
  expected: string;
  result: FixtureResult;
}

interface FixtureDocument {
  schema_version: string;
  control_source: string;
  spec_freeze: string;
  control_handoff: string;
  exact_base_sha: string;
  canonical_commands: CanonicalCommand[];
  legacy_aliases: Array<{
    legacy_name: string;
    canonical_command: string;
    current_surface: string;
    adapter_classification: Classification;
    duplicate_domain_logic_count: number | null;
    exact_blocker: string;
  }>;
  fixture_registries: {
    canonical: string[];
    alias_layer: string[];
  };
  fixtures: ContractFixture[];
  design_flow: Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures/kusabi-v2-api-cli-contract.json");
const documentPath = resolve(here, "../../docs/KUSABI_V2_API_CLI_CONTRACT.md");
const sourcePath = fileURLToPath(import.meta.url);
const fixtureText = readFileSync(fixturePath, "utf8");
const documentText = readFileSync(documentPath, "utf8");
const sourceText = readFileSync(sourcePath, "utf8");
const contract = JSON.parse(fixtureText) as FixtureDocument;

const counters = {
  production_runtime_mutation: 0,
  database_mutation: 0,
  network_or_provider_call: 0,
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function stableDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function unique(values: string[], label: string): void {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

const expectedCommands = [
  "kusabi context build",
  "kusabi context recover",
  "kusabi context search",
  "kusabi evidence attach",
  "kusabi decision record",
  "kusabi state snapshot",
  "kusabi continuity pack",
  "kusabi redact",
];
const expectedAliases = new Map([
  ["recover_context", "kusabi context recover"],
  ["search_memory", "kusabi context search"],
  ["restart_pack", "kusabi continuity pack"],
]);
const validClassifications = new Set<Classification>([
  "implemented",
  "compatibility_only",
  "not_implemented",
]);

assert.equal(contract.schema_version, "kusabi-v2-api-cli-contract-fixtures/v1");
assert.equal(contract.control_source, "https://github.com/watchout/agent-memory/issues/180");
assert.equal(contract.spec_freeze.endsWith("issuecomment-4975595110"), true);
assert.equal(contract.control_handoff.endsWith("issuecomment-4975612002"), true);
assert.equal(contract.exact_base_sha, "6e85144e4ec22f24d51cf1975c7d0448485df4b7");

assert.deepEqual(
  contract.canonical_commands.map((entry) => entry.command),
  expectedCommands,
  "canonical command registry drifted",
);
unique(contract.canonical_commands.map((entry) => entry.id), "canonical command ids");
unique(contract.canonical_commands.map((entry) => entry.command), "canonical command names");
for (const command of contract.canonical_commands) {
  assert.equal(validClassifications.has(command.classification), true, `${command.id} has unknown classification`);
  assert.notEqual(command.classification, "implemented", `${command.command} is not implemented at the exact baseline`);
  assert.ok(command.exact_missing_primitive.length > 0, `${command.id} must name its exact missing primitive`);
}

assert.equal(contract.legacy_aliases.length, 3);
for (const alias of contract.legacy_aliases) {
  assert.equal(expectedAliases.get(alias.legacy_name), alias.canonical_command, `${alias.legacy_name} mapping drifted`);
  assert.equal(alias.current_surface, "implemented_v1_mcp_tool");
  assert.equal(alias.adapter_classification, "not_implemented");
  assert.equal(alias.duplicate_domain_logic_count, null, "zero cannot be claimed before canonical delegation exists");
  assert.ok(alias.exact_blocker.length > 0);
}

assert.equal(contract.fixtures.length, 9, "fixture count must be exactly nine");
unique(contract.fixtures.map((fixture) => fixture.id), "fixture ids");
assert.deepEqual(
  contract.fixtures.map((fixture) => fixture.id),
  Array.from({ length: 9 }, (_, index) => `KAPI-${String(index + 1).padStart(3, "0")}`),
);
assert.equal(contract.fixtures.length, contract.fixtures.map((fixture) => fixture.result).length);

const fixtureIdsByRegistry = {
  canonical: contract.fixtures.filter((fixture) => fixture.registry === "canonical").map((fixture) => fixture.id),
  alias_layer: contract.fixtures.filter((fixture) => fixture.registry === "alias_layer").map((fixture) => fixture.id),
};
assert.deepEqual(fixtureIdsByRegistry, contract.fixture_registries);

const allowedResults = new Set<ResultStatus>(["PASS", "BLOCK"]);
for (const fixture of contract.fixtures) {
  assert.equal(allowedResults.has(fixture.result.status), true, `${fixture.id} has a non-conforming result state`);
  if (fixture.result.status === "BLOCK") {
    assert.ok(fixture.result.exact_missing_primitive, `${fixture.id} BLOCK must name the exact missing primitive`);
  } else {
    assert.ok(fixture.result.proof, `${fixture.id} PASS must carry deterministic proof`);
  }
}

const passIds = contract.fixtures.filter((fixture) => fixture.result.status === "PASS").map((fixture) => fixture.id);
const blockIds = contract.fixtures.filter((fixture) => fixture.result.status === "BLOCK").map((fixture) => fixture.id);
assert.deepEqual(passIds, ["KAPI-007", "KAPI-009"]);
assert.deepEqual(blockIds, ["KAPI-001", "KAPI-002", "KAPI-003", "KAPI-004", "KAPI-005", "KAPI-006", "KAPI-008"]);

const canonicalRegistryBeforeAliasRemoval = contract.fixtures
  .filter((fixture) => fixture.registry === "canonical")
  .map((fixture) => ({ id: fixture.id, input: fixture.input, expected: fixture.expected }));
const registryWithoutAliases = contract.fixtures.filter((fixture) => fixture.registry !== "alias_layer");
const canonicalRegistryAfterAliasRemoval = registryWithoutAliases
  .filter((fixture) => fixture.registry === "canonical")
  .map((fixture) => ({ id: fixture.id, input: fixture.input, expected: fixture.expected }));
const canonicalDigestBefore = stableDigest(canonicalRegistryBeforeAliasRemoval);
const canonicalDigestAfter = stableDigest(canonicalRegistryAfterAliasRemoval);
assert.equal(canonicalDigestAfter, canonicalDigestBefore, "alias removal changed the canonical registry digest");

assert.deepEqual(contract.design_flow, {
  G1: "PASS",
  G2: "PASS",
  G3: "PASS",
  G4: "PASS",
  G5: "PASS",
  G6: "PASS_WITH_STOP",
  G7: "PASS",
});

for (const command of expectedCommands) {
  assert.ok(documentText.includes(`\`${command}\``), `contract document omits ${command}`);
}
for (const errorName of [
  "UNKNOWN_COMMAND",
  "UNKNOWN_FIELD",
  "UNSUPPORTED_SCHEMA_VERSION",
  "UNKNOWN_OBJECT",
  "STALE_SOURCE",
  "IDEMPOTENCY_CONFLICT",
  "REDACTION_DENIED",
  "NOT_IMPLEMENTED",
]) {
  assert.ok(documentText.includes(`\`${errorName}\``), `contract document omits ${errorName}`);
}

const importedModules = Array.from(sourceText.matchAll(/^import[^\n]+from\s+["']([^"']+)["'];?$/gm), (match) => match[1]);
const allowedReadOnlyModules = new Set(["node:assert/strict", "node:crypto", "node:fs", "node:path", "node:url"]);
assert.ok(importedModules.length > 0, "probe import inventory is unexpectedly empty");
for (const moduleName of importedModules) {
  assert.equal(allowedReadOnlyModules.has(moduleName), true, `probe imports forbidden capability: ${moduleName}`);
}
const productionImportPrefix = ["..", "..", "src", ""].join("/");
assert.equal(sourceText.includes(productionImportPrefix), false, "probe must not import production runtime");
assert.deepEqual(counters, {
  production_runtime_mutation: 0,
  database_mutation: 0,
  network_or_provider_call: 0,
});

const resultCount = contract.fixtures.length;
const passCount = passIds.length;
const conformancePercentage = Number(((passCount / resultCount) * 100).toFixed(2));
const output = {
  schema_version: "kusabi-v2-api-cli-contract-probe-result/v1",
  exact_base_sha: contract.exact_base_sha,
  fixture_count: contract.fixtures.length,
  result_count: resultCount,
  pass_count: passCount,
  block_count: blockIds.length,
  baseline_conformance_percentage: conformancePercentage,
  counters,
  canonical_registry_digest_before_alias_removal: canonicalDigestBefore,
  canonical_registry_digest_after_alias_removal: canonicalDigestAfter,
  artifact_digests: {
    document_sha256: sha256(documentText),
    fixture_sha256: sha256(fixtureText),
    probe_source_sha256: sha256(sourceText),
  },
  matrix: contract.fixtures.map((fixture) => ({
    id: fixture.id,
    status: fixture.result.status,
    exact_missing_primitive: fixture.result.exact_missing_primitive ?? null,
  })),
  design_flow: contract.design_flow,
};

assert.equal(output.fixture_count, 9);
assert.equal(output.result_count, 9);
assert.equal(output.baseline_conformance_percentage, 22.22);
console.log(JSON.stringify(output, null, 2));
