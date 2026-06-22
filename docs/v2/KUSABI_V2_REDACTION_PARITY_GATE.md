# Kusabi V2 Redaction Parity Gate Draft

Status: draft
Scope: redaction parity gates and fixture plan only
Runtime impact: none
Base: `KUSABI_V2_SECURITY_AND_RETENTION_BOUNDARY.md`,
`KUSABI_V2_UAMP_FIXTURE_CATALOG.md`

## 1. Purpose and status

This document defines the Kusabi V2 redaction parity gate: what future redaction
probes must cover before L3/L4, enterprise pilot, or world-class claims can be
made.

This is a redaction parity gate plan, not implementation.

This PR does not:

- change runtime behavior;
- create fixture directories;
- create fixture files;
- create schema files;
- implement a redaction probe runner;
- add npm scripts;
- add CI gates;
- change package identity;
- change MCP namespace;
- change environment variables;
- change DB paths or migrations;
- change workflows;
- change deployment files;
- implement export or reveal behavior;
- claim DLP;
- claim zero secret leakage;
- claim legal or regulatory compliance;
- claim release readiness.

```text
Kusabi redaction is a probe-backed safety control for known sensitive patterns.
It is not a general-purpose DLP system, secret manager, or legal/compliance guarantee.
```

## 2. Redaction posture

Redaction posture:

```text
best-effort known-pattern detection + output-surface parity + explicit limitations
```

| Claim | Current status | Required before claim |
| --- | --- | --- |
| Known-pattern redaction | implemented partially / expanding | fixture coverage + output-surface probes |
| Output-surface parity | design target | all supported surfaces probed |
| DLP guarantee | not claimed | never claim from Kusabi alone |
| Zero secret leakage | not claimed | never claim |
| Compliance evidence support | design target | attestation packet + redaction report |
| Release-blocking redaction gate | future implementation | CI/release gate in separate PR |

Redaction evidence must name unsupported families and unscanned surfaces. A
partial redaction result can support engineering review only when limitations
are visible in the recovery, release, or attestation evidence packet.

## 3. Redaction surfaces

Every future release claim must name which output surfaces were probed.

| Surface | Current support status | Required probe type | Release claim dependency | Missing-evidence behavior |
| --- | --- | --- | --- | --- |
| Ingest adapters | current/future by adapter | persistence-input probe with source refs | L3+ ingest and recovery claims | mark adapter as unscanned or unsupported |
| Persistence boundary | current/future | stored-value and redaction-state probe | L3+ storage claims | block stored-redaction claim |
| `restart_pack` text | current | text-output secret family probe | L2/L3/L4 recovery claims | visible missing evidence; block L3+ if sensitive fixture present |
| `recovery-pack/v1` JSON | current | JSON field probe for summaries/items | L2/L3/L4 structured recovery claims | visible missing evidence; exclude structured recovery claim if unscanned |
| `host-invocation-context/v1` JSON | current | JSON envelope and context-data probe | L2/L3/L4 host adapter claims | visible missing evidence; exclude host path if unscanned |
| future `uamp/v1#RecoveryPack` | future | UAMP security profile probe | UAMP/security claims | cannot claim UAMP security profile |
| `search_memory` | current | MCP output probe across scopes | L3/L4 search/reveal-adjacent claims | block L3+ search claim if unscanned |
| `recover_context` | current | MCP output probe | L3/L4 manual recovery claims | block L3+ recovery claim if unscanned |
| Boot fallback output | current/future | fallback text-output probe | L3/L4 startup fallback claims | visible missing evidence; exclude fallback from claim |
| Codex bridge prompt/output | current/future | bridge payload and rendered-output probe | L2/L3/L4 Codex startup claims | block Codex path claim if sensitive fixture leaks |
| Claude runner/hook output | current/future | loaded recovery context probe | L2/L3/L4 Claude startup claims | block Claude path claim if sensitive fixture leaks |
| Logs/errors/diagnostics | current/future | error-path and diagnostics probe | L3/L4 operational claim | visible limitation; block if known secret emitted |
| Recovery score reports | current/future | score report redaction-summary probe | L2+ recovery score claims | score report marks `missing_evidence`; secret leak is automatic failure |
| Compliance attestation packets | future | attestation redaction-summary probe | enterprise pilot evidence | cannot support attestation claim if missing |
| Export/reveal outputs if implemented later | not implemented | scoped export/reveal output probe | future export/reveal claim | stop; not in current claim scope |

Unsupported or not-implemented surfaces must be excluded from claim scope rather
than silently treated as safe.

## 4. Sensitive pattern families

Future fixture families must cover:

- OpenAI / Anthropic style `sk-*` keys;
- GitHub token family;
- AWS access keys;
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
- database URLs;
- local absolute paths / home paths;
- emails and unnecessary personal data;
- hidden reasoning / private chain / developer/base instruction bodies.

This PR only documents fixture families. It must not create fixture files.

## 5. Redaction result states

Draft `redaction_state` values:

| State | Meaning | Claim rule |
| --- | --- | --- |
| `not_applicable` | The surface or artifact does not contain redaction-relevant content. | Allowed only with evidence explaining why. |
| `redacted` | Known sensitive pattern was removed or replaced. | Can support scoped claim if all required probes pass. |
| `partially_redacted` | Some known sensitive content was redacted, but unsupported families remain. | Must identify unsupported families. |
| `unredacted_known_pattern` | A known sensitive pattern remains visible. | Blocks L3/L4 claims. |
| `unscanned` | The surface was not probed. | Cannot support release-ready claims. |
| `missing_evidence` | Probe or redaction evidence is absent or incomplete. | Must be visible in recovery/attestation reports. |

Claim rules:

- `unredacted_known_pattern` blocks L3/L4 claims.
- `unscanned` cannot support release-ready claims.
- `missing_evidence` must be visible in recovery and attestation reports.
- `partially_redacted` must identify unsupported families.
- Redaction success on one surface does not imply redaction parity on another
  surface.

## 6. Positive fixture catalog

Future positive fixtures should include at least these examples.

| Fixture id | Surface | Sensitive family | Expected redaction result | Required evidence |
| --- | --- | --- | --- | --- |
| `redaction-positive-restart-pack-api-key-v1` | `restart_pack` text | OpenAI/Anthropic style key | `redacted` | raw fixture ref, redacted output ref, redaction version. |
| `redaction-positive-recovery-pack-token-v1` | `recovery-pack/v1` JSON | bearer token in item summary | `redacted` | JSON path, omitted field/ref, redaction summary. |
| `redaction-positive-host-context-data-only-v1` | `host-invocation-context/v1` JSON | token in context data | `redacted` | data-only policy, JSON path, redaction state. |
| `redaction-positive-search-memory-bearer-v1` | `search_memory` | bearer token | `redacted` | MCP output ref, scope, query, redaction state. |
| `redaction-positive-recover-context-webhook-v1` | `recover_context` | webhook URL | `redacted` | recovery output ref, source refs, omitted field. |
| `redaction-positive-boot-fallback-db-url-v1` | boot fallback output | database URL | `redacted` | fallback output ref, DB URL placeholder evidence. |
| `redaction-positive-codex-bridge-token-v1` | Codex bridge prompt/output | token in prompt payload | `redacted` | bridge payload ref, rendered output ref, redaction version. |
| `redaction-positive-claude-hook-token-v1` | Claude runner/hook output | token in loaded recovery context | `redacted` | hook output ref, source refs, redaction version. |
| `redaction-positive-recovery-score-summary-v1` | recovery score report | raw secret in evidence source | `redacted` | score report redaction summary, no raw secret in report. |
| `redaction-positive-attestation-redaction-ref-v1` | compliance attestation packet | redaction evidence ref | `redacted` | attestation packet ref, redaction evidence ref, no raw secret. |

## 7. Negative fixture catalog

Future negative fixtures must fail when any of these occur.

| Fixture id | Invalid behavior | Expected failure code |
| --- | --- | --- |
| `redaction-negative-secret-in-restart-pack-v1` | Raw secret appears in `restart_pack`. | `unredacted_restart_pack_secret` |
| `redaction-negative-secret-in-recovery-json-v1` | Raw secret appears in JSON recovery pack. | `unredacted_recovery_pack_secret` |
| `redaction-negative-secret-in-search-memory-v1` | Raw secret appears in `search_memory`. | `unredacted_search_memory_secret` |
| `redaction-negative-secret-in-recover-context-v1` | Raw secret appears in `recover_context`. | `unredacted_recover_context_secret` |
| `redaction-negative-private-key-boot-output-v1` | Private key block appears in boot output. | `unredacted_private_key_boot_output` |
| `redaction-negative-db-url-error-output-v1` | Database URL appears in error output. | `unredacted_database_url_error` |
| `redaction-negative-code-fence-bypass-v1` | Secret inside markdown code fence bypasses redaction. | `code_fence_secret_bypass` |
| `redaction-negative-jwt-bridge-prompt-v1` | JWT appears in bridge prompt. | `unredacted_jwt_bridge_prompt` |
| `redaction-negative-home-path-required-normalization-v1` | Local home path appears where path normalization is required. | `home_path_not_normalized` |
| `redaction-negative-hidden-reasoning-persisted-v1` | Hidden reasoning or developer/base instruction body is persisted or emitted. | `private_instruction_body_exposed` |
| `redaction-negative-complete-claim-unscanned-v1` | Redaction summary claims complete coverage when an output surface was unscanned. | `redaction_claim_unscanned_surface` |
| `redaction-negative-attestation-raw-secret-v1` | Attestation packet includes raw secret. | `attestation_contains_raw_secret` |

## 8. Output-surface parity matrix

