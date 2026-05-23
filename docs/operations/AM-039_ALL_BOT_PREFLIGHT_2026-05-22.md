# AM-039 All-Bot Selected Pack Preflight (2026-05-22)

## Purpose

Verify that the AM-039 selected restart pack handoff works on the live
PostgreSQL-backed memory DB before broader bot rollout.

This is a Wasurezu-side preflight only. It does not mutate AUN queue state,
claim/requeue lifecycle, delivery, finalization, reply, close, or host runtime
processes.

Related work:

- Issue #104: AM-039 selected restart pack fetch and boot consume
- PR #105: selected restart pack handoff
- PR #102: AM-038 restart prepare API and CLI

## Live DB Migration / Canary

The live DB did not have `selected_restart_packs` before the first AM-039 CLI
run. Running the built `wasurezu-restart prepare` through the PostgreSQL store
initialized the new table through normal store migration.

Canary command shape:

```bash
AGENT_MEMORY_DATABASE_URL='postgresql:///agent_comms?host=/tmp' \
  node dist/restart-cli.js prepare \
    --agent-id agent-mem-dev \
    --project agent-memory \
    --mode recommend \
    --pack-injection-mode on_demand \
    --no-pack \
    --max-tokens 700

AGENT_MEMORY_DATABASE_URL='postgresql:///agent_comms?host=/tmp' \
  node dist/restart-cli.js fetch \
    --agent-id agent-mem-dev \
    --project agent-memory \
    --pack-ref selected_restart_pack:ad288a67-d7d0-4373-a05c-45b41db66006 \
    --consume
```

Canary result:

- `pack_ref`: `selected_restart_pack:ad288a67-d7d0-4373-a05c-45b41db66006`
- DB row: `agent-mem-dev / agent-memory / restart_prepare / consumed`
- First fetch with `--consume`: pass
- Second fetch with `--consume`: expected failure because the selected pack was
  already consumed
- AUN queue / host process lifecycle: not touched

## All-Bot Prepare Preflight

Command shape:

```bash
psql 'postgresql:///agent_comms?host=/tmp' -Atc \
  "select agent_id from task_states group by agent_id order by agent_id" |
  rg -v '^(run2-|smoke-test)' |
  while IFS= read -r agent; do
    AGENT_MEMORY_DATABASE_URL='postgresql:///agent_comms?host=/tmp' \
      node dist/restart-cli.js prepare \
        --agent-id "$agent" \
        --mode recommend \
        --pack-injection-mode off \
        --no-pack \
        --max-tokens 1000
  done
```

`pack_injection_mode=off` was used for all-bot preflight so the sweep verifies
readiness without creating selected packs for every bot. The selected-pack
fetch/consume path was verified separately with the `agent-mem-dev` canary
above.

| Agent | Action | Confidence | Missing context | Context source | Pack ref | Pack tokens | Active tasks | Decisions | Knowledge | Conversation events |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| adf-lead | pack_update_needed | high | none | estimated | null | 261 | 1 | 4 | 2 | 0 |
| agent-com-dev | pack_update_needed | high | none | estimated | null | 328 | 2 | 5 | 3 | 0 |
| agent-mem-dev | pack_update_needed | high | none | estimated | null | 630 | 2 | 5 | 5 | 8 |
| arc | pack_update_needed | high | none | estimated | null | 665 | 2 | 5 | 2 | 0 |
| auditor | pack_update_needed | high | none | estimated | null | 242 | 1 | 4 | 2 | 0 |
| codex-cto | pack_update_needed | high | none | estimated | null | 1004 | 2 | 3 | 2 | 8 |
| cto | pack_update_needed | medium | next_action | estimated | null | 501 | 2 | 5 | 5 | 0 |
| haishin-dev | pack_update_needed | high | none | estimated | null | 247 | 1 | 4 | 2 | 0 |
| nyusatsu-dev | pack_update_needed | high | none | estimated | null | 246 | 1 | 4 | 2 | 0 |
| org-build-dev | pack_update_needed | high | none | estimated | null | 244 | 1 | 4 | 2 | 0 |
| vice | pack_update_needed | high | none | estimated | null | 246 | 1 | 4 | 2 | 0 |
| wbs-dev | pack_update_needed | medium | next_action | estimated | null | 363 | 2 | 5 | 5 | 0 |
| webb-dev | pack_update_needed | high | none | estimated | null | 243 | 1 | 4 | 2 | 0 |

## Interpretation

- AM-039 selected-pack persistence/fetch/consume works on the live PostgreSQL
  DB.
- `restart_prepare` is callable for every currently memory-visible bot after
  the AM-039 merge.
- All all-bot runs are `pack_update_needed`, not `restart_recommended`, because
  this preflight supplied no host context-usage metric or runtime context
  error.
- `agent-mem-dev` and `codex-cto` have searchable conversation-event
  provenance.
- `cto` and `wbs-dev` still need fresher task states with explicit
  `next_steps` before they should be used as high-quality restart evidence.

## Next Verification Step

1. Save fresh task states for `cto` and `wbs-dev` with explicit `next_steps`.
2. Pick one AUN-managed bot and one host/manual path for fresh restart evidence.
3. For AUN paths, let AUN own restart/requeue lifecycle and consume Wasurezu
   prepared pack references only as handoff artifacts.
4. For standalone paths, require explicit AUN absence, supported hook, and
   preauthorization before any `auto_restart` evidence is counted.
