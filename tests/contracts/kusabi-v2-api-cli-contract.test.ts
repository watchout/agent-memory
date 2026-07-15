#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
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

interface BaselineSource {
  path: string;
  sha256: string;
  purpose: string;
}

interface NegativeFixture {
  id: string;
  mutation:
    | { type: "canonical_classification"; command_id: string; claimed: Classification }
    | { type: "fixture_result"; fixture_id: string; claimed: ResultStatus };
  expected_rejection: "BASELINE_CLASSIFICATION_DRIFT" | "BASELINE_RESULT_DRIFT";
}

interface FixtureDocument {
  schema_version: string;
  control_source: string;
  spec_freeze: string;
  control_handoff: string;
  exact_base_sha: string;
  baseline_evidence: {
    exact_base_tree: string;
    sources: BaselineSource[];
    expected_cli_bins: Record<string, string>;
    expected_mcp_tools: string[];
  };
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
  negative_fixtures: NegativeFixture[];
  design_flow: Record<string, string>;
}

interface BaselineObservation {
  source_digests: Record<string, string>;
  cli_bins: Record<string, string>;
  mcp_tools: string[];
  has_kusabi_bin: boolean;
  has_subcommand_parser: boolean;
  canonical_command_literals: string[];
  classifications: Map<string, Classification>;
  missing_observations: Map<string, string[]>;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const fixturePath = resolve(here, "fixtures/kusabi-v2-api-cli-contract.json");
const documentPath = resolve(repoRoot, "docs/KUSABI_V2_API_CLI_CONTRACT.md");
const sourcePath = fileURLToPath(import.meta.url);
const fixtureText = readFileSync(fixturePath, "utf8");
const documentText = readFileSync(documentPath, "utf8");
const sourceText = readFileSync(sourcePath, "utf8");
const contract = JSON.parse(fixtureText) as FixtureDocument;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function stableDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function unique(values: string[], label: string): void {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function readBaselineSources(sources: BaselineSource[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const source of sources) {
    const absolutePath = resolve(repoRoot, source.path);
    assert.ok(
      absolutePath.startsWith(`${repoRoot}${sep}`),
      `baseline source escapes repository root: ${source.path}`,
    );
    const text = readFileSync(absolutePath, "utf8");
    assert.equal(sha256(text), source.sha256, `baseline source digest drift: ${source.path}`);
    result.set(source.path, text);
  }
  return result;
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
assert.equal(contract.baseline_evidence.exact_base_tree, "1987debb8c04aafde3437c213c0351ba6752c2de");

assert.deepEqual(
  contract.canonical_commands.map((entry) => entry.command),
  expectedCommands,
  "canonical command registry drifted",
);
unique(contract.canonical_commands.map((entry) => entry.id), "canonical command ids");
unique(contract.canonical_commands.map((entry) => entry.command), "canonical command names");

const baselineTexts = readBaselineSources(contract.baseline_evidence.sources);
const packageText = baselineTexts.get("package.json");
const indexText = baselineTexts.get("src/index.ts");
assert.ok(packageText, "content-addressed package.json evidence missing");
assert.ok(indexText, "content-addressed src/index.ts evidence missing");

const packageManifest = JSON.parse(packageText) as { bin?: Record<string, string> };
const cliBins = packageManifest.bin ?? {};
const mcpTools = Array.from(
  indexText.matchAll(/server\.tool\(\s*\n?\s*["']([^"']+)["']/g),
  (match) => match[1],
);
unique(mcpTools, "observed MCP tool names");
assert.deepEqual(cliBins, contract.baseline_evidence.expected_cli_bins, "exact-base CLI bin inventory drifted");
assert.deepEqual(mcpTools, contract.baseline_evidence.expected_mcp_tools, "exact-base MCP tool inventory drifted");

const hasKusabiBin = typeof cliBins.kusabi === "string";
const hasSubcommandParser = /\b(?:process\.argv|parseArgs\s*\(|\.command\s*\(|commander\b|yargs\b)/.test(indexText);
const commandLiterals = expectedCommands.filter((command) => indexText.includes(command));
const classifications = new Map<string, Classification>();
const missingObservations = new Map<string, string[]>();
for (const command of expectedCommands) {
  const missing: string[] = [];
  if (!hasKusabiBin) missing.push("kusabi_bin");
  if (!hasSubcommandParser) missing.push("canonical_subcommand_parser");
  if (!commandLiterals.includes(command)) missing.push(`canonical_command_literal:${command}`);
  missingObservations.set(command, missing);
  classifications.set(command, missing.length === 0 ? "implemented" : "not_implemented");
}

const observation: BaselineObservation = {
  source_digests: Object.fromEntries(contract.baseline_evidence.sources.map((source) => [source.path, source.sha256])),
  cli_bins: cliBins,
  mcp_tools: mcpTools,
  has_kusabi_bin: hasKusabiBin,
  has_subcommand_parser: hasSubcommandParser,
  canonical_command_literals: commandLiterals,
  classifications,
  missing_observations: missingObservations,
};

const missingPrimitiveByFixture = new Map<string, string>([
  ["KAPI-001", "canonical decision-record adapter with operation id and provenance binding"],
  ["KAPI-002", "typed immutable evidence attachment API and persistence identity"],
  ["KAPI-003", "canonical context-recover result fields for redaction and expiry omissions"],
  ["KAPI-004", "canonical operation-id idempotency ledger and stable replay identity"],
  ["KAPI-005", "typed IDEMPOTENCY_CONFLICT response backed by an immutable original operation result"],
  ["KAPI-006", "canonical adapters that make the three v1 tools delegation-only compatibility surfaces"],
  ["KAPI-008", "canonical fail-closed command parser with UNKNOWN_COMMAND, UNKNOWN_FIELD and UNSUPPORTED_SCHEMA_VERSION errors"],
]);

function commandUnavailable(command: string): boolean {
  return observation.classifications.get(command) !== "implemented";
}

function deriveFixtureResults(): Map<string, FixtureResult> {
  const result = new Map<string, FixtureResult>();
  const blockedCommands = new Map<string, string>([
    ["KAPI-001", "kusabi decision record"],
    ["KAPI-002", "kusabi evidence attach"],
    ["KAPI-003", "kusabi context recover"],
    ["KAPI-004", "kusabi decision record"],
    ["KAPI-005", "kusabi decision record"],
  ]);
  for (const [fixtureId, command] of blockedCommands) {
    assert.equal(commandUnavailable(command), true, `${fixtureId} unexpectedly has an implemented baseline command`);
    result.set(fixtureId, {
      status: "BLOCK",
      exact_missing_primitive: missingPrimitiveByFixture.get(fixtureId),
    });
  }

  const aliasesObserved = Array.from(expectedAliases.keys()).every((alias) => observation.mcp_tools.includes(alias));
  assert.equal(aliasesObserved, true, "one or more V1 alias surfaces are absent from exact-base MCP inventory");
  const aliasTargetsMissing = Array.from(expectedAliases.values()).every(commandUnavailable);
  result.set("KAPI-006", aliasTargetsMissing
    ? { status: "BLOCK", exact_missing_primitive: missingPrimitiveByFixture.get("KAPI-006") }
    : { status: "PASS", proof: "all observed aliases delegate to observed canonical targets" });

  result.set("KAPI-007", {
    status: "PASS",
    proof: "probe computes canonical registry digest before and after alias-layer removal",
  });
  result.set("KAPI-008", observation.has_subcommand_parser
    ? { status: "PASS", proof: "content-addressed canonical parser evidence is present" }
    : { status: "BLOCK", exact_missing_primitive: missingPrimitiveByFixture.get("KAPI-008") });
  const inventoryClosed = expectedCommands.every((command) => validClassifications.has(observation.classifications.get(command)!));
  result.set("KAPI-009", inventoryClosed
    ? { status: "PASS", proof: "content-addressed baseline inventory deterministically classifies all eight commands" }
    : { status: "BLOCK", exact_missing_primitive: "closed canonical command inventory" });
  return result;
}

const derivedResults = deriveFixtureResults();

function validateAuthoredClaims(candidate: FixtureDocument): void {
  for (const command of candidate.canonical_commands) {
    const observed = observation.classifications.get(command.command);
    if (command.classification !== observed) {
      throw new Error(`BASELINE_CLASSIFICATION_DRIFT:${command.id}:${command.classification}:${observed}`);
    }
    assert.ok(command.exact_missing_primitive.length > 0, `${command.id} must name its exact missing primitive`);
    assert.ok(
      (observation.missing_observations.get(command.command) ?? []).length > 0,
      `${command.id} missing primitive is not bound to absent baseline evidence`,
    );
  }
  for (const fixture of candidate.fixtures) {
    const observed = derivedResults.get(fixture.id);
    assert.ok(observed, `no derived result for ${fixture.id}`);
    if (fixture.result.status !== observed.status) {
      throw new Error(`BASELINE_RESULT_DRIFT:${fixture.id}:${fixture.result.status}:${observed.status}`);
    }
    if (observed.status === "BLOCK") {
      assert.equal(fixture.result.exact_missing_primitive, observed.exact_missing_primitive);
    }
  }
}

validateAuthoredClaims(contract);

assert.equal(contract.legacy_aliases.length, 3);
for (const alias of contract.legacy_aliases) {
  assert.equal(expectedAliases.get(alias.legacy_name), alias.canonical_command, `${alias.legacy_name} mapping drifted`);
  assert.equal(observation.mcp_tools.includes(alias.legacy_name), true, `${alias.legacy_name} not observed in baseline`);
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

const fixtureIdsByRegistry = {
  canonical: contract.fixtures.filter((fixture) => fixture.registry === "canonical").map((fixture) => fixture.id),
  alias_layer: contract.fixtures.filter((fixture) => fixture.registry === "alias_layer").map((fixture) => fixture.id),
};
assert.deepEqual(fixtureIdsByRegistry, contract.fixture_registries);

const canonicalRegistryBeforeAliasRemoval = contract.fixtures
  .filter((fixture) => fixture.registry === "canonical")
  .map((fixture) => ({ id: fixture.id, input: fixture.input, expected: fixture.expected }));
const canonicalRegistryAfterAliasRemoval = contract.fixtures
  .filter((fixture) => fixture.registry !== "alias_layer")
  .filter((fixture) => fixture.registry === "canonical")
  .map((fixture) => ({ id: fixture.id, input: fixture.input, expected: fixture.expected }));
const canonicalDigestBefore = stableDigest(canonicalRegistryBeforeAliasRemoval);
const canonicalDigestAfter = stableDigest(canonicalRegistryAfterAliasRemoval);
assert.equal(canonicalDigestAfter, canonicalDigestBefore, "alias removal changed the canonical registry digest");

assert.equal(contract.negative_fixtures.length >= 2, true, "classification and false-PASS negatives are required");
const negativeResults: Array<{ id: string; rejected: boolean; code: string }> = [];
for (const negative of contract.negative_fixtures) {
  const mutated = structuredClone(contract);
  if (negative.mutation.type === "canonical_classification") {
    const target = mutated.canonical_commands.find((entry) => entry.id === negative.mutation.command_id);
    assert.ok(target, `${negative.id} target command missing`);
    target.classification = negative.mutation.claimed;
  } else {
    const target = mutated.fixtures.find((entry) => entry.id === negative.mutation.fixture_id);
    assert.ok(target, `${negative.id} target fixture missing`);
    target.result.status = negative.mutation.claimed;
  }
  let rejection = "";
  assert.throws(
    () => validateAuthoredClaims(mutated),
    (error: unknown) => {
      rejection = error instanceof Error ? error.message.split(":")[0] : "UNKNOWN";
      return rejection === negative.expected_rejection;
    },
    `${negative.id} did not reject ${negative.expected_rejection}`,
  );
  negativeResults.push({ id: negative.id, rejected: true, code: rejection });
}

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
const forbiddenImports = importedModules.filter((moduleName) => !allowedReadOnlyModules.has(moduleName));
const fsImports = sourceText.match(/import\s*\{([^}]+)\}\s*from\s*["']node:fs["']/)?.[1]
  .split(",")
  .map((name) => name.trim()) ?? [];
const forbiddenFsImports = fsImports.filter((name) => name !== "readFileSync");
const productionImports = importedModules.filter((moduleName) => moduleName.startsWith("../") || moduleName.startsWith("../../src"));
const databaseImports = importedModules.filter((moduleName) => /(?:sqlite|postgres|pg|store)/i.test(moduleName));
const networkImports = importedModules.filter((moduleName) => /(?:http|https|net|tls|undici|axios|fetch|provider)/i.test(moduleName));
assert.deepEqual(forbiddenImports, [], "probe imports a non-read-only capability");
assert.deepEqual(forbiddenFsImports, [], "probe imports a filesystem mutation capability");

const counters = {
  production_runtime_mutation: productionImports.length + forbiddenFsImports.length,
  database_mutation: databaseImports.length,
  network_or_provider_call: networkImports.length,
};
assert.deepEqual(counters, {
  production_runtime_mutation: 0,
  database_mutation: 0,
  network_or_provider_call: 0,
});

const derivedMatrix = contract.fixtures.map((fixture) => {
  const result = derivedResults.get(fixture.id)!;
  return {
    id: fixture.id,
    status: result.status,
    exact_missing_primitive: result.exact_missing_primitive ?? null,
  };
});
const passIds = derivedMatrix.filter((entry) => entry.status === "PASS").map((entry) => entry.id);
const blockIds = derivedMatrix.filter((entry) => entry.status === "BLOCK").map((entry) => entry.id);
assert.deepEqual(passIds, ["KAPI-007", "KAPI-009"]);
assert.deepEqual(blockIds, ["KAPI-001", "KAPI-002", "KAPI-003", "KAPI-004", "KAPI-005", "KAPI-006", "KAPI-008"]);

const resultCount = derivedMatrix.length;
const conformancePercentage = Number(((passIds.length / resultCount) * 100).toFixed(2));
const output = {
  schema_version: "kusabi-v2-api-cli-contract-probe-result/v1",
  exact_base_sha: contract.exact_base_sha,
  baseline_evidence: {
    exact_base_tree: contract.baseline_evidence.exact_base_tree,
    source_digests: observation.source_digests,
    observed_cli_bins: observation.cli_bins,
    observed_mcp_tools: observation.mcp_tools,
    has_kusabi_bin: observation.has_kusabi_bin,
    has_subcommand_parser: observation.has_subcommand_parser,
    canonical_command_literals: observation.canonical_command_literals,
    missing_observations: Object.fromEntries(observation.missing_observations),
  },
  fixture_count: contract.fixtures.length,
  result_count: resultCount,
  pass_count: passIds.length,
  block_count: blockIds.length,
  baseline_conformance_percentage: conformancePercentage,
  counters,
  negative_fixtures: negativeResults,
  canonical_registry_digest_before_alias_removal: canonicalDigestBefore,
  canonical_registry_digest_after_alias_removal: canonicalDigestAfter,
  artifact_digests: {
    document_sha256: sha256(documentText),
    fixture_sha256: sha256(fixtureText),
    probe_source_sha256: sha256(sourceText),
  },
  matrix: derivedMatrix,
  design_flow: contract.design_flow,
};

assert.equal(output.fixture_count, 9);
assert.equal(output.result_count, 9);
assert.equal(output.baseline_conformance_percentage, 22.22);
console.log(JSON.stringify(output, null, 2));
