# Kusabi V2 Release Claim Ladder Draft

Status: draft
Scope: release, quality, evidence, and adoption-claim gates
Base dependency: PR #182, PR #183, and PR #187
Runtime impact: none

## 1. Purpose

This document converts the Kusabi V2 ambition into measurable claim levels.

The target is not merely to rename Wasurezu. The target is to preserve existing
capabilities and raise the product to a quality bar where a serious engineering
organization, including a major technology company, would want to evaluate it for
real AI coding-agent workflows.

## 2. Claim discipline

A claim is allowed only when the matching evidence exists. Implementation
presence alone is not enough.

```text
Implemented surface != release-ready claim
Policy contract != live enforcement
Recovery pack generated != successful startup recovery
Redaction patterns != guaranteed DLP
MCP tool availability != host lifecycle automation
```

## 3. V2 claim levels

| Level | Audience | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- | --- |
| L0 — V2 design reset | maintainers / reviewers | Kusabi V2 has draft design direction and compatibility boundaries. | `docs/v2/**` source set, feature preservation matrix, naming inventory. | Runtime, package, MCP, DB, or enforcement migration claims. |
| L1 — Local memory alpha | individual technical users | Local-first MCP memory with SQLite default and preserved Wasurezu compatibility. | Clean install, core tools, SQLite store, no destructive migration, basic docs. | Automatic recovery for all hosts; enterprise readiness. |
| L2 — Measured restart recovery | advanced users / internal teams | Measured restart recovery through verified host adapter paths. | Claude and Codex startup recovery evaluations, scorecards, missing-context reports. | Plain MCP automatic startup recovery. |
| L3 — Enterprise pilot candidate | selected pilot organizations | Auditable memory/recovery substrate with explicit safety, retention, and evidence limits. | Security/retention docs, output redaction probes, observability examples, admin-surface boundaries. | Production-grade DLP, unrestricted transcript ingest, full governance enforcement. |
| L4 — World-class public release | serious teams / major technology companies | Production-evaluable memory and recovery substrate for AI coding agents. | Consecutive high-score recovery runs, clean install, security, docs, reliability, observability, migration, and governance evidence. | Guaranteed perfect recovery, guaranteed no secret leakage, ownership of external lifecycle. |

## 4. Level 0: V2 design reset gate

Required:

- V2 canonical product name is `kusabi` in `docs/v2/**`.
- Existing `wasurezu` and `agent-memory` operational surfaces are preserved as
  compatibility surfaces.
- Source classification exists for reviewed V1/transitional docs.
- Naming surface inventory exists.
- Feature preservation matrix exists.
- Fast-lane policy separates Lane A docs reset, Lane B governance scaffold, and
  Lane C runtime/package migration.
- No runtime, package, MCP, env, DB, workflow, deployment, publish, or repo
  rename behavior changed.

Allowed claim:

```text
Kusabi V2 planning has started as a docs-only, compatibility-preserving reset.
```

## 5. Level 1: Local memory alpha gate

Required:

- Clean install smoke on a fresh home/workspace.
- SQLite default works without PostgreSQL or Docker.
- Core MCP tools work: decisions, task state, knowledge, search, recovery.
- Existing `wasurezu` package/CLI/MCP configuration remains documented.
- No data-destructive migration is required.
- `README` quick start is accurate for the shipped package state.
- SECURITY / privacy notes tell users not to publish secrets, DB dumps, or
  transcript excerpts.
- Known limitations are visible before install.

Allowed claim:

```text
Kusabi / wasurezu is an early local-first MCP memory server for AI coding agents.
```

Not allowed:

- fully automatic startup recovery for all MCP clients;
- enterprise governance enforcement;
- guaranteed DLP;
- PostgreSQL parity where not tested.

## 6. Level 2: Measured restart recovery gate

Required:

- At least three fresh recovery evaluations at or above the accepted public-alpha
  score threshold.
- At least one Claude Code SessionStart / runner path evaluation.
- At least one Codex bridge startup evaluation.
- No automatic failure.
- No case where the user must restate the project from scratch.
- `restart_pack` or structured pack is present in the first model context for
  counted startup-recovery runs.
- Probe answers and missing context are recorded.
- PR/status claims are verified against GitHub or the relevant external source of
  truth before acting.

Allowed claim:

```text
Kusabi supports measured restart recovery through verified Claude and Codex
adapter paths.
```

Not allowed:

- Codex automatically recovers from plain MCP config;
- SessionStart/TUI self-kick is the universal architecture;
- restart recommendation mutates AUN or host lifecycle.

## 7. Level 3: Enterprise pilot candidate gate

Required:

- Memory safety taxonomy is canonical in V2 docs.
- Raw transcript/source text remains data-only.
- Candidate memory and approved memory are separated.
- Promotion evidence is required before `approved_memory` claims.
- Retention, deletion, archive, export, and supersession expectations are
  documented.
