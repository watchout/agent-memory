# Kusabi V2 Product Category and Positioning Draft

Status: draft
Scope: product category, positioning, market sequencing, and messaging
Runtime impact: none
Base: merged V2 docs stack through PR #192

## 1. Purpose

This document fixes the product category before detailed implementation specs
begin.

The key decision:

```text
Kusabi is not only for AI coding agents.
Kusabi is an agent continuity substrate.
AI coding agents are the first reference workload.
```

This lets Kusabi start with the most measurable and urgent agent-continuity use
case while preserving the larger category: memory, recovery, provenance, safety,
and evidence for long-running AI agents across domains.

## 2. Canonical category

Recommended category:

```text
Agent continuity substrate
```

Expanded definition:

```text
Kusabi is a local-first memory, recovery, and evidence substrate for long-running
AI agents.

It preserves task state, decisions, context, provenance, recovery packs, and
audit evidence across sessions, runtimes, tools, teams, and eventually domains.
```

Short Japanese definition:

```text
Kusabi は、AI エージェントが作業・文脈・判断・証跡を失わずに継続するための
memory / recovery / evidence substrate。
```

## 3. First reference workload

The first reference workload is:

```text
AI coding agent continuity
```

This is a reference workload, not the product boundary.

Coding agents are the best initial proof environment because they expose:

- issue / PR / branch / commit / file references;
- modified artifacts;
- test results;
- design decisions;
- task state;
- restart and compaction failures;
- measurable recovery outcomes;
- clear provenance and rollback context.

The first wedge should prove:

```text
An AI coding agent can restart without losing the current objective.
```

But the broader category is:

```text
Any long-running AI agent should preserve work, context, decisions, and evidence
across sessions, runtimes, tools, teams, and domains.
```

## 4. Product hierarchy

| Product layer | Category role | First proof | Future expansion |
| --- | --- | --- | --- |
| Kusabi Core | Local-first agent continuity substrate | Coding agents with MCP / Claude / Codex paths | Individual knowledge-work agents. |
| Kusabi Team | Shared, source-bearing recovery memory for agent teams | Engineering teams and multi-agent coding workflows | Sales, marketing, support, research, ops teams. |
| Kusabi Enterprise | Governed continuity, audit, retention, identity, and evidence | Controlled enterprise continuity pilot | Compliance-aware agent fleets. |
| UAMP | Open interop protocol for agent memory, recovery, provenance, and continuity | Mapping from current recovery artifacts | Cross-runtime, cross-vendor, and cross-domain interoperability. |

## 5. Stage-based positioning

Kusabi should change its external wording by maturity stage.

| Stage | Primary wording | What it means | What not to claim |
| --- | --- | --- | --- |
| Stage 0 — V2 planning | Agent continuity substrate, coding agents as first reference workload | Category and source reset. | Runtime/product readiness. |
| Stage 1 — local alpha | Local-first continuity memory for AI coding agents | OSS wedge; restart/recovery for coding workflows. | All-domain support. |
| Stage 2 — measured recovery | Measured restart recovery for AI agents, proven first on coding agents | Recovery scorecards and host adapter evidence. | Universal runtime support. |
| Stage 3 — team continuity | Shared, source-bearing continuity memory for agent teams | Multi-agent/team memory with explicit boundaries. | Cross-tenant or unrestricted federation. |
| Stage 4 — enterprise governance | Auditable continuity substrate for AI agent fleets | Evidence packets, retention, identity, attestation. | Legal certification or DLP guarantee. |
| Stage 5 — UAMP standardization | Open protocol for agent memory, recovery, provenance, and continuity | Conformance and second adapter proof. | Industry standard claim without adoption evidence. |

## 6. Domain expansion model

Kusabi should expand by preserving the same continuity primitives, not by
rewriting the product for each vertical.

