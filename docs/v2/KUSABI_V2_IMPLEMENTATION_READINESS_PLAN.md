# Kusabi V2 Implementation Readiness Plan Draft

Status: draft
Scope: gap closure before implementation starts
Runtime impact: none
Base: merged V2 docs stack through PR #192

## 1. Purpose

This document defines what is still missing before Kusabi V2 can move from
strategy/design into implementation work without producing a shallow or
ambiguous rewrite.

It is a readiness plan, not an implementation authorization.

## 2. Current state

The merged V2 docs now provide:

- canonical V2 name and compatibility boundary;
- V1 intent traceability;
- naming surface inventory;
- Lane A / B / C operating policy;
- feature preservation matrix;
- API/data boundary;
- release claim ladder;
- security and retention boundary;
- UAMP / safety / scale / compliance / adopt-vs-build strategy.

This is a strong planning floor. It is not yet an implementation spec.

## 3. Readiness principle

Implementation may begin only when the relevant work package has:

1. a source-of-truth design doc;
2. exact compatibility promise;
3. explicit non-goals;
4. data model or schema where applicable;
5. positive and negative examples where applicable;
6. test plan;
7. rollback or no-op behavior;
8. owner-approved scope;
9. release/claim boundary.

## 4. Work package lanes

| Lane | Work type | Can start now? | Required before coding |
| --- | --- | --- | --- |
| Lane A | Docs/source/design refinement | Yes | Scope remains `docs/v2/**` unless separately approved. |
| Lane B | Governance / Shirube enforcement | Design only | Shirube owner approval and enforcement model. |
| Lane C | Runtime/package/MCP/env/DB/schema migration | No | Work package spec, tests, rollback, owner approval. |
| Lane D | Product proof / pilot evidence | Docs/templates now, execution later | Recovery score contract, evidence packet template, pilot scope. |

## 5. P0 gaps before implementation

These are blockers before broad runtime work.

| Gap | Why it matters | Required artifact | Implementation allowed after |
| --- | --- | --- | --- |
| Suite interop boundary | UAMP, AUN/A2A, Kodama, Shirube responsibilities can conflict. | `KUSABI_V2_SUITE_INTEROP_BOUNDARY.md` | Owner/domain-designer accepts ownership boundaries. |
| UAMP draft spec | Strategy is not implementable without schemas and mapping. | `KUSABI_V2_UAMP_DRAFT_SPEC.md` plus schema plan. | Memory/recovery mapping and schema versioning accepted. |
| UAMP conformance plan | Adopt-vs-build proof needs executable tests. | `KUSABI_V2_UAMP_CONFORMANCE_PLAN.md` | Fixture layout and pass/fail criteria accepted. |
| Scale and identity model | Tenant/user/federation cannot be inferred from current `agent_id`. | `KUSABI_V2_SCALE_AND_IDENTITY_MODEL.md` | Migration path and default-forbidden federation rules accepted. |
| Compliance attestation boundary | Compliance must be evidence support, not legal overclaim. | `KUSABI_V2_COMPLIANCE_ATTESTATION_BOUNDARY.md` | Attestation packet and claim boundaries accepted. |
| Backend parity matrix | SQLite/PG/JSON claims must be exact. | `KUSABI_V2_BACKEND_PARITY_MATRIX.md` | Unsupported gaps are either implemented or excluded from claims. |
| Redaction parity gate | Enterprise claims require all output surfaces covered. | Redaction fixture/probe plan. | Release-blocking surfaces identified and tested. |
| Recovery score contract | Pilot/guarantee needs measurable score. | `KUSABI_V2_RECOVERY_SCORE_CONTRACT.md` | Score formula, restatement incident, and evidence report accepted. |

## 6. P1 gaps before migration work

These are required before package, CLI, MCP, env, DB, or schema migration.