- Output redaction probes cover all release surfaces:
  - `restart_pack` text;
  - `recovery-pack/v1` JSON;
  - `host-invocation-context/v1` JSON;
  - `search_memory`;
  - `recover_context`;
  - boot fallback output;
  - Codex bridge prompt/output;
  - Claude hook/runner output where applicable.
- Admin/high-risk surfaces have approval boundaries, especially
  `set_recovery_config` and broad transcript ingest.
- Observability examples show how to inspect recovery quality, missing evidence,
  and failed/degraded recovery.
- Backend support matrix is honest about SQLite, PostgreSQL, JSON, and optional
  vector search.

Allowed claim:

```text
Kusabi is suitable for controlled enterprise pilots that need auditable local
agent memory and measured recovery, with documented safety limits.
```

Not allowed:

- production-grade DLP;
- legal/compliance guarantee;
- cross-tenant support unless implemented;
- live Shirube/AUN/Kodama enforcement unless integration tests prove it.

## 8. Level 4: World-class public release gate

Required:

- Five consecutive recovery evaluations at the world-class threshold.
- Includes at least two Claude startup/hook runs.
- Includes at least two Codex bridge runs.
- Includes at least one clean install / fresh DB run.
- No automatic failure.
- No destructive stale-context action.
- No user restatement from scratch.
- CI passes on Node 18 / 20 / 22.
- Unit, integration, boot, SQLite, and supported PostgreSQL tests pass or gaps are
  explicitly excluded from the claim.
- Clean install, upgrade, rollback, and uninstall docs exist.
- Redaction and output-surface parity gates are in CI or release-blocking checks.
- Recovery evidence includes:
  - recovered token count or pack budget;
  - confidence and missing context;
  - source refs;
  - redaction summary;
  - omitted or missing evidence;
  - client/runtime source;
  - lifecycle owner;
  - task continuation outcome.
- Public docs include:
  - quick start;
  - Claude guide;
  - Codex guide;
  - MCP-only manual recovery guide;
  - PostgreSQL guide;
  - transcript ingest guide;
  - recovery evaluation guide;
  - troubleshooting;
  - security/privacy/retention;
  - upgrade/rollback/uninstall.

Allowed claim:

```text
Kusabi is a production-evaluable memory and recovery substrate for AI coding
agents, with measured restart recovery, auditable memory boundaries, and explicit
safety limits.
```

Not allowed:

- guaranteed no secret leakage;
- guaranteed perfect recovery;
- general-purpose secret management;
- ownership of external orchestrator lifecycle;
- enterprise-wide governance enforcement without verified integrations.

## 9. Evidence packet requirements

Every Level 2+ release or pilot claim should have an evidence packet containing:

| Evidence | Required from Level | Notes |
| --- | --- | --- |
| commit SHA / branch / package version | L1 | Exact tested artifact. |
| install path and OS / Node version | L1 | Reproducibility. |
| DB backend and migration state | L1 | SQLite/PG/JSON distinction. |
| recovery run report | L2 | Probe answers, scores, gaps. |
| host adapter evidence | L2 | Claude/Codex path and delivery mode. |
| redaction probe results | L3 | Fixture families and output surfaces. |
| retention/deletion boundary review | L3 | Operator responsibilities and no-delete defaults. |
| observability sample | L3 | How to inspect recovery quality. |
| compatibility matrix | L3 | MCP-only, Claude, Codex, other clients. |
| rollback plan | L4 | Required for package/env/storage/schema changes. |
| public claim review | L4 | Verify docs do not overstate. |

## 10. Major-tech adoption bar

A major technology company will evaluate only if Kusabi can answer these
questions with evidence:

1. What exact data is stored locally?
2. Which stored data can become agent-readable memory?
3. Can transcript or tool text become instruction? The answer must be no unless
   a trusted control-plane path explicitly authors it.
4. What is redacted before persistence and before output?
5. What is not guaranteed by redaction?
6. How is tenant/user/agent/project/session identity separated?
7. What happens when context is missing or contradictory?
8. How does the system avoid owning a host/orchestrator lifecycle it should not
   own?
9. How are recovery quality and failures measured?
10. How are old decisions, knowledge, and task states superseded without deleting
    audit history?
11. What is the clean install and rollback path?
12. Which claims are measured, and where are the scorecards?

## 11. Immediate V2 uplift backlog

To reach the user's stated target, prioritize:

1. Feature preservation matrix — prevent silent functionality loss.
2. API/data boundary — clarify current compatibility vs V2 concepts.
3. Security/retention boundary — make privacy limits honest and reviewable.
4. Release claim ladder — prevent overclaiming and define the major-tech bar.
5. Recovery evaluation reports — convert claims into evidence.
6. Redaction parity gates — make leaks release-blocking.
7. Backend parity matrix — avoid unsupported PG/JSON claims.
8. Compatibility alias migration plan — rename only after inventory and tests.

## 12. Stop condition

If a PR claims Level 2 or higher without matching evidence, stop and downgrade
the claim. If a PR changes runtime/package/MCP/env/DB behavior while still
claiming to be Lane A docs-only work, stop and split it into a separate
owner-approved migration PR.
