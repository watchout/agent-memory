# Kusabi V2 UAMP Fixture Catalog Draft

Status: draft
Scope: UAMP fixture catalog planning only
Runtime impact: none
Base: `KUSABI_V2_UAMP_CONFORMANCE_PLAN.md`

## 1. Purpose and status

This document defines the future UAMP fixture catalog for Kusabi V2.

This is a fixture catalog, not fixture implementation. Runtime behavior is
unchanged.

This PR does not:

- create fixture files;
- create fixture directories;
- create schema files;
- implement a runner;
- add npm scripts;
- change runtime emitters;
- change package identity;
- change MCP namespace;
- change environment variables;
- change DB paths or migrations;
- claim UAMP conformance;
- claim backend parity;
- claim legal or regulatory compliance.

This catalog defines what future fixtures must exist before U2 fixture evidence
can be claimed. U2 itself still requires actual fixture files, a runner, reports,
and owner-reviewed pass/fail evidence.

## 2. Fixture principles

- Fixtures are evidence, not implementation.
- Each fixture must have a stable fixture id.
- Every fixture must state profile, expected result, required fields, and
  failure reason when applicable.
- Positive fixtures prove accepted behavior.
- Negative fixtures prove rejection behavior.
- Mapping fixtures prove compatibility from current Kusabi/Wasurezu artifacts.
- Security fixtures prove source text remains data-only and redaction boundaries
  hold.
- Backend fixtures prove claims are backend-specific.
- Suite interop fixtures prove UAMP/AUN/Kodama/Shirube boundaries do not
  collapse.
- Fixture reports must name unsupported and skipped cases explicitly.
- A passed fixture must not create a broader release, compliance, backend parity,
  or UAMP conformance claim than the runner evidence supports.

## 3. Fixture directory plan

Future implementation should use an explicit, reviewable directory layout.

Proposed future layout:

```text
tests/uamp/fixtures/
  positive/
  negative/
  mapping/
  adapters/
  recovery-quality/
  security/
  retention/
  backend/
  suite-interop/
  enterprise-pilot/
```

Do not create these directories in this PR.

## 4. Fixture metadata shape

This TypeScript-like metadata shape is documentation only. It is not a schema
file and does not authorize fixture implementation.

```ts
interface UAMPFixtureMetadataDraft {
  fixture_id: string;
  title: string;
  profile:
    | "uamp-core"
    | "uamp-recovery"
    | "uamp-host-adapter"
    | "uamp-security"
    | "uamp-retention"
    | "uamp-suite-interop"
    | "uamp-backend-parity"
    | "uamp-enterprise-pilot";
  fixture_type:
    | "positive"
    | "negative"
    | "mapping"
    | "adapter"
    | "recovery_quality"
    | "security"
    | "retention"
    | "backend"
    | "suite_interop"
    | "enterprise_pilot";
  input_artifact: string;
  expected_result: "pass" | "fail";
  expected_failure_code?: string;
  required_evidence: string[];
  prohibited_claims?: string[];
  notes?: string[];
}
```

Minimum metadata requirements:

- `fixture_id` must be stable and report-citable.
- `profile` must match the claim surface being tested.
- `expected_result=fail` must include `expected_failure_code`.
- `required_evidence` must identify source refs, provenance, redaction,
  retention, backend, host, or suite boundary evidence as applicable.
- `prohibited_claims` must list claims the fixture must not be used to make.

## 5. Positive fixture catalog

Future positive fixtures should include at least these cases.