| Gap | Required artifact | Notes |
| --- | --- | --- |
| Full naming grep inventory | Updated `KUSABI_V2_NAMING_SURFACE_INVENTORY.md` with counts and locations. | Must include scripts, templates, tests, schemas, docs, package files. |
| Compatibility alias plan | `KUSABI_V2_COMPATIBILITY_ALIAS_PLAN.md` | Add aliases before default switches. |
| Package/repo strategy | Package/repo migration decision doc | Decide keep repo, rename, or create new public repo. |
| DB path/storage migration plan | Storage migration design | Requires backup, restore, no-op, rollback. |
| Schema ID alias/version plan | Schema migration design | Existing refs are API contracts. |
| CLI/MCP host compatibility smoke | Test plan | Old and new names must both work if aliases are added. |

## 7. P2 gaps before broad domain expansion

These are required before claiming sales, marketing, support, research, ops,
legal, finance, or other non-coding domain support.

| Gap | Required artifact | Notes |
| --- | --- | --- |
| Domain adapter model | Domain adapter boundary doc | Separate product category from domain runtime support. |
| Source permission / allowed-use labels | Kodama boundary or label mapping | Required before broad external source ingestion. |
| Domain-specific retention profiles | Retention profile design | Sales/support/legal may require stricter privacy. |
| CRM/ticket/docs adapter policy | Adapter risk and approval model | No domain adapter without scoped ingest/reveal rules. |
| Domain evaluation fixtures | Evaluation plan | Recovery success differs by domain. |

## 8. Implementation work packages

The first implementation packages should be small and evidence-oriented.

| Package | Goal | Suggested first output |
| --- | --- | --- |
| WP-1 UAMP mapping | Map current `recovery-pack/v1` to `uamp/v1`. | Pure conversion library + fixtures. |
| WP-2 Conformance fixtures | Define pass/fail corpus. | JSON fixtures and runner skeleton. |
| WP-3 Recovery score reports | Turn recovery evaluations into versioned reports. | Report schema + sample report. |
| WP-4 Redaction parity gates | Make output-surface leaks release-blocking. | Gate 0 fixture expansion. |
| WP-5 Backend parity closure | Close or document SQLite/PG/JSON gaps. | PG catch-up log parity or explicit exclusion. |
| WP-6 Suite interop evidence | Define consumed/produced artifacts between Kusabi, AUN, Kodama, Shirube. | Docs + schema refs; no runtime yet. |

## 9. Minimum implementation PR template

Every implementation PR should state:

```text
Work package:
Owner-approved design doc:
Compatibility surfaces affected:
Runtime behavior changed: yes/no
Data migration required: yes/no
Old behavior compatibility tests:
New behavior tests:
Rollback/no-op behavior:
Claim level affected:
Security/retention impact:
Docs updated:
```

## 10. Stop conditions

Do not start implementation if:

- the change spans multiple lanes without a coordinating design doc;
- it renames operational surfaces before naming inventory is complete;
- it changes DB/storage behavior without backup/rollback/no-op design;
- it broadens cross-agent, cross-tenant, or domain ingest without identity and
  source-permission design;
- it claims UAMP conformance without schemas and fixtures;
- it claims compliance without attestation boundary and legal review;
- it changes host lifecycle behavior without owner-specific boundary tests;
- it removes or deprecates any Wasurezu compatibility surface without explicit
  owner-approved breaking-change decision.

## 11. Recommended next docs-only PRs

Priority order:

1. `docs(v2): add suite interop boundary for UAMP AUN Kodama Shirube`
2. `docs(v2): add UAMP draft spec and current artifact mapping`
3. `docs(v2): add UAMP conformance plan`
4. `docs(v2): add scale and identity model`
5. `docs(v2): add compliance attestation boundary`
6. `docs(v2): add recovery score contract`
7. `docs(v2): add backend parity matrix`

## 12. Readiness definition

Kusabi V2 is ready to start runtime implementation when:

- the product category is confirmed as agent continuity substrate;
- coding agents are confirmed as first reference workload, not final boundary;
- suite interop boundary is accepted;
- UAMP draft spec and conformance plan are accepted;
- scale/identity model is accepted;
- compliance/attestation boundary is accepted;
- feature preservation and compatibility promises remain intact;
- each implementation package has tests and rollback/no-op behavior.

Until then, V2 work should remain Lane A docs/design or narrowly scoped fixes
that do not depend on unresolved product/category/protocol boundaries.
