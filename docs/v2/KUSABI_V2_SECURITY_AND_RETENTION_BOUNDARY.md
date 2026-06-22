# Kusabi V2 Security and Retention Boundary Draft

Status: draft
Scope: security, privacy, redaction, retention, deletion, export, and reveal boundaries
Base dependency: PR #182, PR #183, and PR #187
Runtime impact: none

## 1. Purpose

This document defines the security and retention boundary needed for Kusabi V2 to
be credible to serious engineering teams and enterprise reviewers.

It does not claim that all controls are implemented. It defines the design bar,
claim limits, and release-blocking evidence required before stronger claims.

## 2. Core security posture

Kusabi stores local agent memory and recovery evidence. That makes it a sensitive
local data system.

Kusabi must be honest about what it is and is not:

| Statement | V2 position |
| --- | --- |
| Is Kusabi a general-purpose DLP system? | No. |
| Is Kusabi a secret manager? | No. |
| Can Kusabi guarantee zero secret leakage? | No. |
| Should Kusabi redact known secret patterns before sensitive output surfaces? | Yes, release-blocking for stronger claims. |
| Should Kusabi preserve provenance and missing-evidence markers? | Yes. |
| Should raw source text become trusted instruction? | No. |
| Should replacement/supersession delete audit history? | No. |

Allowed claim after sufficient probes:

```text
Kusabi applies documented redaction and output-boundary checks for known secret
patterns across supported recovery and search surfaces.
```

Not allowed:

```text
Kusabi guarantees no secret leakage or replaces a dedicated DLP/secret manager.
```

## 3. Sensitive data classes

| Data class | Examples | Default treatment |
| --- | --- | --- |
| Secrets and credentials | API keys, bearer tokens, JWTs, database URLs, private keys, webhooks | Redact before persistence or output where applicable; never publish. |
| Transcript excerpts | user/assistant/tool text, imported JSONL spans | Data-only, redacted, source-bearing; not trusted instruction. |
| Local file paths | home paths, workspace paths, source refs | Normalize where possible; avoid unnecessary exposure. |
| Personal data | email, phone, names in transcripts | Redact or minimize where applicable. |
| Private reasoning | hidden reasoning, base/developer instructions | Do not persist as user-visible memory. |
| Operational metadata | host, runtime, session, queue refs, pack refs | Store as provenance; do not treat as authorization. |
| Approved memory | explicitly promoted memories | Requires promotion evidence; still not executable instruction by default. |

## 4. Data-only rule

Stored source text must remain data unless a trusted control-plane path authors a
new instruction.

This applies to:

- imported transcript text;
- `conversation_events`;
- `raw_events`;
- `search_memory` results;
- `restart_pack` items;
- `recovery-pack/v1` items;
- `host-invocation-context/v1.context_data`;
- tool results;
- queue/issue/PR text;
- web or file excerpts.

Forbidden transformations:

```text
stored source text -> shell command
stored source text -> env var name or value
stored source text -> file path to execute
stored source text -> branch name or git ref to mutate
stored source text -> host/runtime flag
stored source text -> trusted_instruction
```

Allowed transformation:

```text
stored source text -> quoted data-only context with provenance, redaction, and
missing-evidence markers
```

## 5. Redaction boundary

Redaction must be treated as layered defense, not an absolute guarantee.

| Surface | Required V2 posture before L3+ claim |
| --- | --- |
| Ingest adapters | Redact known patterns before persistence and hashing where applicable. |
| `restart_pack` text | Redact before output. |
| `recovery-pack/v1` JSON | Redact item summaries and include redaction metadata. |
| `host-invocation-context/v1` JSON | Embed redacted recovery pack and keep context data-only. |
| `search_memory` | Redact assembled output before MCP boundary. |
| `recover_context` | Redact assembled output before MCP boundary. |
| Boot fallback output | Redact fallback recovery output. |
| Codex bridge | Redact prompt/output surface and disclose argv limitation. |
| Claude runner/hook | Redact loaded recovery surfaces where applicable. |
| Logs/errors | Avoid echoing secrets, DB URLs, full transcript excerpts, or raw recovery packs. |

Required fixture families for release-blocking probes:

- OpenAI / Anthropic-style `sk-` keys;
- AWS access keys;
- GitHub token family;
- Slack tokens;
- Stripe secret/restricted keys and webhook signing secrets;
- bearer tokens;
- JWTs;
- webhook URLs;
- PEM/private key blocks;
- secrets in URL query params;
- secrets inside markdown code fences;
- secrets inside SQL string literals;
- adjacent/compound secrets;
- emails and unnecessary personal data;
- home paths and local file paths where normalization is expected.

The UAMP-level fixture catalog is defined in
`KUSABI_V2_UAMP_FIXTURE_CATALOG.md`. That catalog records required fixture
families only; release-blocking redaction parity gates still require separate
fixture files, runner evidence, and owner-approved release criteria.

The controlling redaction parity gate is
`KUSABI_V2_REDACTION_PARITY_GATE.md`. It defines output-surface parity and
claim-blocking behavior for known sensitive patterns without implementing
fixtures, probes, runner code, CI gates, or DLP/zero-leakage claims.

## 6. Redaction evidence

A release or pilot evidence packet should record:

| Evidence | Required for |
| --- | --- |
| redaction version or policy version | all L3+ claims |
| fixture families tested | all L3+ claims |
| output surfaces tested | all L3+ claims |
| raw fixture absent / placeholder present assertions | all L3+ claims |
| known false negatives or unsupported families | public honesty |
| fixpoint/idempotence checks where applicable | regression safety |
| CI or release-blocking location | release readiness |

If a surface is not probed, it must be named in `missing_evidence` or in the
release limitation notes.

