# Kusabi Ordinary Fresh-Session Fleet

This runbook proves the following bounded claim:

> After an agent session is intentionally ended, an ordinary new session for
> the same registered agent, project, workspace, and current runtime profile
> can recover the exact objective and next concrete action and begin
> continuation within 60 seconds, without a user restatement.

It does not detect a disconnection and does not automatically restart agents.
It never writes to an existing TUI. The old session is outside this runner's
lifecycle; the operator or host ends it normally before this path is invoked.

## Fixed target set

The runner accepts exactly these targets and runs them in this order:

| # | agent | memory project | workspace | runtime | profile revision |
|---:|---|---|---|---|---:|
| 1 | kusabi | agent-memory | `/Users/yuji/Developer/agent-memory` | codex | 9 |
| 2 | spec | spec | `/Users/yuji/Developer/spec` | claude-code | 6 |
| 3 | arc | iyasaka-arc | `/Users/yuji/Developer/iyasaka-arc` | codex | 7 |
| 4 | codex-audit | codex-audit | `/Users/yuji/Developer/codex-audit` | codex | 5 |
| 5 | devauditor | dev-auditor | `/Users/yuji/Developer/dev-auditor` | codex | 5 |
| 6 | qa | qa | `/Users/yuji/Developer/qa` | codex | 6 |
| 7 | check | check | `/Users/yuji/Developer/check` | claude-code | 6 |
| 8 | codex-cto | codex | `/Users/yuji/Developer/codex` | codex | 8 |
| 9 | dev-001 | dev-001 | `/Users/yuji/Developer/dev-001` | codex | 6 |
| 10 | org-build-dev | org-build | `/Users/yuji/Developer/org-build` | claude-code | 5 |
| 11 | hotel-lead | hotel-lead | `/Users/yuji/Developer/hotel-lead` | codex | 5 |
| 12 | secretary | secretary | `/Users/yuji/Developer/secretary` | codex | 6 |

`agents.runtime_engine_preference` is the runtime authority used by preflight.
A stale secondary declaration fails with `FAIL_STALE_RUNTIME_BINDING`; it does
not override the current profile. In particular, devauditor currently resolves
to `codex`.

## Preflight

Build and run the read-only profile and adapter boundary check:

```bash
npm run build
scripts/kusabi-fresh-session-fleet.sh --preflight-only
```

Preflight opens a read-only PostgreSQL transaction against the local
`agent_comms` database, reads only the 12 selected profiles, and rolls it back.
It also reads the local Codex and Claude help surfaces to confirm stdin JSON,
settings JSON, explicit session id, and structured output support without
launching a model.
It does not launch a model or mutate memory, AUN, queue, runtime, or schema
state.

## Live input and execution

Live mode requires an independently audited exact head and one already-created,
unconsumed selected restart-pack reference per target. ARC is not an auditor
for this gate; the accepted auditor ids are `devauditor` and `codex-audit`.
The audit JSON is:

```json
{
  "schema_version": "kusabi-fresh-session-independent-audit/v1",
  "verdict": "PASS",
  "exact_head_sha": "40-lowercase-hex-characters",
  "auditor": "devauditor",
  "independent": true,
  "durable_url": "https://github.com/watchout/agent-memory/pull/NNN#issuecomment-NNN"
}
```

The runner reads the current Git HEAD and stops before launch unless it exactly
matches the audited head. The live input JSON is an array of exactly 12 objects:

```json
[
  {
    "agent_id": "kusabi",
    "prior_session_id": "prior-session-id",
    "selected_pack_ref": "selected_restart_pack:example",
    "expected_objective": "the exact objective saved before the cut",
    "expected_next_action": "the exact next action saved before the cut"
  }
]
```

After completing all 12 entries and obtaining the required independent audit
PASS, run:

```bash
scripts/kusabi-fresh-session-fleet.sh --live \
  --input-json /absolute/path/to/live-input.json \
  --audit-json /absolute/path/to/exact-head-audit.json
```

Codex is launched as `codex exec --json -` in a read-only sandbox with approval
set to `never`; recovery is written to its stdin. Claude Code is launched in
print/plan mode with a new UUID and temporary native SessionStart settings that
run the central `dist/boot.js`. Neither path knows or addresses an existing
terminal session. The host-assigned Codex `thread_id` or Claude `session_id` is
the fresh-session evidence; a model-echoed id is not accepted as that proof.

## Fail-stop acceptance

Every target must satisfy all of the following:

- elapsed time is at most 60,000 ms;
- fresh session id differs from the prior session id;
- agent id, memory project, workspace, runtime, and profile revision match;
- recovered objective and next action exactly equal the saved expectation;
- continuation has started and user restatement count is zero; and
- automatic restart, disconnect detection, TUI write, tmux send-keys,
  clipboard write, existing-session injection, AUN queue mutation, external
  send, workspace write, schema mutation, deploy, merge, activation, and
  parallel-target counters are all zero.

The first failure aborts the current child process when applicable and prevents
all later targets from starting. A passing aggregate is exactly 12/12 with
`max_concurrency=1` and all four aggregate rates equal to `1.0`.

Evidence conforms to
`docs/design/schemas/kusabi-fresh-session-evidence-v1.schema.json`. A green
preflight or unit test is not live acceptance evidence; only a completed live
evidence object may support the 12-seat claim.