| Fixture id | Purpose | Minimum required fields | Expected result | Profile |
| --- | --- | --- | --- | --- |
| `uamp-positive-memory-decision-v1` | Decision memory item is accepted. | `artifact_type`, `memory_class`, `kind=decision`, source refs, provenance, agent/project boundary. | pass | `uamp-core` |
| `uamp-positive-memory-task-state-v1` | Task state or working memory item is accepted. | task/work item id, status, source refs, provenance, memory class. | pass | `uamp-core` |
| `uamp-positive-memory-knowledge-v1` | Knowledge memory item is accepted without becoming instruction. | title/content summary, source refs, provenance, status. | pass | `uamp-core` |
| `uamp-positive-raw-event-source-v1` | Raw source item remains data-only. | source ref, content hash, redaction state, memory class `raw_event_source`. | pass | `uamp-security` |
| `uamp-positive-conversation-event-source-v1` | Conversation event maps as raw source. | source, role, occurred time, content hash, provenance. | pass | `uamp-core` |
| `uamp-positive-recovery-pack-v1` | Recovery pack with source refs and missing context is accepted. | pack id, selected items, source refs, confidence, missing context. | pass | `uamp-recovery` |
| `uamp-positive-host-adapter-capability-v1` | Host adapter capability declaration is accepted. | host, delivery mode, startup capability, unsupported capabilities. | pass | `uamp-host-adapter` |
| `uamp-positive-lifecycle-event-v1` | Lifecycle event is accepted as evidence. | event type, actor/source, artifact refs, lifecycle owner, outcome. | pass | `uamp-core` |
| `uamp-positive-redaction-summary-v1` | Redaction summary travels with artifact. | redaction version, applied state, omitted fields, fixture family refs. | pass | `uamp-security` |
| `uamp-positive-retention-policy-v1` | Retention policy ref is accepted as evidence. | retention policy ref, TTL/legal hold/purge eligibility fields. | pass | `uamp-retention` |
| `uamp-positive-selected-restart-pack-ref-v1` | Selected restart pack remains handoff ref. | `selected_restart_pack:<id>`, pack ref, consume state, source evidence. | pass | `uamp-recovery` |
| `uamp-positive-backend-sqlite-recovery-v1` | SQLite recovery evidence is accepted with local/default claim only. | backend=`sqlite`, DB path evidence, recovery refs, prohibited PG/common DB claims. | pass | `uamp-backend-parity` |
| `uamp-positive-backend-postgres-recovery-v1` | PostgreSQL recovery evidence is accepted with PG-specific claim only. | backend=`postgres`, connection/migration evidence, recovery refs. | pass | `uamp-backend-parity` |
| `uamp-positive-backend-json-dev-v1` | JSON fallback/dev evidence is accepted with limited claim. | backend=`json`, file refs, dev/manual claim boundary. | pass | `uamp-backend-parity` |
| `uamp-positive-suite-interop-refs-v1` | Suite refs remain separated. | UAMP refs, AUN lifecycle refs, Kodama labels, Shirube approval refs, trust boundary notes. | pass | `uamp-suite-interop` |

## 6. Negative fixture catalog

Future negative fixtures should include at least these rejection cases.

| Fixture id | Invalid behavior | Expected failure code | Profile |
| --- | --- | --- | --- |
| `uamp-negative-raw-transcript-as-trusted-instruction-v1` | Raw transcript copied into `trusted_instruction`. | `trust_escalation_from_source_text` | `uamp-security` |
| `uamp-negative-approved-without-promotion-v1` | `approved_memory` lacks promotion evidence. | `missing_promotion_evidence` | `uamp-core` |
| `uamp-negative-missing-provenance-v1` | Artifact lacks provenance. | `missing_provenance` | `uamp-core` |
| `uamp-negative-missing-source-refs-l2-v1` | L2+ claim lacks source refs. | `missing_source_refs_for_claim` | `uamp-recovery` |
| `uamp-negative-unredacted-secret-output-v1` | Recovery or memory output contains unredacted secret-bearing text. | `unredacted_secret_output` | `uamp-security` |
| `uamp-negative-cross-agent-no-grant-v1` | Cross-agent memory is used without federation grant. | `missing_federation_grant` | `uamp-security` |
| `uamp-negative-cross-tenant-v1` | Cross-tenant memory appears without tenant model and authorization. | `cross_tenant_forbidden` | `uamp-security` |
| `uamp-negative-session-id-namespace-v1` | `session_id` is used as memory namespace. | `session_id_as_namespace` | `uamp-core` |
| `uamp-negative-runtime-source-namespace-v1` | Runtime/source is used as memory namespace. | `runtime_source_as_namespace` | `uamp-core` |
| `uamp-negative-aun-claim-as-agent-id-v1` | AUN claim id replaces `agent_id`. | `external_lifecycle_id_as_agent_id` | `uamp-suite-interop` |
| `uamp-negative-aun-lifecycle-mutation-v1` | UAMP artifact mutates AUN lifecycle. | `uamp_mutates_external_lifecycle` | `uamp-suite-interop` |
| `uamp-negative-kodama-label-invented-v1` | Kusabi invents or overrides Kodama source labels. | `source_policy_label_not_owned` | `uamp-suite-interop` |
| `uamp-negative-shirube-approval-promotes-memory-v1` | Shirube approval is treated as raw memory promotion. | `governance_ref_not_memory_promotion` | `uamp-suite-interop` |
| `uamp-negative-schema-ref-mismatch-v1` | Artifact declares incompatible schema ref. | `schema_ref_mismatch` | `uamp-core` |
| `uamp-negative-unknown-artifact-no-extension-v1` | Unknown artifact type lacks extension marker. | `unknown_artifact_without_extension` | `uamp-core` |
| `uamp-negative-backend-parity-no-evidence-v1` | Backend parity is claimed without backend evidence. | `backend_parity_claim_without_evidence` | `uamp-backend-parity` |
| `uamp-negative-postgres-catchup-stub-claim-v1` | PostgreSQL catch-up parity is claimed where behavior is stubbed or untested. | `postgres_catchup_parity_unproven` | `uamp-backend-parity` |
| `uamp-negative-compliance-from-attestation-v1` | Legal compliance is claimed from attestation packet alone. | `compliance_claim_not_supported` | `uamp-enterprise-pilot` |
| `uamp-negative-conformance-no-runner-v1` | UAMP conformance is claimed without runner evidence. | `conformance_claim_without_runner` | `uamp-core` |

