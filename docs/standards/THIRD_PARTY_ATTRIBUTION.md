# Third-Party Attribution Inventory

Status: Phase 0 public-readiness inventory
Scope: dependency attribution review support only
Runtime impact: none
Legal status: not legal certification
Source snapshot: `package-lock.json` at `wasurezu@0.3.0`

## Purpose

This document records a Phase 0 third-party attribution inventory for the
Kusabi / wasurezu public-readiness path tracked in
[issue #238](https://github.com/watchout/agent-memory/issues/238).

It supports review before public alpha. It does not authorize npm publish,
package rename, MCP namespace rename, GitHub release, MCP registry submission,
legal clearance, trademark clearance, compliance certification, or public
release-readiness claims.

## Current package boundary

- Current package name: `wasurezu`
- Current package version: `0.3.0`
- Current project license: MIT
- Current public alias: `Kusabi`
- Current compatibility boundary: `wasurezu` / `agent-memory`

This inventory does not change `package.json`, `package-lock.json`, package
metadata, package files, runtime behavior, MCP namespace, env vars, DB paths,
workflows, or deployment files.

Package inclusion of `NOTICE` and this inventory must be verified in the
separate package dry-run Cell before any registry release.

## Inventory method

The inventory was derived from the repository `package-lock.json` without
network access and without mutating package files.

Commands used for validation should include:

```bash
git diff --name-only origin/main...HEAD
git diff --check origin/main...HEAD
git diff --check
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); const direct=Object.keys({...p.dependencies,...p.devDependencies}).sort(); console.log(direct)"
```

The package manager lockfile is the source of truth for versions observed in
this Phase 0 inventory. Legal review may require additional license text,
notice text, or attribution formatting before public release.

## Direct dependency inventory

| Package | Version in lockfile | License in lockfile | Current role |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | `1.28.0` | MIT | MCP SDK dependency. |
| `ajv` | `8.20.0` | MIT | JSON/schema validation dependency. |
| `ajv-formats` | `3.0.1` | MIT | AJV format validation dependency. |
| `pg` | `8.20.0` | MIT | PostgreSQL client dependency. |
| `sql.js` | `1.14.1` | MIT | SQLite/WebAssembly-backed local storage dependency. |
| `uuid` | `11.1.0` | MIT | Identifier generation dependency. |
| `@types/node` | `22.19.15` | MIT | Development type dependency. |
| `@types/pg` | `8.20.0` | MIT | Development type dependency. |
| `@types/sql.js` | `1.4.11` | MIT | Development type dependency. |
| `@types/uuid` | `10.0.0` | MIT | Development type dependency. |
| `tsx` | `4.21.0` | MIT | Development runner dependency. |
| `typescript` | `5.9.3` | Apache-2.0 | Development compiler dependency. |

## Lockfile license family snapshot

Top-level `node_modules/*` entries in `package-lock.json` currently report
these license families:

| License family | Count |
| --- | ---: |
| MIT | 132 |
| ISC | 9 |
| BSD-3-Clause | 2 |
| BSD-2-Clause | 1 |
| Apache-2.0 | 1 |

This count is inventory evidence, not a legal conclusion.

## Non-MIT license families observed

The lockfile contains these non-MIT license families among top-level
`node_modules/*` entries:

| License | Packages observed |
| --- | --- |
| Apache-2.0 | `typescript` |
| BSD-2-Clause | `json-schema-typed` |
| BSD-3-Clause | `fast-uri`, `qs` |
| ISC | `inherits`, `isexe`, `once`, `pg-int8`, `setprototypeof`, `split2`, `which`, `wrappy`, `zod-to-json-schema` |

Before public release, legal or operator review should decide whether these
licenses require additional notice text beyond this inventory and the upstream
license files distributed with dependencies.

## Current attribution stance

- Project source is MIT under `LICENSE`.
- Third-party dependencies retain their own licenses.
- This repository does not currently vendor third-party source into `src/**`.
- This PR does not create generated schema files, fixture files, runner code, or
  bundled dependency artifacts.
- This PR does not run `npm pack`, `npm publish`, or registry submission.

## Known follow-ups

1. Verify package tarball contents in
   `KUSABI-OSS-PUBLISH-PHASE0-PACKAGE-DRY-RUN-001`.
2. Decide whether `NOTICE` and this inventory must be included in the published
   package file list before public alpha.
3. Confirm whether DCO is enough for Phase 1 or legal requires CLA.
4. Confirm whether additional attribution text is required for Apache-2.0,
   BSD, or ISC dependencies.
5. Keep this inventory updated if `package-lock.json` changes.

## Boundary

This document is review support only. It does not claim legal compliance,
license clearance, trademark clearance, public release readiness, UAMP
conformance, backend parity, federation readiness, enterprise readiness, DLP, or
zero secret leakage.
