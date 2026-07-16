#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="dry-run"
MANIFEST_SHA256=""
AGENT_ID=""
PROJECT=""
WORKSPACE_REF=""

while (($#)); do
  case "$1" in
    --mode|--manifest-sha256|--agent-id|--project|--workspace-ref)
      if (($# < 2)); then
        printf '{"schema_version":"kusabi-one-seat-canary-stop/v1","status":"stopped","stop_reason":"missing_argument_value","live_execution_performed":false,"protected_effect_boundary_reached":false}\n'
        exit 2
      fi
      case "$1" in
        --mode) MODE="$2" ;;
        --manifest-sha256) MANIFEST_SHA256="$2" ;;
        --agent-id) AGENT_ID="$2" ;;
        --project) PROJECT="$2" ;;
        --workspace-ref) WORKSPACE_REF="$2" ;;
      esac
      shift 2
      ;;
    *)
      printf '{"schema_version":"kusabi-one-seat-canary-stop/v1","status":"stopped","stop_reason":"unknown_argument","live_execution_performed":false,"protected_effect_boundary_reached":false}\n'
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry-run" ]]; then
  printf '{"schema_version":"kusabi-one-seat-canary-stop/v1","status":"stopped","stop_reason":"separate_exact_head_protected_owner_go_required","live_execution_performed":false,"protected_effect_boundary_reached":false,"counters":{"live_launch_count":0,"automatic_restart_count":0,"aun_mutation_count":0,"queue_mutation_count":0,"external_send_count":0,"provider_dispatch_count":0,"schema_mutation_count":0,"fleet_rollout_count":0,"other_agent_goal_api_mutation_count":0,"child_goal_overwrite_count":0,"sent_queued_pending_progress_increment":0}}\n'
  exit 3
fi

if [[ -z "$MANIFEST_SHA256" || -z "$AGENT_ID" || -z "$PROJECT" || -z "$WORKSPACE_REF" ]]; then
  printf '{"schema_version":"kusabi-one-seat-canary-stop/v1","status":"stopped","stop_reason":"required_binding_missing","live_execution_performed":false,"protected_effect_boundary_reached":false}\n'
  exit 2
fi

TSX_BIN="$ROOT_DIR/node_modules/.bin/tsx"
if [[ -x "$TSX_BIN" ]]; then
  TSX_COMMAND=("$TSX_BIN")
elif command -v npx >/dev/null 2>&1; then
  TSX_COMMAND=(npx --no-install tsx)
else
  printf '{"schema_version":"kusabi-one-seat-canary-stop/v1","status":"stopped","stop_reason":"local_tsx_runtime_missing","live_execution_performed":false,"protected_effect_boundary_reached":false}\n'
  exit 2
fi

exec "${TSX_COMMAND[@]}" "$ROOT_DIR/src/kusabi-one-seat-canary.ts" \
  --cli \
  --mode "$MODE" \
  --manifest-sha256 "$MANIFEST_SHA256" \
  --agent-id "$AGENT_ID" \
  --project "$PROJECT" \
  --workspace-ref "$WORKSPACE_REF"
