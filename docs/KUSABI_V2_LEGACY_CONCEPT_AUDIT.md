# Kusabi v2 legacy concept audit

Status: canonical technical classification; no removal or runtime mutation

Control source: [issue #180](https://github.com/watchout/agent-memory/issues/180)

Domain contract: [KUSABI_V2_DOMAIN_MODEL.md](./KUSABI_V2_DOMAIN_MODEL.md)

Architecture: [KUSABI_V2_ARCHITECTURE.md](./KUSABI_V2_ARCHITECTURE.md)

## 1. Classification policy

Kusabi is the canonical product name. `agent-memory` and `wasurezu` are legacy
aliases. Existing package, CLI, MCP, environment, schema, database, and file
surfaces remain compatibility contracts until a separately authorized
migration proves parity and sunset criteria.

Every audited term has exactly one primary disposition:

| Disposition | Meaning |
| --- | --- |
| `keep_canonical_v2` | The term remains valid in canonical v2 language with the ownership boundary stated here. |
| `rename_to_canonical_v2` | New canonical docs use the mapped v2 object/term; current runtime surface remains unchanged until migration. |
| `legacy_alias` | A supported compatibility name/surface that resolves to a canonical concept without becoming canonical branding. |
| `deprecate` | Avoid in new canonical contracts because it is ambiguous or over-broad; compatibility remains until sunset gates pass. |
| `remove` | Eligible for actual removal only after the sunset predicate; no row in this audit authorizes immediate removal. |

## 2. Complete sixteen-term audit

| # | Legacy term | Disposition | Canonical v2 mapping | Evidence and compatibility rule |
| ---: | --- | --- | --- | --- |
| 1 | `agent-memory` | `legacy_alias` | Kusabi product/repository historical alias | Issue #180 fixes Kusabi as canonical. Keep repository, package/config, docs history, and integrations until separately inventoried and migrated. |
| 2 | `wasurezu` | `legacy_alias` | Kusabi runtime/package/MCP compatibility alias | Existing canonical draft and naming inventory identify it as compatibility. Do not rename package, bins, schema IDs, or MCP server in this docs cell. |
| 3 | `memory` | `keep_canonical_v2` | Bounded category containing `context_record`, `decision_record`, approved/candidate states, and referenced evidence | The word remains useful, but is not a single untyped object and never implies trusted instruction. |
| 4 | `living memory` | `deprecate` | Explicit canonical records/events plus continuity lifecycle | SSOT-6 remains legacy evidence. New v2 contracts name objects and ownership directly because “living” obscures mutation, promotion, and retention rules. |
| 5 | `raw ledger` | `rename_to_canonical_v2` | Source-bearing `context_record` plus immutable `source_ref` (current implementation evidence includes `raw_events`) | Do not rename the current table here. Raw source stays data-only; Kodama-owned source stays external authority. |
| 6 | `recovery` | `keep_canonical_v2` | Policy-bound retrieval and continuity outcome | Recovery remains a product capability term. It does not imply host restart, queue lifecycle, or successful resume without direct evidence. |
| 7 | `recover_context` | `legacy_alias` | Canonical context-recovery API/CLI contract defined by the separate API cell | Preserve the MCP/manual tool and behavior until alias isolation, parity tests, warning period, and sunset approval exist. |
| 8 | `search_memory` | `legacy_alias` | Canonical scoped context-search API/CLI contract defined by the separate API cell; produces a `retrieval_run` | Preserve current scopes and input shapes. Retrieval does not promote memory or broaden scope. |
| 9 | `restart_pack` | `legacy_alias` | `continuity_pack` compatibility surface | Preserve text/structured artifacts and selected-pack references. Pack generation/consumption does not own host or AUN lifecycle. |
| 10 | `memory pack` | `rename_to_canonical_v2` | `continuity_pack` when it is a bounded recovery artifact | Generic “memory pack” is replaced in canonical contracts; legacy docs remain evidence. Exact included records and policies must be referenced. |
| 11 | `context pack` | `deprecate` | `continuity_pack` for Kusabi-derived memory delivery; Kodama permissioned context pack for source delivery | The unqualified term is ownership-ambiguous. Kusabi must not claim Kodama source ACL or permissioned context-pack provenance. |
| 12 | `evidence pack` | `rename_to_canonical_v2` | `evidence_record` set or external evidence envelope referenced by `source_ref` | Kusabi may index/assemble evidence references but does not copy AUN/Shirube envelope authority or grant approval. |
| 13 | `decision log` | `rename_to_canonical_v2` | Ordered `decision_record` history and supersession chain | Not a mutable free-form log. Preserve current decision APIs until the canonical contract and migration are implemented. |
| 14 | `agent state` | `rename_to_canonical_v2` | `agent_state_snapshot` | State snapshot is bounded, scoped, immutable, and provenance-bearing; it cannot copy an AUN lease/runtime baton as owned state. |
| 15 | `runtime binding` | `keep_canonical_v2` | External runtime/identity binding referenced as provenance; current memory boundary remains `agent_id + optional project` | SSOT-7 remains the compatibility authority. Runtime/session/queue IDs never replace the memory-owner namespace or imply tenant identity. |
| 16 | `AUN gate evidence refs` | `rename_to_canonical_v2` | `evidence_record` / `source_ref` / `policy_ref` mapping to the external AUN evidence envelope | The existing ref schema remains compatible. `authorizes_execution=false` and `mutates_aun_lifecycle=false`; AUN retains gate and attempt authority. |

Readback invariant:

```text
required_terms=16
classified_count=16
unclassified_count=0
canonical_product=Kusabi
authority_duplication_count=0
```

## 3. Surface consequences

This audit classifies technical concepts, not only prose. A later migration
must inventory each affected surface before changing it:

- repository/product/package/module names;
- MCP server and tool names/descriptions;
- CLI bins, subcommands, help text, exit behavior, and shell scripts;
- environment variables and configuration keys;
- database/table/column/index names, migrations, and on-disk paths;
- schema IDs, artifact media types, and serialized enum values;
- docs, examples, runbooks, generated assets, release metadata, and external
  consumers;
- AUN, Shirube, Kodama, host-adapter, and common-registry integrations.

A documentation mapping does not prove any surface migrated. Canonical v2
commands are owned by the separate API/CLI contract cell; migration, aliases,
and done claims are owned by their separate cells.

## 4. Compatibility and sunset predicate

No legacy alias or deprecated term may be removed until all of the following
are true for the exact surface:

1. A machine-readable consumer inventory reports `consumer=0`, or every known
   consumer has an accepted migration with exact version evidence.
2. Canonical-v2 versus legacy-alias parity is `PASS` across supported backends,
   MCP/CLI contracts, redaction, retention, recovery output, and failure modes.
3. A documented warning period has completed for the released versions and
   operators have an actionable replacement path.
4. Alias-isolation evidence proves removal breaks only the shim, not canonical
   core flows.
5. Rollback/no-op behavior and data compatibility are verified.
6. An explicit owner sunset reference authorizes the exact removal and claim
   change.

If any predicate is missing, removal is blocked and the row remains a legacy
alias or deprecated compatibility surface. This audit itself grants no sunset
authority.

## 5. Negative cases and recovery

| Case | Expected result | Recovery |
| --- | --- | --- |
| Product renamed but domain/storage/API remain v1-only | `v2_done=false` | Preserve aliases and report missing substantive-object, migration, and contract proof. |
| A legacy term has no evidence-backed mapping | `unclassified_count>0`, audit fails | Keep the surface unchanged and request owner classification; do not normalize an invented mapping. |
| `context pack` is treated as Kusabi-owned source context | Boundary failure | Split Kusabi `continuity_pack` from Kodama permissioned source context; retain only `source_ref`. |
| Shirube PASS silently approves memory | Promotion failure | Keep candidate state; require a distinct `promotion_event` with valid authority. |
| AUN evidence ref is treated as execution permission | Authority failure | Set/retain `authorizes_execution=false`; AUN makes the gate/attempt decision. |
| Alias removal lacks any sunset predicate | Removal blocked | Continue compatibility and list the exact missing predicate. |

## 6. Fixture readback

| Fixture | Result |
| --- | --- |
| KADL-007 | PASS (document readback): the table has exactly 16 required legacy-term rows; `classified_count=16`, `unclassified_count=0`. |
| KADL-008 | PASS (negative design fixture): removal is blocked unless consumer inventory, parity PASS, completed warning period, alias isolation, rollback/data compatibility, and exact owner sunset ref all exist. |

## 7. Provenance

The classifications are bounded by issue #180, the frozen handoff, the
[canonical v2 draft](./v2/KUSABI_V2_CANONICAL_SPEC.md), the
[API/data boundary](./v2/KUSABI_V2_API_AND_DATA_BOUNDARY.md), the
[v1 intent traceability record](./v2/KUSABI_V2_V1_INTENT_TRACEABILITY.md),
[SSOT-6 living memory control](./design/core/SSOT-6_LIVING_MEMORY_CONTROL.md),
[SSOT-7 runtime binding](./design/core/SSOT-7_RUNTIME_AGENT_BINDING.md), and the
[AUN evidence-ref contract](./design/governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md).
Where these sources do not yet prove runtime realization, the mapping remains a
design requirement and no release claim is made.
