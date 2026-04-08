#!/bin/bash
# gate-quality: 品質ゲート（汎用テンプレート）
# プロジェクト固有のチェックは PROJECT_CHECKS セクションに追加する
#
# Usage: scripts/gates/gate-quality.sh
# Exit 0 = PASSED, Exit 1 = FAILED
set -uo pipefail

PASS=0
FAIL=0
WARN=0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

echo "============================================"
echo " Gate: Quality Check"
echo "============================================"

# --- 1. TypeScript 型チェック ---
echo ""
echo "=== 1. Type Check ==="
if [ -f "$PROJECT_DIR/tsconfig.json" ]; then
  if npx --yes tsc --noEmit --project "$PROJECT_DIR" 2>/dev/null; then
    echo "  PASS: TypeScript type check passed"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: TypeScript type check failed"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  WARN: tsconfig.json not found, skipping type check"
  WARN=$((WARN + 1))
fi

# --- 2. Lint ---
echo ""
echo "=== 2. Lint ==="
if [ -f "$PROJECT_DIR/eslint.config.mjs" ] || [ -f "$PROJECT_DIR/.eslintrc.js" ] || [ -f "$PROJECT_DIR/.eslintrc.json" ]; then
  if npx eslint "$PROJECT_DIR/src" "$PROJECT_DIR/app" "$PROJECT_DIR/server" "$PROJECT_DIR/pages" "$PROJECT_DIR/components" "$PROJECT_DIR/composables" 2>/dev/null; then
    echo "  PASS: Lint passed"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: Lint errors found"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  WARN: No ESLint config found, skipping"
  WARN=$((WARN + 1))
fi

# --- 3. テスト実行 ---
echo ""
echo "=== 3. Tests ==="
if [ -f "$PROJECT_DIR/package.json" ]; then
  TEST_SCRIPT=$(node -e "try{const p=require('$PROJECT_DIR/package.json');console.log(p.scripts&&p.scripts.test?'yes':'no')}catch{console.log('no')}")
  if [ "$TEST_SCRIPT" = "yes" ]; then
    if (cd "$PROJECT_DIR" && npm test -- --run 2>/dev/null); then
      echo "  PASS: Tests passed"
      PASS=$((PASS + 1))
    else
      echo "  FAIL: Tests failed"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "  WARN: No test script in package.json"
    WARN=$((WARN + 1))
  fi
fi

# --- 4. 禁止パターン検出 ---
echo ""
echo "=== 4. Forbidden Patterns ==="

# console.log in production code
SRC_DIRS=""
for DIR in src app server pages components composables lib utils stores plugins; do
  [ -d "$PROJECT_DIR/$DIR" ] && SRC_DIRS="$SRC_DIRS $PROJECT_DIR/$DIR"
done

if [ -n "$SRC_DIRS" ]; then
  # shellcheck disable=SC2086
  CONSOLE_COUNT=$(grep -rc "console\.log" $SRC_DIRS 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
  if [ "$CONSOLE_COUNT" -le 5 ]; then
    echo "  PASS: Minimal console.log usage ($CONSOLE_COUNT)"
    PASS=$((PASS + 1))
  else
    echo "  WARN: Excessive console.log ($CONSOLE_COUNT occurrences)"
    WARN=$((WARN + 1))
  fi

  # any type usage
  # shellcheck disable=SC2086
  ANY_COUNT=$(grep -rc ": any" $SRC_DIRS 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
  if [ "$ANY_COUNT" -le 5 ]; then
    echo "  PASS: Minimal 'any' type usage ($ANY_COUNT)"
    PASS=$((PASS + 1))
  else
    echo "  WARN: Excessive 'any' type usage ($ANY_COUNT)"
    WARN=$((WARN + 1))
  fi
fi

# --- 5. DB マイグレーション整合性（Prisma / Drizzle） ---
echo ""
echo "=== 5. DB Migration Integrity ==="

if [ -f "$PROJECT_DIR/prisma/schema.prisma" ]; then
  if [ -d "$PROJECT_DIR/prisma/migrations" ]; then
    MIGRATION_COUNT=$(find "$PROJECT_DIR/prisma/migrations" -name "migration.sql" 2>/dev/null | wc -l | tr -d ' ')
    echo "  Prisma migrations: $MIGRATION_COUNT"
    if [ -f "$PROJECT_DIR/prisma/migrations/migration_lock.toml" ]; then
      echo "  PASS: migration_lock.toml exists"
      PASS=$((PASS + 1))
    else
      echo "  FAIL: migration_lock.toml missing"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "  WARN: No prisma/migrations directory"
    WARN=$((WARN + 1))
  fi
elif [ -f "$PROJECT_DIR/drizzle.config.ts" ] || [ -f "$PROJECT_DIR/drizzle.config.js" ]; then
  if [ -d "$PROJECT_DIR/drizzle" ]; then
    DRIZZLE_COUNT=$(find "$PROJECT_DIR/drizzle" -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
    echo "  Drizzle migrations: $DRIZZLE_COUNT"
    echo "  PASS: Drizzle migrations directory exists"
    PASS=$((PASS + 1))
  else
    echo "  WARN: drizzle.config found but no drizzle/ directory"
    WARN=$((WARN + 1))
  fi
else
  echo "  INFO: No ORM migration detected, skipping"
fi

# ─── PROJECT_CHECKS: プロジェクト固有チェックをここに追加 ───
# 例:
# echo ""
# echo "=== 6. Custom Check ==="
# if some_condition; then
#   echo "  PASS: Custom check passed"
#   PASS=$((PASS + 1))
# else
#   echo "  FAIL: Custom check failed"
#   FAIL=$((FAIL + 1))
# fi

# --- 結果サマリー ---
echo ""
echo "============================================"
echo " Gate Quality Result: PASS=$PASS FAIL=$FAIL WARN=$WARN"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo "GATE: FAILED"
  exit 1
else
  echo "GATE: PASSED"
  exit 0
fi