## 7. Mapping fixture catalog

Future mapping fixtures must preserve current Kusabi/Wasurezu compatibility
surfaces without replacing them.

| Fixture id | Current artifact | UAMP draft target | Required evidence |
| --- | --- | --- | --- |
| `uamp-mapping-recovery-pack-v1` | `recovery-pack/v1` | `uamp/v1#RecoveryPack` | source refs, confidence, missing context, redaction state. |
| `uamp-mapping-host-invocation-context-v1` | `host-invocation-context/v1` | UAMP host adapter envelope/capability | target runtime, delivery mode, data-only policy. |
| `uamp-mapping-selected-restart-pack-v1` | `selected_restart_pack:<id>` | recovery pack reference / handoff ref | pack ref, status, consume state, source refs. |
| `uamp-mapping-decision-v1` | `decision` | `uamp/v1#MemoryItem` | decision kind, source refs, provenance, status. |
| `uamp-mapping-task-state-v1` | `task_state` | `uamp/v1#MemoryItem` | task id, status, progress, provenance. |
| `uamp-mapping-knowledge-v1` | `knowledge` | `uamp/v1#MemoryItem` | title/content summary, source ids, lifecycle status. |
| `uamp-mapping-raw-event-v1` | `raw_event` | `uamp/v1#MemoryItem` | raw source class, source ref/hash, redaction state. |
| `uamp-mapping-conversation-event-v1` | `conversation_event` | raw source `MemoryItem` | compatibility source marker, content hash, role/source. |
| `uamp-mapping-recovery-quality-log-v1` | `recovery_quality_log` | recovery quality evidence / lifecycle observation | score refs, recovered tokens, quality notes, missing context where present. |
| `uamp-mapping-backend-report-v1` | backend-specific recovery report | UAMP evidence refs | backend id, fixture report refs, prohibited backend parity claims. |
| `uamp-mapping-attestation-packet-v1` | compliance attestation packet | UAMP evidence refs | packet id, claim level, missing evidence, no compliance laundering. |

## 8. Security / redaction fixture catalog

Future security fixtures should cover these families:

- OpenAI/Anthropic style `sk-*` keys;
- GitHub token family;
- AWS access keys;
- Slack tokens;
- Stripe keys and webhook signing secrets;
- bearer tokens;
- JWTs;
- webhook URLs;
- PEM/private key blocks;
- secrets in URL query params;
- secrets inside markdown code fences;
- secrets inside SQL literals;
- adjacent/compound secrets;
- emails and unnecessary personal data;
- local home paths and workspace paths;
- hidden reasoning / developer/base instruction body exclusion.

Fixture expectations:

- source text remains data-only;
- redaction state travels with UAMP artifacts;
- secret-bearing output is rejected or redacted;
- private reasoning and developer/base instruction bodies are excluded;
- redaction failures produce explicit failure codes;
- unsupported families are reported as unsupported, not silently passed.

This catalog does not implement redaction tests; it defines future fixture
coverage.

Release-blocking redaction output-surface parity is defined in
`KUSABI_V2_REDACTION_PARITY_GATE.md`. That gate remains docs-only until fixture
files, probes, runner evidence, and CI/release-blocking behavior are separately
approved and implemented.

## 9. Backend fixture catalog

Future backend fixtures must align with `KUSABI_V2_BACKEND_PARITY_MATRIX.md`.

Required fixture families:

- SQLite default clean install evidence;
- SQLite migration idempotency;
- PostgreSQL configured intent fail-closed behavior;
- PostgreSQL optional/team backend evidence;
- JSON fallback/dev behavior;
- LIKE/FTS/vector search differences;
- `catch_up` / `catch_up_log` parity gap;
- `raw_events` / `conversation_events` backend mapping;
- common DB refs as evidence only.

