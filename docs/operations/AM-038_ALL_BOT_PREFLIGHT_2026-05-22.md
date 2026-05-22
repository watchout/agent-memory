# AM-038 All-Bot Restart Prepare Preflight (2026-05-22)

## Purpose

Verify that AM-038 `restart_prepare` can produce deterministic pre-restart
artifacts for every currently memory-visible bot before broader host/AUN
integration.

This is a Wasurezu-side preflight only. It does not mutate AUN queue state,
claim/requeue lifecycle, delivery, finalization, reply, close, or host runtime
processes.

Related design premise:

- Issue #103: Raw Event Ledger and Pre-Generation Memory Controller
- Issue #101: Restart/session continuity design
- PR #102: AM-038 restart prepare API and CLI

## Boundary

Wasurezu owns:

- restart/recovery memory pack generation
- `restart_prepare` action/confidence/missing-context/provenance signals
- redacted full-text conversation memory and structured memory lookup
- source-bearing evidence for the host or AUN to consume

AUN/supervisor owns:

- queue finalization/requeue
- runtime restart execution
- suite-mode lifecycle
- delivery/reply/close
- bot/channel consumer placement

## Command

```bash
psql 'postgresql:///agent_comms?host=/tmp' -Atc \
  "select agent_id from task_states group by agent_id order by agent_id" |
  rg -v '^(run2-|smoke-test)' |
  while IFS= read -r agent; do
    AGENT_MEMORY_DATABASE_URL='postgresql:///agent_comms?host=/tmp' \
      node dist/restart-cli.js prepare \
        --agent-id "$agent" \
        --mode recommend \
        --pack-injection-mode on_demand \
        --no-pack
  done
```

## Result

| Agent | Action | Confidence | Missing context | Pack tokens | Active tasks | Decisions | Knowledge | Conversation events |
|---|---|---:|---|---:|---:|---:|---:|---:|
| adf-lead | pack_update_needed | high | none | 261 | 1 | 4 | 2 | 0 |
| agent-com-dev | pack_update_needed | high | none | 328 | 2 | 5 | 3 | 0 |
| agent-mem-dev | pack_update_needed | high | none | 630 | 2 | 5 | 5 | 8 |
| arc | pack_update_needed | high | none | 665 | 2 | 5 | 2 | 0 |
| auditor | pack_update_needed | high | none | 242 | 1 | 4 | 2 | 0 |
| codex-cto | pack_update_needed | high | none | 1494 | 2 | 3 | 2 | 8 |
| cto | pack_update_needed | medium | next_action | 501 | 2 | 5 | 5 | 0 |
| haishin-dev | pack_update_needed | high | none | 247 | 1 | 4 | 2 | 0 |
| nyusatsu-dev | pack_update_needed | high | none | 246 | 1 | 4 | 2 | 0 |
| org-build-dev | pack_update_needed | high | none | 244 | 1 | 4 | 2 | 0 |
| vice | pack_update_needed | high | none | 246 | 1 | 4 | 2 | 0 |
| wbs-dev | pack_update_needed | medium | next_action | 363 | 2 | 5 | 5 | 0 |
| webb-dev | pack_update_needed | high | none | 243 | 1 | 4 | 2 | 0 |

## Interpretation

- `restart_prepare` is callable for every currently memory-visible bot.
- All runs are `pack_update_needed`, not `restart_recommended`, because this
  preflight supplied no host context-usage metric or runtime context error.
- `agent-mem-dev` and `codex-cto` already have searchable conversation-event
  provenance in the generated pack metadata.
- `cto` and `wbs-dev` need better saved `next_steps` before they should be used
  as high-quality restart evidence.

## Next Verification Step

After PR #102 is merged and deployed into the live MCP/runtime checkout:

1. Run the same `restart_prepare --no-pack` preflight against all active bot
   identities.
2. For `cto` and `wbs-dev`, save a fresh task state with explicit `next_steps`
   and rerun the prepare check.
3. Select one AUN-managed bot and one non-AUN/manual host path for fresh
   restart evidence.
4. Record host adapter, host adapter level, `restart_prepare.action`,
   confidence, missing context, pack ref, and whether the first model context
   received the pack.