| Domain | Continuity problem | Kusabi primitives needed | Claim status now |
| --- | --- | --- | --- |
| Coding | Current objective, files, decisions, tests, PR status, restart recovery | task state, decisions, knowledge, restart pack, source refs | First reference workload. |
| Sales | Account context, objections, promises, stakeholders, follow-up state | task state, decisions, source ledger, retention, CRM adapter later | Future domain; no current runtime claim. |
| Marketing | Campaign goals, brand constraints, approvals, experiments, segment context | knowledge, approvals, evidence, retention, adapter later | Future domain; no current runtime claim. |
| Support | Troubleshooting state, escalations, policy exceptions, customer history | source ledger, case state, retention, redaction, handoff | Future domain; no current runtime claim. |
| Research | Hypotheses, source trails, decisions, open questions, citations | raw/source ledger, knowledge, provenance, review packs | Future domain; no current runtime claim. |
| Ops | Runbooks, incidents, mitigations, postmortems, next actions | lifecycle events, task state, audit, retention | Future domain; no current runtime claim. |
| Legal / finance | Approvals, obligations, evidence, retention, redaction | strict provenance, retention, export/reveal controls | Future domain; high-risk; no current runtime claim. |

## 7. Messaging ladder

### Short positioning

```text
Kusabi is an agent continuity substrate.
```

### Developer wedge

```text
Restart your AI coding agent without losing the current objective.
```

### Team positioning

```text
Shared, source-bearing continuity memory for agent teams.
```

### Enterprise positioning

```text
Auditable continuity, recovery, and memory evidence for AI agent fleets.
```

### Protocol positioning

```text
UAMP is the open protocol for agent memory, recovery, provenance, and continuity.
Kusabi is designed to become the reference implementation candidate.
```

## 8. Terms to prefer

Use:

```text
agent continuity
continuity substrate
memory / recovery / evidence substrate
source-bearing recovery
recovery packs
provenance-bearing memory
data-only source text
trusted-instruction separation
measured recovery
```

Avoid as primary category:

```text
coding-agent memory only
vector memory
AI notes database
prompt memory helper
general DLP
compliance platform
agent orchestrator
```

Kusabi may serve coding agents first, but it should not be categorized as a
coding-only product.

## 9. Product boundaries

Kusabi is:

- a continuity substrate;
- a memory/recovery/evidence layer;
- local-first by default;
- compatibility-preserving for current Wasurezu surfaces;
- a future UAMP reference implementation candidate.

Kusabi is not:

- a general-purpose CRM;
- a marketing automation product;
- a customer support platform;
- a host/runtime orchestrator;
- a general-purpose DLP system;
- a legal compliance certification product;
- a replacement for AUN, Shirube, or Kodama.

Kusabi can integrate with those systems later through adapters, evidence refs,
and UAMP-compatible artifacts.

## 10. Why continuity, not memory

Many products can store memory. Fewer products can preserve work continuity.

The stronger category is continuity because it includes:

- memory;
- current task state;
- decisions and supersession;
- provenance;
- recovery confidence;
- missing context;
- redaction and retention state;
- handoff readiness;
- lifecycle owner;
- audit evidence.

This is why Kusabi should lead with continuity, not generic memory.

## 11. Claim boundaries

Allowed now:

```text
Kusabi V2 positions the product as an agent continuity substrate.
AI coding agents are the first reference workload.
Future domains are expansion targets, not current runtime support claims.
```

Not allowed now:

```text
Kusabi already supports sales, marketing, support, legal, or finance agents.
Kusabi already provides tenant/user/federated memory.
Kusabi already provides UAMP conformance.
Kusabi already provides enterprise compliance certification.
```

## 12. Product acceptance criteria before implementation

Before implementation work starts from this positioning, the V2 docs must make
clear:

- category: agent continuity substrate;
- first workload: coding agents;
- expansion model: domain adapters after core primitives are proven;
- no claim of current all-domain support;
- compatibility preservation for current Wasurezu surfaces;
- release ladder and evidence gates;
- suite interop boundaries for AUN, Shirube, Kodama, and UAMP.

## 13. Recommended canonical wording update

The canonical product definition should move from:

```text
Kusabi is a local-first memory, recovery, and continuity substrate for AI coding agents.
```

to:

```text
Kusabi is a local-first memory, recovery, and evidence substrate for long-running
AI agents.

Its first reference workload is AI coding agents, because coding workflows expose
clear task state, artifacts, decisions, tests, and recovery outcomes. The broader
category is agent continuity: preserving work, context, decisions, provenance,
and recovery evidence across sessions, runtimes, tools, teams, and eventually
domains.
```
