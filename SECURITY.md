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

## Dependency Policy

Release candidates must pass:

```bash
npm audit --audit-level=high
```

Moderate findings must be reviewed before public release, with mitigations or
upgrade plans documented when the affected package is present only through a
non-public or non-default surface.
