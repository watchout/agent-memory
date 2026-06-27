# Kusabi Grand Slam Offer — Spec Origin Document

> Status: CEO-frozen direction (2026-06-12). Input material for ARC spec drafting.
> Authority: wasurezu decisions `25e7769f` (AM-034 acceleration scope) and `61f14a84` (this offer freeze).
> This document defines WHAT the offer promises. HOW it is delivered technically
> is ARC spec territory and follows the normal governance chain.

---

## 1. Premise: spec is derived from wants and needs

- **Want (why the buyer buys)**: an AI agent fleet that runs 24/7 without a human
  re-priming it after every crash, restart, or context reset. The buyer is buying
  fleet operability, not a memory database.
- **Need (what makes the promise contractible)**: measured recovery quality,
  evidence that secrets never resurface in recovery output, an audit trail of
  what each agent remembered and why, and an install path measured in minutes.

These map almost 1:1 onto the existing AM-034 world-class gates. The offer does
not replace AM-034; it reorders its priorities and adds one product surface.

## 2. Distribution: open-core (final)

| Layer | Distribution | Contents |
|---|---|---|
| Open (trust + lead magnet) | OSS, MIT preserved, AM-014 npm publish unchanged | Core engine (stores, restart_pack, redaction), UAMP protocol direction (#154), runtime adapters (Claude Code, Codex; #146 hosts later) |
| Closed (monetization) | Enterprise license, design partners first | Phase 4 enterprise identity (SSO/RBAC/tenant), fleet governance dashboard, Continuity Audit Report, support/SLA |

Full-closed distribution was considered and rejected: a memory layer is
trust-critical infrastructure (auditable source is near-precondition for
enterprise security review), and a zero-free-value funnel is the weakest
acquisition structure for high-ticket B2B.

## 3. The offer: Agent Continuity Pilot (90 days)

- **Dream outcome**: "Your agent fleet resumes work after any restart with no
  human restatement of context."
- **Performance guarantee (conditional)**: measured recovery score at or above
  the contracted bar across the pilot fleet, and zero incidents where a human
  must re-explain the project from scratch — or the pilot fee is refunded.
  Guarantee adjudication uses the Continuity Audit Report (section 4).
- **Scarcity**: design-partner cohort capped at 3 companies.
- **Pricing posture**: premium; never discounted. Value is added through bonus
  stacking (fleet continuity diagnostic, dashboard early access, audit reports)
  instead of price reduction.
- **Money model sequence**:
  - Stage I (attraction): OSS core + free Agent Continuity Diagnostic of the
    prospect's existing fleet.
  - Stage II (pilot): the 90-day guaranteed pilot, implementation included.
  - Stage III (continuity): per-agent continuity license + SLA + recurring
    audit reporting.

## 4. Spec requirements derived from the offer

1. **Continuity Audit Report (new product surface)** — a customer-facing,
   exportable scorecard: recovery scores per run, restatement-incident count,
   redaction probe results, provenance summary. This is the artifact the
   guarantee is judged against. Today AM-034 evidence is internal-only; this
   productizes it. Primary new ARC spec item.
2. **Recovery score contract** — the scoring rubric (currently the 30-point
   internal evaluation) must be frozen as an external, versioned contract so a
   guarantee can reference it. Includes "restatement incident" as a defined,
   countable event.
3. **Phase 4 identity partial pull-forward** — only what a 3-company pilot
   needs (tenant separation, service-account binding on top of SSOT-7 runtime
   binding). Full SSO/RBAC remains Phase 4.
4. **AM-034 gate reordering** — measurement/evidence (4.1/4.5) first, 5-minute
   quickstart (4.6/4.4) second, redaction evidence suite (4.2) third, then
   audit-report surface, then identity. No gate is removed.

## 5. Open decisions for ARC

- Report format and delivery (static artifact vs dashboard view), and where it
  lives relative to `recovery_quality_log`.
- Exact guarantee metric bar and measurement window (engineering proposes,
  CEO approves the contractible number).
- Diagnostic (Stage I) scope: read-only instrumentation boundary on a
  prospect's fleet.
- Whether the score contract is published as part of UAMP (#154) or kept as a
  bilateral pilot annex until public alpha.

## 6. Method note

Offer structure follows Alex Hormozi's frameworks: value equation and Grand
Slam Offer construction ($100M Offers), lead-magnet doctrine — give away the
secrets, sell the implementation ($100M Leads), offer sequencing ($100M Money
Models), and the Gym Launch licensing precedent for productized one-to-many
delivery. The category-of-one source is that Kusabi's measured recovery regime
makes a performance guarantee contractible — competitors without a measurement
regime cannot copy the guarantee.
