# Changelog

All notable changes to this project will be documented in this file.

This project is pre-public-alpha. The current package version is `0.3.0`, but
public OSS release preparation is still gated by
[issue #238](https://github.com/watchout/agent-memory/issues/238). This
changelog does not authorize npm publish, package rename, MCP namespace rename,
GitHub release, registry submission, or public release-readiness claims.

## Unreleased

### Added

- Core MVP Shirube/Rapid-Lite gate evidence and hard-gate flow.
- Core MCP regression coverage for current `wasurezu`-compatible tools.
- Restart/recovery smoke evidence for current manual MCP, Codex, and Claude
  compatibility paths.
- SQLite migration-idempotency Gate 0 coverage, including legacy
  `conversation_events` and `raw_events` compatibility.
- Current output redaction hardening for known sensitive output patterns.

### Changed

- README public-readiness wording now points to #238 instead of stale
  `AM-013` / `AM-014` publish references.
- Public capability language is constrained to the Core MVP / L1 local memory
  alpha boundary.

### Not Yet Authorized

- npm publish.
- Package rename from `wasurezu` to `kusabi`.
- MCP namespace rename.
- GitHub Release or git tag.
- MCP registry submission.
- UAMP conformance, backend parity, federation, compliance, DLP,
  zero-leakage, enterprise readiness, or public release-readiness claims.
