# World-Class MCP Release Criteria

> Project: Kusabi / wasurezu / agent-memory
> Status: AM-034 release planning gate
> Purpose: Define the final public-release bar and the shortest credible path to a world-class MCP launch.
> Authority: `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` for continuity policy and `docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md` for runtime identity.

---

## 1. North Star

Kusabi / wasurezu should be good enough that a serious AI engineering team at a major
technology company would want to evaluate it for real agent workflows.

The product promise is:

1. An AI coding agent can restart without losing the current objective.
2. The recovered context is concise, safe, and immediately actionable.
3. If the restart pack is incomplete, the agent can search redacted
   conversation memory before asking the user to restate context.
4. Structured memory (`task_states`, `decisions`, `knowledge`) and raw
   conversation memory have clear roles and audit trails.
5. The product is honest about client differences:
   - Claude Code uses a runner plus native SessionStart load hook.
   - Codex uses bridge-based startup recovery through a runtime adapter.
   - Plain MCP tools alone are manual recovery, not startup recovery.
6. Public naming can say Kusabi, while package/config/MCP namespace/database
   compatibility remains wasurezu until a governed migration explicitly changes
   it.

This document is stricter than the internal default-ready gate. Internal use may
start earlier; world-class public release waits for the gates below.

This document is a release gate, not a release claim. Passing one planning PR
does not make the project public-alpha-ready or world-class-ready.

---

## 2. Release Levels

| Level | Audience | What We Can Claim | Required Gate |
|-------|----------|-------------------|---------------|
| Internal opt-in | IYASAKA bots selected by humans | "Available for controlled use." | L1/L2/L3 audit pass, no safety blocker, smoke recovery works. |
| Internal default | IYASAKA dev/lead bots | "Default restart recovery for internal bots." | 2 consecutive recovery runs at 26/30+, no automatic failure. |
| MCP public alpha | External developers and early adopters | "Early-stage MCP memory with measured restart recovery." | 3 consecutive recovery runs at 27/30+, including Claude Code and Codex bridge. |
| World-class public release | Serious teams and major technology companies | "Production-evaluable MCP memory substrate for AI coding agents." | 5 consecutive recovery runs at 28/30+, plus security, docs, clean install, and observability gates. |

---

## 3. Current Position

As of 2026-06-12:

| Area | Status | Notes |
|------|--------|-------|
| AM-031 restart_pack quality | Strong but still evidence-gated | PR #88 and #89 merged; restart_pack remains bounded/source-bearing and must be re-evaluated after release-surface changes. |
| Control-plane boundary | Established | #108 / #109 made SSOT-6/7 authoritative. TUI input, SessionStart self-kick, AGENTS.md first-action recovery, and tool-description recovery are fallback/adapter paths only. |
| Codex startup bridge | Implemented, hardening in progress | PR #91 merged. #92/#99 hardening is represented by PR #135 and remains audit/merge gated. |
| Deterministic prepare / selected pack handoff | Implemented | AM-038 / AM-039 landed through #102 / #105 / #106. `restart_prepare`, selected pack refs, and `wasurezu-restart` are existing capabilities. |
| Raw event / continuity foundation | Implemented foundation | #124 and #132 landed initial raw-event and continuity guard slices. More release evidence is still required. |
| Kusabi naming transition | All phases landed | #128-#131 closed. `kusabi` bin alias present. `wasurezu` package/config/MCP namespace/database compatibility preserved. |
| AM-026 catch-up / Source A sweep | Implemented | PR #155 merged. `catch_up` MCP tool with dedup ledger, full jsonl sweep. |
| Gate 0 CI coverage | Substantially expanded | PRs #157-#161: SQLite isolation, migration idempotency, no-secret recovery, supervisor preflight, search_memory regression. All in CI hard gate. |
| Restart supervisor preflight | Implemented | PR #160 merged. `wasurezu-restart preflight` detects legacy relative-path configs and provides remediation. |
| MCP public alpha readiness | Not yet | Needs audited #135 or equivalent, fresh Claude/Codex recovery runs, clean install evidence, security/privacy docs, and release audit. |
| World-class readiness | Not yet | Needs broader safety suite, clean install evidence, observability, release docs, and consecutive recovery score evidence. |

Approximate readiness:

- Internal opt-in: 90%
- Internal default: 80-85%
- MCP public alpha: 65-70%
- World-class public release: 50-55%

These percentages are planning estimates only. They must not be used as
marketing, public-alpha, or enterprise-readiness claims.

---

## 4. World-Class Release Gate

All requirements in this section are mandatory for a world-class public release.

### 4.1 Recovery Quality

- 5 consecutive recovery evaluations at 28/30 or higher.
- No automatic failure.
- Includes at least:
  - Claude Code SessionStart runs x2.
  - Codex bridge startup runs x2.
  - Clean install / fresh DB run x1.
