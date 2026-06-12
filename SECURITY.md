# Security Policy

## Supported Versions

Wasurezu is pre-1.0 software. Security fixes are targeted at the latest release
candidate or the current `main` branch until a public release line is declared.

## Reporting a Vulnerability

Do not open a public issue with secrets, database URLs, transcript excerpts, or
private recovery-pack content.

For private reports, contact the maintainers through the repository owner and
include:

- affected version or commit SHA
- operating system and Node.js version
- a minimal reproduction without real secrets or private transcript content
- expected impact and whether local files, memory records, or host adapters are
  involved

Maintainers should acknowledge receipt within 5 business days and provide a
fix, mitigation, or status update as soon as the issue is triaged.

## Security Boundaries

Wasurezu stores and retrieves local agent memory. It does not grant permission
to execute host lifecycle actions unless a documented host adapter or operator
configuration has explicitly authorized that behavior.

Recovery packs, conversation events, raw events, and restart context are treated
as sensitive local data. They may contain redacted source references, local file
paths, task state, and operational metadata. Do not publish raw database dumps,
transcripts, or recovery artifacts without review.

## Redaction Scope and Limits

Wasurezu applies pattern-based redaction to recovery surfaces (restart packs,
search output, boot output) and records a `redaction_version` with raw-event
metadata so the active pattern set is auditable.

Covered pattern families include: OpenAI/Anthropic-style `sk-` keys, Stripe
`sk_live_`/`sk_test_`/restricted/webhook-signing keys, the GitHub token family
(`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`), Slack tokens, AWS access
keys, Google API keys, JWTs, Bearer tokens, PEM private key blocks,
credential-style `NAME=value` pairs, URL userinfo credentials, secret-bearing
URL query parameters, webhook URLs, email addresses, phone-number-shaped
strings, and home-path normalization.

**Wasurezu is not a general-purpose DLP or secret manager.** Redaction covers
known patterns only; novel or proprietary secret formats are not guaranteed to
be caught. Do not rely on redaction as the sole control: keep real secrets out
of agent conversations where possible, and treat the database itself as
sensitive (see Data Retention below).

## Data Retention and Privacy

All memory lives in a database the operator controls: a local SQLite file or a
self-hosted PostgreSQL instance. Nothing is transmitted to the Wasurezu project
or any third party by the memory server itself.

- Records (task states, decisions, knowledge, conversation/raw events) persist
  until the operator deletes them; there is no automatic content deletion.
- Stale `in_progress` task states transition to `expired` status after 7 days
  (a status change, not a deletion).
- Superseding a decision or knowledge item preserves the prior record with a
  `superseded` status for auditability rather than deleting it.
- Operators are responsible for backup, access control, and deletion policies
  on their own database, including compliance-driven erasure requests.

## Dependency Policy

Release candidates must pass:

```bash
npm audit --audit-level=high
```

Moderate findings must be reviewed before public release, with mitigations or
upgrade plans documented when the affected package is present only through a
non-public or non-default surface.