| Surface | Required before L2 | Required before L3 | Required before L4 | Missing evidence behavior |
| --- | --- | --- | --- | --- |
| Ingest adapters | name missing evidence if involved | required for claimed ingest paths | release-blocking for supported ingest paths | exclude unscanned adapters |
| Persistence boundary | name backend/storage evidence | required for stored-memory pilot claims | release-blocking for supported storage paths | block stored-redaction claim |
| `restart_pack` text | required for measured recovery if pack contains fixture data | required | release-blocking | block L3/L4 if sensitive fixture leaks |
| `recovery-pack/v1` JSON | required for structured recovery claims | required | release-blocking | exclude structured recovery claim |
| `host-invocation-context/v1` JSON | required for host startup claims | required | release-blocking | exclude host path claim |
| future `uamp/v1#RecoveryPack` | not applicable unless emitted | required for UAMP security claims | release-blocking if UAMP emitted | cannot claim UAMP security profile |
| `search_memory` | limitation may be visible | required | release-blocking | block L3/L4 search claim |
| `recover_context` | limitation may be visible | required | release-blocking | block L3/L4 recovery claim |
| Boot fallback output | limitation may be visible | required if supported | release-blocking if supported | exclude fallback claim |
| Codex bridge prompt/output | required for Codex L2 path when sensitive fixture is present | required | release-blocking | block Codex startup claim if leak occurs |
| Claude runner/hook output | required for Claude L2 path when sensitive fixture is present | required | release-blocking | block Claude startup claim if leak occurs |
| Logs/errors/diagnostics | limitation visible | required for operational pilot | release-blocking for supported diagnostics | block if known secret emitted |
| Recovery score reports | redaction summary required for L2 score evidence | required | release-blocking | score report marks `missing_evidence`; secret leak fails score |
| Compliance attestation packets | not applicable unless packet exists | required for pilot attestation | release-blocking for enterprise packet | cannot support attestation claim |
| Export/reveal outputs if implemented later | not applicable | out of scope unless implemented | release-blocking if implemented | stop; not current claim scope |

Rules:

- L2 measured recovery can tolerate documented missing redaction surfaces only if
  no sensitive fixture is present and the limitation is visible.
- L3 enterprise pilot requires search, recovery, boot, bridge, and hook surfaces
  probed for the claimed host paths.
- L4 world-class requires all supported release surfaces probed and
  release-blocking.
- Unsupported or not-implemented surfaces must be excluded from claim scope.

## 9. Relationship to UAMP

- UAMP artifacts may include `redaction` and `redaction_summary`.
- UAMP conformance does not imply all redaction families are covered unless the
  `uamp-security` profile is passed.
- `KUSABI_V2_UAMP_FIXTURE_CATALOG.md` lists security families; this document
  defines release-blocking redaction parity gates.
- UAMP artifacts must not launder redaction missing evidence into safe status.
- A UAMP artifact with `redaction_state=missing_evidence` must remain in a
  limited claim state.

## 10. Relationship to compliance/attestation

- Redaction reports may feed attestation packets.
- Redaction evidence supports review, not legal certification.
- Redaction is not DLP.
- Redaction failure must be visible in `missing_evidence`.
- Compliance claims remain forbidden without separate legal/compliance review.
- Attestation packets must reference redaction evidence without embedding raw
  secrets.

## 11. Relationship to backend parity and recovery scoring

- Backend parity claims must include backend-specific redaction evidence where
  outputs differ.
- Recovery score reports must include redaction summary.
- Secret leakage is an automatic recovery-score failure.
- Backend-specific search/ranking must not bypass redaction.
- A passing backend fixture does not prove redaction parity unless the output
  surfaces for that backend were probed.

## 12. Gate maturity ladder

| Level | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| R0 - boundary documented | Kusabi has a draft redaction parity boundary. | This document accepted. | Fixture, runner, CI, DLP, zero-leakage, or compliance claim. |
| R1 - fixture catalog accepted | Required fixture families and surfaces are accepted. | `KUSABI_V2_UAMP_FIXTURE_CATALOG.md` and this document. | Implemented fixture claim. |
| R2 - output-surface matrix accepted | Output-surface parity expectations are accepted. | Owner/domain-designer review and missing-evidence policy. | Release-blocking gate claim. |
| R3 - fixture files implemented | Redaction fixture files exist. | Separate fixture PR, fixture IDs, expected results. | Runner or CI gate claim unless implemented. |
| R4 - runner/probe implemented | Redaction probe runner exists. | Runner code, reports, positive/negative pass evidence. | L4 release claim without full surface coverage. |
| R5 - CI/release-blocking gate enabled | Redaction gate blocks release on known leaks. | CI/release config, fail examples, rollback/no-op behavior. | DLP or zero-leakage guarantee. |
| R6 - enterprise pilot evidence packet | Pilot evidence includes redaction report. | Attestation packet, redaction report, missing evidence, limitations. | Legal/regulatory compliance certification. |

## 13. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- create fixture directories;
- create fixture files;
- create schema files;
- implement redaction probes;
- implement a redaction runner;
- add npm scripts;
- add CI gates;
- change runtime output;
- change package identity;
- change MCP namespace;
- change environment variables;
- change DB paths or migrations;
- change workflows;
- change deployment files;
- claim DLP;
- claim zero secret leakage;
- claim legal or regulatory compliance;
- claim release readiness from this PR alone;
- implement export or reveal behavior;
- read or persist private reasoning, hidden chain, or developer/base instruction
  bodies.