- 0 cases where the user must restate the project from scratch.
- 0 destructive stale-context actions.
- PR/status answers use GitHub or the relevant external SSOT before acting.
- Recovery reports include probe answers, scorecards, evidence, and known gaps.

### 4.2 Security And Privacy

- Ingest-time redaction and output-boundary redaction are both active.
- Redaction is verified for:
  - OpenAI / Anthropic-style API keys.
  - AWS access keys.
  - GitHub tokens.
  - Slack tokens.
  - Stripe `sk_test_` / `sk_live_` keys.
  - Bearer tokens.
  - JWTs.
  - Webhook URLs.
  - PEM/private key blocks.
  - Secrets in URL query params.
  - Secrets inside markdown code fences and SQL string literals.
- `restart_pack`, `search_memory`, Claude boot output, and Codex bridge output
  all pass secret-output probes.
- Full home paths are normalized.
- Raw transcript dumps are not emitted by recovery surfaces.
- Private reasoning, base instructions, and developer instructions are not
  persisted as user-visible conversation memory.
- `SECURITY.md`, privacy notes, data-retention behavior, and known limitations
  are documented.

### 4.3 Multi-Client Compatibility

- Claude Code:
  - `wasurezu-claude-start` runner path documented.
  - SessionStart load hook documented as a load/adapter path, not restart policy owner.
  - PostCompact or equivalent recovery path documented where supported.
- Codex:
  - `wasurezu-codex-start` or a better runtime adapter is documented.
  - Tested Codex CLI contract and prompt argv visibility limitation are visible.
  - Plain MCP config is explicitly labeled manual recovery.
  - A Codex bridge fresh-run recovery evaluation is recorded.
- MCP:
  - Standard MCP server setup works.
  - Tool list and contracts are documented.
- Storage:
  - SQLite default works from clean install.
  - PostgreSQL optional path works and has migration docs.

### 4.4 Reliability

- CI passes on Node 18 / 20 / 22.
- Unit, integration, boot E2E, SQLite, and PostgreSQL tests pass.
- Boot and bridge failures are non-destructive and explain next steps.
- DB unreachable does not break the host agent startup path.
- Transcript ingest is idempotent.
- Duplicate event handling is tested.
- Migrations and upgrade notes are documented.
- Cross-backend behavior differences are documented or tested.

### 4.5 Observability

- `recovery_quality_log` records every startup recovery attempt.
- Recovery source is distinguishable, for example:
  - `restart_pack_boot`
  - `codex_startup_bridge`
  - `manual_mcp_recovery`
- Recovery evidence includes:
  - recovered token count
  - search count or search queries
  - task continuation
  - safety warnings
  - omitted structured-memory count
  - client/runtime source
- Public examples show how to interpret good and bad recovery logs.

### 4.6 Product Documentation

- README quick start takes less than 5 minutes for SQLite local use.
- Separate guides exist for:
  - Claude Code
  - Codex bridge
  - PostgreSQL
  - transcript ingest
  - recovery evaluation
  - troubleshooting
  - upgrade / uninstall
- Compatibility matrix is explicit and conservative.
- Known limitations are visible before installation.
- No doc claims "fully automatic Codex recovery" unless the startup bridge or an
  equivalent injection path is used.

### 4.7 Governance And Trust

- `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md` exist.
- Release notes are maintained.
- Semantic versioning is used.
- Public roadmap is available.
- Privacy / data retention behavior is documented.
- The project clearly states it is not a general-purpose DLP or secret manager.
- SSOT-6/7 authority is preserved:
  - Wasurezu owns memory/recovery packs, confidence, missing context, provenance, and continuity signals.
  - Runtime adapters invoke hosts and return evidence; they do not own restart policy.
  - AUN/supervisors own runtime restart, requeue, finalization, close, and queue lifecycle in suite mode.
- Release docs do not treat fallback paths as primary startup automation.

---

## 5. Shortest MCP Public Alpha Roadmap

The shortest credible path is not to wait for every world-class gate. It is to
publish a measured public alpha once the recovery claim is true, safe, and
honestly documented.

### Phase A: Close Current Codex Adapter Hardening Gap

Owner issues: #92 / #99. Current PR: #135 or successor.

Gate:

- Codex host-adapter hardening PR gets required L1/L2 and L3/merge-authority review.
- `wasurezu-codex-start --doctor` records local Codex CLI compatibility without launching Codex.
- `wasurezu-codex-start --dry-run` and packaged operator scripts prove command construction without live host mutation.
- Docs disclose the remaining positional prompt argv limitation until a verified stdin or prompt-file surface exists.
- `wasurezu-codex-start --launch --cd <workspace>` remains the standard Codex launcher-controlled test path when a real run is authorized.

