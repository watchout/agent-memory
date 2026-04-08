#!/bin/bash
# gate-release: リリース前ゲート（汎用テンプレート）
# ステージング/本番環境の基本動作を確認
#
# 環境変数:
#   STG_API_URL  — ステージングAPIのURL（必須）
#   STG_APP_URL  — ステージングアプリのURL（任意）
#   HEALTH_PATH  — ヘルスチェックパス（デフォルト: /health）
#
# Usage: scripts/gates/gate-release.sh
# Exit 0 = PASSED, Exit 1 = FAILED
set -uo pipefail

PASS=0
FAIL=0

STG_API="${STG_API_URL:-}"
STG_APP="${STG_APP_URL:-}"
HEALTH="${HEALTH_PATH:-/health}"

if [ -z "$STG_API" ]; then
  echo "============================================"
  echo " Gate: Release Check"
  echo " SKIP: STG_API_URL not set"
  echo "============================================"
  echo ""
  echo "Set STG_API_URL environment variable to enable release gate."
  echo "Example: STG_API_URL=https://stg-api.example.com scripts/gates/gate-release.sh"
  exit 0
fi

echo "============================================"
echo " Gate: Release Check"
echo " API: $STG_API"
[ -n "$STG_APP" ] && echo " APP: $STG_APP"
echo "============================================"

# --- 1. API Health ---
echo ""
echo "=== 1. API Health ==="
HEALTH_RESPONSE=$(curl -s --connect-timeout 10 "$STG_API$HEALTH" 2>/dev/null || echo "FAILED")

if echo "$HEALTH_RESPONSE" | jq -e '.status == "ok" or .status == "healthy" or .status == "UP"' > /dev/null 2>&1; then
  echo "  PASS: API is healthy"
  PASS=$((PASS + 1))
elif [ "$(echo "$HEALTH_RESPONSE" | head -c 2)" = "ok" ]; then
  echo "  PASS: API is healthy (plain text)"
  PASS=$((PASS + 1))
else
  HTTP_CODE=$(curl -s --connect-timeout 10 -o /dev/null -w "%{http_code}" "$STG_API$HEALTH" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "  PASS: API responded 200"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: API health check failed (HTTP $HTTP_CODE)"
    echo "  Response: $(echo "$HEALTH_RESPONSE" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
fi

# --- 2. Build Artifact Check ---
echo ""
echo "=== 2. Build Check ==="
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

BUILD_EXISTS=false
for BUILD_DIR in .output dist .next build .nuxt; do
  if [ -d "$PROJECT_DIR/$BUILD_DIR" ]; then
    echo "  PASS: Build directory $BUILD_DIR exists"
    BUILD_EXISTS=true
    PASS=$((PASS + 1))
    break
  fi
done

if [ "$BUILD_EXISTS" = false ]; then
  echo "  WARN: No build directory found. Run build before release."
  # Not a FAIL — might be deploying from source
fi

# --- 3. App Accessibility (if STG_APP_URL set) ---
if [ -n "$STG_APP" ]; then
  echo ""
  echo "=== 3. App Accessibility ==="
  APP_CODE=$(curl -s --connect-timeout 10 -o /dev/null -w "%{http_code}" "$STG_APP" 2>/dev/null || echo "000")

  if [ "$APP_CODE" = "200" ] || [ "$APP_CODE" = "302" ] || [ "$APP_CODE" = "301" ]; then
    echo "  PASS: App is accessible (HTTP $APP_CODE)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: App is not accessible (HTTP $APP_CODE)"
    FAIL=$((FAIL + 1))
  fi
fi

# --- 4. SSL Certificate Check ---
echo ""
echo "=== 4. SSL Certificate ==="
DOMAIN=$(echo "$STG_API" | sed 's|https://||' | sed 's|/.*||')

if echo "$STG_API" | grep -q "^https://"; then
  EXPIRY=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$EXPIRY" ]; then
    EXPIRY_EPOCH=$(date -j -f "%b %d %T %Y %Z" "$EXPIRY" "+%s" 2>/dev/null || date -d "$EXPIRY" "+%s" 2>/dev/null || echo "0")
    NOW_EPOCH=$(date "+%s")
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

    if [ "$DAYS_LEFT" -gt 30 ]; then
      echo "  PASS: SSL cert valid for $DAYS_LEFT days"
      PASS=$((PASS + 1))
    elif [ "$DAYS_LEFT" -gt 0 ]; then
      echo "  WARN: SSL cert expires in $DAYS_LEFT days"
      # Not a FAIL but should be noted
    else
      echo "  FAIL: SSL cert expired"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "  WARN: Could not check SSL certificate"
  fi
else
  echo "  INFO: Not HTTPS, skipping SSL check"
fi

# ─── PROJECT_CHECKS: プロジェクト固有チェックをここに追加 ───
# 例: 認証エンドポイントの確認、特定ページの確認など
# check_endpoint() {
#   local METHOD="$1" PATH="$2"
#   local CODE=$(curl -s --connect-timeout 10 -o /dev/null -w "%{http_code}" -X "$METHOD" "$STG_API$PATH")
#   if [ "$CODE" = "200" ]; then
#     echo "  PASS: $METHOD $PATH → $CODE"; PASS=$((PASS + 1))
#   else
#     echo "  FAIL: $METHOD $PATH → $CODE"; FAIL=$((FAIL + 1))
#   fi
# }

# --- 結果サマリー ---
echo ""
echo "============================================"
echo " Gate Release Result: PASS=$PASS FAIL=$FAIL"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo "GATE: FAILED"
  exit 1
else
  echo "GATE: PASSED"
  exit 0
fi
