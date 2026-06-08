# Codex Startup Recovery Target Sync L2 Rework

Date: 2026-06-08

## Scope

This is the review/rollback manifest for the L2 BLOCK remediation on
Company Dev OS Codex startup recovery target sync.

The change set is intentionally limited to verifier fail-closed behavior,
explicit alias approvals, and `--boot-only` no-live-mutation behavior. It does
not rewrite the live target registry or regenerate project launchers.

## Files

Code:

- `package.json`
- `src/company-dev-os-recovery-target-audit.ts`
- `src/test-company-dev-os-recovery-target-audit.ts`
- `scripts/codex-memory-start.sh`
- `scripts/test-context-health-wrappers.sh`

Audit manifest:

- `docs/operations/company-dev-os-recovery-target-aliases.json`
- `docs/operations/CODEX_STARTUP_RECOVERY_TARGET_SYNC_L2_REWORK.md`

## Behavior Changes

Verifier:

- `registry_identity_differs` is `BLOCK` unless an exact alias approval matches
  `cwd`, source `agent_id/project`, and registry `agent_id/project`.
- `company_target_conflict` is `BLOCK` unless every non-registry identity for
  that cwd is either the registry identity or has an exact alias approval.
- Empty or zero-source audits fail closed through minimum Company Dev OS source
  and registry target counts.
- The registry source defaults to `~/.agent-memory/raw-capture-targets.json`.
  If no explicit or default registry file exists, the audit sees zero registry
  targets and fails closed through the minimum target guard.
- Alias approvals are explicit JSON records with `approved_by`, `reason`, and
  optional expiry.

Boot-only:

- `scripts/codex-memory-start.sh --boot-only` forces recovery review DB writes
  off and AUN notify dry-run unless `AGENT_MEMORY_BOOT_ONLY_LIVE_REVIEW=1` is
  set explicitly.
- The wrapper may still create local run-dir artifacts for the boot prompt and
  review request, but it does not perform DB review persistence or live notify
  by default in boot-only mode.

## Current Alias Approvals

`company-dev-os-recovery-target-aliases.json` records temporary compatibility
approvals for the current Wasurezu target registry differences. These approvals
are not silent: verifier output includes `approval_id` on each warning.

The approvals expire on 2026-07-08 and should be replaced by either:

- a live registry/launcher sync to the canonical runtime owner, or
- a renewed approval with updated source evidence.

## Verification

Commands run:

```bash
npm run build
npm test
npm run test:company-dev-os-recovery-target-audit
bash scripts/test-context-health-wrappers.sh
npm run --silent company-dev-os:recovery-target-audit -- --json
node dist/company-dev-os-recovery-target-audit.js --json
```

Observed live audit after remediation:

```text
status: pass
company_targets: 48
existing_company_targets: 47
registry_targets: 47
block_findings: 0
warn_findings: 12
```

All 12 warnings are either approved identity mappings or the approved
`tech-lead` source conflict.

Observed empty-alias negative audit:

```text
status: fail
block_findings: 12
warn_findings: 0
```

## Rollback

To roll back this change set after commit:

```bash
git revert <commit>
```

To drop the uncommitted change set locally:

```bash
git restore \
  package.json

rm -f \
  src/company-dev-os-recovery-target-audit.ts \
  src/test-company-dev-os-recovery-target-audit.ts \
  scripts/codex-memory-start.sh \
  scripts/test-context-health-wrappers.sh \
  docs/operations/company-dev-os-recovery-target-aliases.json \
  docs/operations/CODEX_STARTUP_RECOVERY_TARGET_SYNC_L2_REWORK.md
```

To temporarily restore pre-change boot-only live review behavior without
reverting code:

```bash
AGENT_MEMORY_BOOT_ONLY_LIVE_REVIEW=1 \
AGENT_MEMORY_RECOVERY_REVIEW_DB=1 \
scripts/codex-memory-start.sh --boot-only
```

Use that override only for intentional internal recovery-evaluation runs.
