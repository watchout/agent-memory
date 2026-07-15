# Kusabi V2 API/CLI Contract

Status: frozen contract plus executable baseline probe; not a runtime implementation or release claim

Control source: [agent-memory issue #180](https://github.com/watchout/agent-memory/issues/180)

SPEC freeze: [issue comment 4975595110](https://github.com/watchout/agent-memory/issues/180#issuecomment-4975595110)

Control handoff: [issue comment 4975612002](https://github.com/watchout/agent-memory/issues/180#issuecomment-4975612002)

Exact baseline: `6e85144e4ec22f24d51cf1975c7d0448485df4b7`

## 1. Scope and truth boundary

This document freezes the canonical Kusabi V2 command names, envelopes,
identity, provenance, idempotency, errors and legacy mappings. The adjacent
fixture and executable probe describe the exact baseline without opening a
store, importing production runtime code, or making a network or provider
call. Baseline classifications are not accepted from the authored fixture.
The probe reads the exact-base `package.json` and `src/index.ts`, verifies their
frozen SHA-256 digests, extracts the CLI bin and MCP tool inventories, and then
derives the nine fixture dispositions from those observations.

Documentation and fixture presence do not mean a command ships. At the exact
baseline, all eight canonical commands are `not_implemented`. Existing V1 MCP
tools remain observed compatibility surfaces, but they are not canonical V2
adapters until they delegate to separately implemented canonical primitives.
An absent primitive is reported as `BLOCK` or `NOT_IMPLEMENTED`; it is never
converted into a pass.

## 2. Canonical CLI registry

| ID | Canonical command | Baseline classification | Exact missing primitive |
|---|---|---|---|
| KCLI-001 | `kusabi context build` | `not_implemented` | context-build parser and versioned adapter |
| KCLI-002 | `kusabi context recover` | `not_implemented` | recover adapter with provenance, redaction and expiry result fields |
| KCLI-003 | `kusabi context search` | `not_implemented` | search adapter with versioned envelopes and source identity |
| KCLI-004 | `kusabi evidence attach` | `not_implemented` | typed immutable evidence attachment and persistence identity |
| KCLI-005 | `kusabi decision record` | `not_implemented` | decision adapter with operation ID and provenance binding |
| KCLI-006 | `kusabi state snapshot` | `not_implemented` | typed snapshot API and immutable snapshot identity |
| KCLI-007 | `kusabi continuity pack` | `not_implemented` | canonical pack adapter distinct from V1 `restart_pack` |
| KCLI-008 | `kusabi redact` | `not_implemented` | typed redact command with denial and evidence output |

The classification enum is closed: `implemented`, `compatibility_only`, or
`not_implemented`. An unknown classification is a probe failure. A future
implementation may change a classification only with exact runtime evidence;
renaming a binary, documenting a surface, or retaining a V1 tool is not such
evidence.

## 3. Versioned envelopes

Every canonical command accepts one request envelope. Unknown top-level or
payload fields fail closed unless a later schema version explicitly permits
them.

```ts
interface KusabiCommandRequestV2<TPayload> {
  schema_version: "kusabi.command.request/v2";
  command:
    | "kusabi context build"
    | "kusabi context recover"
    | "kusabi context search"
    | "kusabi evidence attach"
    | "kusabi decision record"
    | "kusabi state snapshot"
    | "kusabi continuity pack"
    | "kusabi redact";
  operation_id: string;
  identity: {
    project_id: string;
    agent_id: string;
    source_identity: string;
  };
  provenance: {
    source_ref: string;
    source_digest: `sha256:${string}`;
    observed_at?: string;
  };
  redaction: {
    policy_ref: string;
    mode: "strict" | "basic";
  };
  payload: TPayload;
}
```

Every accepted request returns one response envelope. Results and errors bind
to the same operation, identity, source digest and redaction policy.

```ts
interface KusabiCommandResponseV2<TResult> {
  schema_version: "kusabi.command.response/v2";
  command: KusabiCommandRequestV2<unknown>["command"];
  operation_id: string;
  identity: KusabiCommandRequestV2<unknown>["identity"];
  provenance: {
    source_ref: string;
    source_digest: `sha256:${string}`;
    result_digest: `sha256:${string}`;
  };
  redaction: {
    policy_ref: string;
    applied: boolean;
    omitted_item_count: number;
    denied_item_count: number;
  };
  result?: TResult;
  error?: KusabiCommandErrorV2;
}
```

Project and agent IDs are storage boundaries. Source identity and source digest
are provenance, not substitutes for those boundaries. `operation_id` is the
idempotency key within the exact project/agent/command namespace.

## 4. Idempotency and provenance

For the first accepted operation ID, Kusabi binds the canonical payload digest
and result identity before returning success. Repeating the same operation ID
with the same canonical payload returns the same effective result. Repeating
the ID with a different payload returns `IDEMPOTENCY_CONFLICT`; it does not
alter the original result.

Evidence, decisions, snapshots and packs require stable typed identities.
Generic-memory storage is not an acceptable substitute for evidence attachment
or snapshot persistence. A stale or changed source digest fails closed as
`STALE_SOURCE`. Missing project, agent or source identity is an invalid request.

## 5. Typed errors and fail-closed order

```ts
type KusabiCommandErrorCodeV2 =
  | "UNKNOWN_COMMAND"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNKNOWN_OBJECT"
  | "STALE_SOURCE"
  | "IDEMPOTENCY_CONFLICT"
  | "REDACTION_DENIED"
  | "NOT_IMPLEMENTED";

interface KusabiCommandErrorV2 {
  code: KusabiCommandErrorCodeV2;
  message: string;
  mutation_performed: false;
  retryable: boolean;
  missing_primitive?: string;
}
```

The closed error registry is `UNKNOWN_COMMAND`, `UNKNOWN_FIELD`,
`UNSUPPORTED_SCHEMA_VERSION`, `UNKNOWN_OBJECT`, `STALE_SOURCE`,
`IDEMPOTENCY_CONFLICT`, `REDACTION_DENIED`, and `NOT_IMPLEMENTED`.

Validation order is schema version, command, fields, identity, provenance,
redaction authorization, idempotency conflict, then domain execution. Each
failure before domain execution returns nonzero CLI status or a typed error
with `mutation_performed: false`. Unknown objects, stale sources, conflicts and
redaction denials never fall back to a generic memory write.

## 6. Command payload/result contracts

| Command | Required payload | Typed success identity/result |
|---|---|---|
| `kusabi context build` | bounded source refs, requested context classes, token limit | `context_id`, selected source refs, omissions, redaction summary |
| `kusabi context recover` | recovery selector and expiry boundary | `recovery_id`, returned refs, redacted/expired omission counts |
| `kusabi context search` | query, scopes and bounded limit | `search_id`, typed hits with memory and provenance identities |
| `kusabi evidence attach` | evidence type, content digest and subject ref | immutable `evidence_id` and evidence digest |
| `kusabi decision record` | decision, rationale and source refs | immutable `decision_id` plus operation binding |
| `kusabi state snapshot` | state class, state digest and source refs | immutable `snapshot_id` and snapshot digest |
| `kusabi continuity pack` | bounded recovery selection and target format | `pack_id`, selected refs, missing context and redaction summary |
| `kusabi redact` | typed input refs or bounded text plus policy ref | `redaction_id`, safe output digest, omissions and denials |

The `context recover` success invariant is
`redacted_or_expired_item_count_returned=0`. Redacted or expired candidates may
appear only in omission counts or non-sensitive evidence, never in returned
content.

## 7. Legacy alias boundary

| V1 name | Canonical identity | Exact baseline observation |
|---|---|---|
| `recover_context` | `kusabi context recover` | V1 MCP tool exists; canonical delegating adapter absent |
| `search_memory` | `kusabi context search` | V1 MCP tool exists; canonical delegating adapter absent |
| `restart_pack` | `kusabi continuity pack` | V1 MCP tool exists; canonical delegating adapter absent |

The mappings are contract identity only. A compliant alias validates its V1
shape, translates once into the canonical request, invokes the canonical
primitive, and translates the canonical response back. It owns no store call,
domain rule, idempotency logic, redaction decision, or lifecycle behavior.

The baseline cannot truthfully claim `duplicate_domain_logic_count=0`, because
the canonical targets do not exist. KAPI-006 therefore blocks. The alias
fixture registry is physically separate from the canonical registry; removing
the alias registry leaves canonical fixture IDs and their digest unchanged,
which KAPI-007 proves without claiming runtime implementation.

## 8. Executable truth probe

Run:

```sh
npx tsx tests/contracts/kusabi-v2-api-cli-contract.test.ts
```

The probe reads this document, its own source, the JSON fixture, and two
content-addressed exact-base evidence files. It imports no production module,
store, database, child process, socket, HTTP client or provider SDK. Reading a
production source file as UTF-8 evidence is not importing or executing it.
Its capability import allowlist is enforced by the probe itself. Results are
limited to `PASS` and `BLOCK`; a pass requires a deterministic assertion,
while every block names the exact missing primitive.

| Exact-base evidence | SHA-256 | Deterministic observation |
|---|---|---|
| `package.json` | `6264173ce7b176d25445e853c78fe9bb0cdbcfb44bc2a7420900e9c9e16a07a7` | six bin names, including the `kusabi` binary alias |
| `src/index.ts` | `789cda64ab9f326026bcf815012f063920fa66ca8054ece9b1ce82a055db6347` | sixteen V1 MCP tools; no canonical subcommand parser or canonical command literal |

The frozen exact-base tree is
`1987debb8c04aafde3437c213c0351ba6752c2de`. The presence of a `kusabi` bin
alias alone does not implement a subcommand. A canonical command is classified
`implemented` only when the observed baseline has the bin, a subcommand parser,
and the exact canonical command registration. The baseline has the bin but
lacks the latter two observations, so all eight commands derive as
`not_implemented`.

The JSON's authored classifications and PASS/BLOCK values are expectations,
not authority. The probe independently derives them and rejects mismatches.
`KAPI-NEG-001` injects a false `implemented` classification and must fail with
`BASELINE_CLASSIFICATION_DRIFT`. `KAPI-NEG-002` injects a fixture-only false
PASS and must fail with `BASELINE_RESULT_DRIFT`.

Baseline matrix:

| Fixture | Result | Reason |
|---|---|---|
| KAPI-001 decision record | BLOCK | canonical operation/provenance adapter absent |
| KAPI-002 evidence attach | BLOCK | immutable evidence API/persistence identity absent |
| KAPI-003 redaction/expiry recovery | BLOCK | canonical omission/result fields absent |
| KAPI-004 same operation/same payload | BLOCK | idempotency ledger absent |
| KAPI-005 same operation/different payload | BLOCK | typed conflict/original binding absent |
| KAPI-006 V1 aliases | BLOCK | canonical delegation targets absent |
| KAPI-007 alias fixture removal | PASS | canonical registry digest remains identical |
| KAPI-008 unknown input | BLOCK | canonical fail-closed parser absent |
| KAPI-009 baseline inventory | PASS | content-addressed evidence yields a closed classification for all eight commands |

Fixture count is 9 and result count is 9. Baseline conformance is
`2 / 9 = 22.22%`; blocks are not counted as passes. Expected counters are:

```json
{
  "production_runtime_mutation": 0,
  "database_mutation": 0,
  "network_or_provider_call": 0
}
```

## 9. Failure and recovery

| Failure | Detection | Recovery inside this Cell |
|---|---|---|
| Canonical primitive absent | matching KAPI result is deterministic BLOCK with exact interface/persistence identity | retain BLOCK and request a separate runtime handoff |
| Alias logic diverges | KAPI-006 cannot prove delegation-only behavior | record blocker; do not remove aliases or edit runtime |
| Fixture self-attests a result | derived exact-base classification or fixture status differs | fail with `BASELINE_CLASSIFICATION_DRIFT` or `BASELINE_RESULT_DRIFT` |
| Hidden mutation or external access | capability scan finds a production, write, database, network or provider import and a derived counter is nonzero | fail the probe and keep only isolated read-only evidence |
| Unknown input could reach mutation | KAPI-008 lacks typed pre-execution rejection | retain BLOCK; request parser implementation separately |
| Placed but not delivered | exact recipient read-back is absent | redeliver the exact handoff without changing this contract |

This Cell stops rather than editing `src/**`, package manifests, stores,
schemas, migrations, workflows or protected surfaces. Runtime completion,
activation, release, approval and merge remain outside this contract.

## 10. G1-G7 conformance

| Gate | Result | Evidence |
|---|---|---|
| G1 intent | PASS | commands and aliases trace to issue #180, frozen SPEC and exact handoff |
| G2 deterministic authority | PASS | executable assertions and content digests; no LLM authority |
| G3 boundaries | PASS | canonical, alias, store and runtime responsibilities are separated |
| G4 measurable criteria | PASS | nine fixtures, nine results and three zero counters |
| G5 fail closed | PASS | missing primitives, alias divergence and hidden access block |
| G6 protected surface | PASS_WITH_STOP | docs/tests-only scope; production and protected mutations excluded |
| G7 handoff evidence | PASS | exact head, read-back, content tuples and independent audit are required |

Independent evidence audit must use the frozen PR head plus document, fixture
and probe-output digests. The author of this contract cannot perform that
audit, approve the PR, or merge it.