Backend fixture rules:

- no backend parity claim from this catalog alone;
- every fixture report must state backend and selection evidence;
- search/ranking expectations must be backend-specific;
- fallback behavior must state whether fallback was allowed or blocked;
- common DB refs must remain evidence and binding refs, not identity policy.

## 10. Suite interop fixture catalog

Future suite interop fixtures must preserve the suite boundary.

| Fixture id | Boundary proven | Required evidence |
| --- | --- | --- |
| `uamp-suite-aun-provenance-only-v1` | AUN task/runtime lifecycle refs are provenance only. | AUN ref, Kusabi memory ref, no lifecycle mutation. |
| `uamp-suite-aun-references-uamp-v1` | AUN may reference UAMP artifact without ownership transfer. | artifact ref, lifecycle owner, no state mutation by UAMP. |
| `uamp-suite-kodama-label-raw-source-v1` | Kodama label attaches to raw source memory item. | label ref, source ref, data-only class. |
| `uamp-suite-kodama-unsafe-downgrade-v1` | Unsafe label causes omission or trust downgrade. | unsafe label, omitted refs or downgrade reason. |
| `uamp-suite-shirube-approval-evidence-v1` | Shirube approval ref is governance evidence only. | work-order/approval ref, no automatic memory promotion. |
| `uamp-suite-host-delivery-no-lifecycle-v1` | Host adapter delivery mode does not own lifecycle. | host capability, delivery mode, external lifecycle owner. |
| `uamp-suite-cross-boundary-downgrade-v1` | Cross-boundary context is trust-downgraded. | source boundary, resulting memory class, promotion blocker. |

## 11. Recovery quality fixture catalog

Future recovery quality fixtures must connect UAMP recovery artifacts to
measured recovery evidence without claiming automatic startup recovery.

Required fixture families:

- 30-point recovery score report;
- automatic failure case;
- score cap case;
- restatement incident levels;
- missing first-context recovery;
- manual MCP recovery vs startup recovery distinction;
- degraded recovery with `missing_context`;
- backend-specific score evidence;
- host-specific startup evidence.

These fixtures must follow `KUSABI_V2_RECOVERY_SCORE_CONTRACT.md`. A recovery
quality fixture can support score evidence only when report, host, backend, and
claim eligibility fields are present.

## 12. Enterprise pilot fixture catalog

Future enterprise pilot fixtures should cover:

- recovery run attestation;
- redaction report;
- retention report;
- deletion request denied / unsupported;
- export request with missing evidence;
- pilot scorecard packet;
- UAMP conformance not implied by compliance packet;
- compliance not implied by UAMP conformance.

Enterprise pilot fixtures are not legal certification. They may support operator
review evidence only when paired with accepted compliance/attestation boundaries,
security/redaction fixtures, and owner-reviewed claim levels.

## 13. Fixture acceptance gates

| Gate | Required before claim | Not allowed |
| --- | --- | --- |
| U2 fixture catalog | This catalog is accepted. | Fixture files, runner, or conformance claim. |
| U2 fixture evidence | Fixture files and runner exist, with reports. | UAMP conformance without required pass/fail evidence. |
| U3 second adapter | At least one second adapter path produces or consumes artifacts with evidence. | Portable conformance claim from Kusabi-only evidence. |
| L3/L4 release claims | Security/redaction and recovery quality fixture evidence exists. | Release claim from implementation presence alone. |
| Backend parity claims | Backend fixture evidence exists for the claimed surfaces. | Backend parity from green CI or shared interface alone. |
| Compliance support | Attestation examples, missing evidence, and legal/compliance review where applicable. | Legal/regulatory compliance claim from fixtures alone. |

U2 cannot be claimed until fixture files and runner exist. U3 cannot be claimed
until second adapter evidence exists. L3/L4 release claims need
security/redaction and recovery quality fixture evidence. Backend parity claims
need backend fixture evidence. Compliance claims are not created by fixtures
alone.

## 14. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- create fixture files;
- create fixture directories;
- create schema files;
- implement a runner;
- add package scripts;
- change runtime emitters;
- change MCP namespace;
- rename schema IDs;
- enable cross-agent reads;
- claim backend parity;
- claim UAMP conformance;
- claim legal or regulatory compliance;
- change package identity;
- change env vars;
- change DB paths or migrations;
- change workflows;
- change deployment files.
