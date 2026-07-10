# OSS Publish Phase 0 Package Dry-Run Evidence

Status: evidence only.

This document records package dry-run evidence for issue
[#238](https://github.com/watchout/agent-memory/issues/238) and Cell
`KUSABI-OSS-PUBLISH-PHASE0-PACKAGE-DRY-RUN-001`.

It does not authorize npm publish, non-dry-run package artifact creation,
GitHub Release, git tag, MCP registry submission, package rename, package
files-list change, package metadata change, MCP namespace rename, legal
clearance, trademark clearance, license certification, compliance status, or
public release-readiness claims.

## Environment

- Source: clean temporary clone of `watchout/agent-memory`.
- Base: `origin/main` after PR #243 merge.
- Node.js: `v25.6.1`.
- npm: `11.9.0`.
- Package manager command: `npm ci`.
- Dry-run command: `npm pack --dry-run --json`.

## Current Package Identity

- Package name: `wasurezu`.
- Version: `0.3.0`.
- License field: `MIT`.
- Public product alias: `Kusabi`.
- Current package/MCP compatibility boundary remains unchanged.

Current `bin` entries:

- `kusabi` -> `dist/index.js`
- `wasurezu` -> `dist/index.js`
- `agent-memory` -> `dist/index.js`
- `wasurezu-codex-start` -> `dist/codex-start.js`
- `wasurezu-claude-start` -> `dist/claude-start.js`
- `wasurezu-restart` -> `dist/restart-cli.js`

## Dry-Run Result

`npm pack --dry-run --json` completed successfully.

- Package id: `wasurezu@0.3.0`.
- Output filename that would be produced by non-dry-run pack: `wasurezu-0.3.0.tgz`.
- Dry-run file count: 149.
- Dry-run unpacked size: 1,018,292 bytes.
- Non-dry-run tarball created: no.
- Tracked repository diff after dry-run: none before evidence files were added.
- Generated ignored build output: `dist/`.
- Ignored dependencies: `node_modules/`.

The dry-run ran the existing `prepack` script:

```text
npm run build
```

The build generated ignored `dist/` output for package calculation. This Cell
does not commit `dist/`, a package tarball, package metadata, or lockfile
changes.

## Included Public Baseline Files

The dry-run package contents include:

- `package.json`
- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `dist/**`
- `docs/brand/**`
- `docs/design/SOURCE_ALIGNMENT.md`
- `docs/design/schemas/**`
- `docs/design/governance/**`
- `docs/operations/HOST_ADAPTERS.md`
- `docs/operations/WORLD_CLASS_RELEASE_CRITERIA.md`
- `scripts/host-adapters/**`

## Missing Or Excluded Public-Readiness Files

The dry-run package contents do not include:

- `NOTICE`
- `docs/standards/THIRD_PARTY_ATTRIBUTION.md`
- `CHANGELOG.md`
- `CODE_OF_CONDUCT.md`
- `.github/ISSUE_TEMPLATE/**`
- `.github/pull_request_template.md`

The `.github/**` files are repository community files and do not normally need
to be packaged. The missing `NOTICE` and third-party attribution inventory are
public-readiness findings for package review. This Cell records the finding
only; it does not change `package.json` or the package `files` list.

## npm Audit Note

`npm ci` completed, but npm printed an audit summary:

```text
7 vulnerabilities (1 low, 5 moderate, 1 high)
```

This Cell does not run remediation and does not claim release readiness. Public
release readiness must not be claimed until dependency/security review is
handled under a separate owner-approved Cell or release gate.

## Boundary

This evidence does not prove that the package is ready to publish. It only
proves that the current package dry-run can calculate a package file list and
exposes current package inclusion gaps.

Not authorized by this Cell:

- npm publish.
- Non-dry-run `npm pack` artifact creation.
- GitHub Release or git tag.
- MCP registry submission.
- Package rename.
- Package metadata change.
- Package files-list change.
- Lockfile change.
- MCP namespace rename.
- Runtime behavior change.
- Workflow or deployment change.
- Legal, trademark, license, compliance, or public release-readiness claim.

## Next Safe Follow-Up

If owner/legal/operator wants the public package to include `NOTICE` and
third-party attribution, create a separate package metadata/files-list Cell.

If owner wants to resolve the npm audit summary before public release, create a
separate dependency/security review Cell.
