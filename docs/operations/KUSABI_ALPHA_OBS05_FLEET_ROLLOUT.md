# Kusabi Alpha OBS-05 — deterministic full-fleet distribution

Control source: [issue #280](https://github.com/watchout/agent-memory/issues/280)

## What OBS-05 adds

OBS-03 emits bounded runtime evidence and OBS-04 derives deterministic fleet
status. OBS-05 closes the missing deployment boundary: it freezes exactly who
is eligible, computes each desired native-host configuration without writing
it, binds protected mutation to immutable hashes, applies one isolated batch
at a time, and reads the resulting deployment back from the filesystem and
host evidence surfaces.

The normative rollout-plan schema is
`docs/design/schemas/kusabi-fleet-rollout-plan-v1.schema.json`. Semantic
validation additionally requires:

- every manifest target exactly once;
- unique batch IDs and target keys;
- canonical target-key ordering inside each batch;
- monotonic R1, R2, R3 order with every stage present;
- exact manifest ID, version, SHA-256, and target count;
- a self-consistent rollout-plan SHA-256.

## R0 evidence

R0 canonicalizes each workspace with `realpath`, rejects a symlinked workspace,
config directory, config file, or host artifact, and parses any existing JSON
before computing a postimage. It records only:

- target key, host, and batch ID;
- hashed config locator;
- absent/file preimage state, SHA-256, and mode;
- expected postimage and actual adapter artifact SHA-256;
- whether rollback material is required.

The desired postimage is produced by the existing Codex, Claude Code, or Gemini
CLI merge function. That preserves unrelated settings and hook handlers while
replacing only the managed Wasurezu SessionStart definition. R0 performs zero
production writes.

## Exact authorization

`kusabi-fleet-rollout-authorization/v1` is valid only when all fields and its
own canonical hash agree. Batch application additionally checks that the
authorization exactly matches:

- implementation head and tree;
- manifest SHA-256;
- rollout-plan SHA-256.

Changing any one of those values invalidates the authorization. A prior-stage
PASS must match the same manifest and plan; an ACK or a report for another
tuple cannot unlock a later batch.

## Independent observation

The deployment observer derives observed identity from the live target:

- workspace identity from the canonical workspace path hash;
- configuration identity from the actual configuration bytes;
- managed binding identity by parsing every actual managed command and
  requiring the exact runtime root and binding tuple;
- build artifact identity from actual runner bytes;
- Codex trust by reproducing the upstream normalized command-hook hash and
  matching the exact per-handler `trusted_hash` state key;
- Claude trust from the exact canonical workspace project entry and accepted
  trust dialog state;
- Gemini trust by matching both the trusted-folder decision and every actual
  managed command in the native trusted-hooks state;
- build commit/tree and storage binding from explicit evidence supplied by
  their authoritative read-only observers.

The Codex hash reproduction is pinned to the exact upstream
[`command_hook_hash`](https://github.com/openai/codex/blob/6751b54cae32b23786001e2414d749a9916201e1/codex-rs/hooks/src/engine/discovery.rs)
and
[`version_for_toml`](https://github.com/openai/codex/blob/6751b54cae32b23786001e2414d749a9916201e1/codex-rs/config/src/fingerprint.rs)
implementation. OBS-05 reads this private state but never writes it; a Codex
upgrade requires an exact regression against the pinned algorithm before
rollout.

The result is exact only when every class matches the manifest. Extra
whitespace therefore causes configuration drift even if the command still
parses, and a changed artifact causes build drift even if an expected hash was
provided elsewhere. This prevents expected-as-observed false acceptance.

## Batch gating and rollback

R1, R2, and R3 share the same gate. Every target in the current batch must be
independently exact and `healthy` with durable OBS-04 evidence. Any open P0/P1,
missing prior batch PASS, missing observed batch start, or incomplete soak
blocks progression.

Configuration placement uses the existing native atomic installers. Existing
files receive mode-0600 backups and installed files are mode 0600. If an apply
operation fails, OBS-05 restores every config touched in the affected batch in
reverse order from its in-memory preimage; absent preimages return to absent.
No prior batch or unrelated setting is rolled back.

## Verification oracle

`npm run test:kusabi-fleet-rollout` covers read-only R0, strict schema and
semantic rejection, exact authorization, the three-host R1 apply, unrelated
hook preservation, mode 0600, native trust refusal before approval, observed
identity, P1 blocking, prior-stage enforcement, the exact one-hour R2
threshold, byte-level drift detection, and symlink refusal. The suite uses
temporary workspaces only and cleans them up.

The full release gate also requires TypeScript, repository regression, all
three host hook suites, build, schema fixtures, changed-path equality, privacy
and network scans, SQLite/PostgreSQL parity, and `git diff --check`.
