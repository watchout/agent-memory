#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${CODEX_WORKSPACE:-${PWD}}"
WASUREZU_ROOT="${WASUREZU_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CODEX_START_JS="${CODEX_START_JS:-${WASUREZU_ROOT}/dist/codex-start.js}"

cd "$WORKSPACE"

if [[ ! -f "$CODEX_START_JS" ]]; then
  echo "Missing built codex-start.js: $CODEX_START_JS" >&2
  echo "Run npm run build in $WASUREZU_ROOT first." >&2
  exit 1
fi

exec node "$CODEX_START_JS" \
  --launch \
  --cd "$WORKSPACE" \
  "$@"