Evidence:

- CI green.
- L1/L2/L3 no blockers for the hardening PR.
- Shell syntax and dry-run checks for host adapter scripts.
- `npm pack --dry-run --json` includes packaged scripts and docs.
- Codex bridge output has secondary redaction and does not hide known delivery limitations.
- Bridge startup source is recorded or clearly evidenced when a live run is separately authorized.

### Phase B: Fresh Recovery Evidence

Gate:

- Run a Codex bridge fresh session.
- Score 27/30 or higher.
- Run a Claude Code SessionStart fresh session.
- Score 27/30 or higher.
- No safety failures.

Evidence:

- Recovery reports under `docs/operations/`.
- `recovery_quality_log` ids or timestamps.
- Probe answers R1-R6.
- Search queries used.
- GitHub SSOT checks for PR/status claims.

### Phase C: Public Alpha Documentation

Gate:

- README quick start is accurate for SQLite.
- Claude Code and Codex install/start docs are accurate.
- `HOST_ADAPTERS.md`, `CODEX_RECOVERY_CONTROL.md`, and SSOT-6/7 boundaries are cross-linked.
- `RECOVERY_EVALUATION.md` links to sample reports.
- Known limitations include:
  - Codex is bridge-based.
  - Codex positional prompt delivery may expose a bounded restart pack in process argv until a safer verified surface exists.
  - Plain MCP config is manual recovery.
  - AUN/supervisor mode owns runtime restart/requeue/queue lifecycle.
  - Redaction covers known patterns, not guaranteed DLP.
  - PR/status requires external SSOT.

Evidence:

- Clean install smoke on a fresh directory.
- Copy-paste commands in README verified.
- Troubleshooting covers the top failure modes.

### Phase D: Public Alpha Release

Gate:

- 3 consecutive recovery evaluations at 27/30 or higher.
- Includes at least one Claude Code SessionStart run.
- Includes at least one Codex bridge run.
- No automatic failures.
- L1/L2/L3 release audit pass.

Claim allowed:

> Kusabi / wasurezu is an early-stage MCP memory server for AI coding agents. It
> supports measured restart recovery through Claude Code runner/SessionStart
> load paths and a Codex startup bridge, with SQLite local storage and optional
> PostgreSQL.

Claims not allowed:

- "Codex automatically recovers from plain MCP config."
- "Guaranteed no secret leakage."
- "Production-grade DLP."
- "All MCP clients have startup recovery."

---

## 6. World-Class Roadmap After Public Alpha

### Phase E: Security Coverage Expansion

- Add the full secret fixture suite listed in section 4.2.
- Add output-surface parity tests for restart_pack, search, Claude boot, and
  Codex bridge.
- Add `SECURITY.md` and privacy/data-retention docs.

### Phase F: Cross-Backend And Clean Install Proof

- Clean install smoke test.
- SQLite default recovery evaluation.
- PostgreSQL recovery evaluation.
- Cross-backend ranking and redaction parity checks.

### Phase G: Observability And Release Trust

- Improve recovery log source attribution.
- Publish sample scorecards.
- Add release notes and upgrade path.
- Add failure-mode examples.

### Phase H: World-Class Release

Gate:

- 5 consecutive recovery evaluations at 28/30 or higher.
- Claude Code SessionStart x2.
- Codex bridge x2.
- Clean install / fresh DB x1.
- L1/L2/L3 no blockers.
- Security/privacy/docs/reliability gates complete.

Claim allowed:

> wasurezu is a production-evaluable MCP memory substrate for AI coding agents,
> with measured restart recovery, auditable memory boundaries, and documented
> safety limits.

---

## 7. Immediate Next Actions

As of 2026-06-12. Completed items are noted inline.

1. ~~Gate 0 CI expansion (no-secret recovery, migration idempotency, search regression, supervisor preflight)~~ — Done: PRs #157-#161.
2. Complete L1/L2/L3 review for #135 or its successor before using Codex hardening as release evidence.
3. Run a Codex bridge fresh recovery evaluation after the audited hardening PR is merged or explicitly adopted.
4. Run a Claude Code runner/SessionStart fresh recovery evaluation.
5. Update public-alpha evidence table with exact run ids, scores, and known gaps.
6. Complete README quick start and client-specific install docs.
7. Add or update `SECURITY.md`, privacy/retention notes, and troubleshooting docs before public-alpha claims.
8. Run L1/L2/L3 public-alpha release audit.
9. Issue #108 spec consolidation (SSOT-6/7 / control-plane runner boundary) — requires CTO/CEO gate; do not proceed without protected-category approval.
10. Keep package/repo/DB path/MCP namespace migration out of release claims unless a separate governed migration PR approves it.