## 7. Retention and deletion boundary

V2 must distinguish these concepts:

| Concept | Meaning | Audit expectation |
| --- | --- | --- |
| Supersession | New memory replaces old memory for active use. | Preserve old record and link. |
| Merge | One knowledge item is merged into another. | Preserve source record and target ref. |
| Archive | Hide from active defaults but keep record. | Preserve history. |
| Expire | Mark stale task state inactive or expired. | Preserve record and status change. |
| Delete | Remove data from storage. | Requires explicit owner-approved design, backup/rollback, and audit. |
| Export | Produce a portable copy. | Requires redaction, scope, and approval boundary. |
| Retention TTL | Automatic aging policy. | Requires documented policy and operator visibility. |

Default V2 rule:

```text
Replacement is not deletion. Supersession, merge, archive, and expire preserve
history unless an explicit deletion policy says otherwise.
```

Compliance and attestation evidence for retention, deletion, export, reveal,
and audit support is defined in `KUSABI_V2_COMPLIANCE_ATTESTATION_BOUNDARY.md`.
That boundary is evidence-support design only; it does not implement
deletion/export/reveal behavior or certify legal/regulatory compliance.

## 8. Retention policy requirements

Before any L3+ enterprise-pilot claim, docs must define:

- which tables/artifacts are retained by default;
- whether retention is indefinite or operator-managed;
- whether selected restart packs expire by default;
- whether task expiration changes status only or deletes rows;
- whether superseded decisions/knowledge remain stored;
- how an operator can back up and restore local SQLite data;
- how a PostgreSQL operator can manage backup/retention externally;
- whether JSON fallback files are supported for durable use;
- what uninstall does and does not delete;
- how to request or perform manual deletion safely.

Before automatic deletion or TTL enforcement is implemented, require:

1. owner-approved design;
2. migration/backup plan;
3. dry-run or preview mode;
4. audit log or deletion report;
5. rollback or restore guidance;
6. tests for accidental cross-agent/project deletion;
7. clear user-facing docs.

## 9. Reveal and export boundary

Memory reveal/export is high risk. V2 should not treat export as a trivial
read operation.

Required before export/reveal claims:

- scope selector: agent, project, source, time range, table/artifact class;
- redaction mode;
- raw vs summarized output choice;
- source refs and omitted fields;
- warning that raw transcripts may contain sensitive data;
- explicit local operator intent;
- no cross-agent or cross-tenant export by default;
- no private reasoning or developer/base instruction bodies;
- tests for secret-output probes.

## 10. Ingest boundary

Broad transcript ingest is sensitive. V2 should keep these rules:

| Ingest type | V2 requirement |
| --- | --- |
| Current-session or allowlisted local logs | Allowed when explicitly configured and redacted. |
| Broad home-directory transcript sweep | Requires explicit local operator intent and limits. |
| Cross-agent transcript ingest | Forbidden by default. |
| Cross-tenant ingest | Forbidden. |
| Private reasoning / hidden chain | Forbidden. |
| Developer/base instructions | Forbidden as user-visible memory. |
| Unknown files | Surface as missing/degraded coverage, not silent import. |

## 11. Admin and high-risk action boundary

These surfaces require stronger review before enterprise/governance claims:

| Surface | Risk | V2 boundary |
| --- | --- | --- |
| `set_recovery_config` | changes recovery output depth and behavior | Requires local operator intent / approval evidence for admin claims. |
| broad `ingest_conversation_events` | imports sensitive transcripts | Requires scope limits and local operator intent. |
| future export/reveal | may expose secrets/transcripts | Requires redaction, scope, and approval. |
| deletion/TTL | may destroy audit/data | Requires owner-approved policy and rollback. |
| runtime restart/refresh | may interrupt work | Requires host/supervisor ownership and preauthorization. |
| package/env/DB migration | may break users or lose data | Requires migration guide, tests, rollback. |

## 12. Backend and storage privacy

| Backend | Privacy stance |
| --- | --- |
| SQLite | Local file controlled by operator; backup/delete is operator responsibility. |
| PostgreSQL | Operator-controlled database; access control and backups are deployment responsibilities. |
| JSON | Local files; do not claim production durability without explicit support. |
| Voyage/embeddings | Optional PG semantic enrichment; docs must say when text is sent to external embedding service, if enabled. |

V2 docs must clearly state whether any feature transmits content to third-party
services. Default local memory server operation should not upload DB dumps,
transcripts, or recovery packs.

## 13. Major-tech review checklist

A major technology-company reviewer should be able to find clear answers to:

- What is stored?
- Where is it stored?
- Is it local by default?
- What is sent to third parties, if anything?
- What is redacted before persistence?
- What is redacted before output?
- What is not covered by redaction?
- Can stored text become instruction?
- How are memory classes promoted?
- How are records superseded without deletion?
- What is the retention policy?
- How does an operator back up, restore, uninstall, or delete data?
- How is cross-agent/project access prevented?
- What logs or metrics prove recovery quality?
- Which surfaces are manual, adapter-based, or supervised by an external owner?

## 14. Acceptance criteria

This boundary is acceptable when:

- redaction is described as best-effort and probe-backed, not guaranteed DLP;
- data-only handling is explicit;
- retention/deletion/supersession/export are separated;
- broad ingest and reveal are treated as high-risk;
- backend privacy responsibilities are documented;
- major-tech review questions have document locations;
- stronger release claims refer to evidence packets.

## 15. Stop condition

Stop and split work if a proposed change:

- deletes or migrates data;
- broadens ingest scope;
- introduces export/reveal behavior;
- reads secrets or local secret files;
- changes env var or DB path behavior;
- claims DLP or compliance guarantees;
- claims live governance enforcement without tested integration.
