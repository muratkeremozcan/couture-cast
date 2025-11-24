#!/usr/bin/env bash
set -euo pipefail

METRO_PORT="${MOBILE_E2E_METRO_PORT:-8081}"
DEV_PORT="${EXPO_DEV_SERVER_PORT:-19000}"
PACKAGER_PROXY_PORT="${EXPO_PACKAGER_PROXY_PORT:-$DEV_PORT}"
USE_DEV_SERVER_PORT="${EXPO_USE_DEV_SERVER_PORT:-$DEV_PORT}"
WEB_PORT="${EXPO_WEB_PORT:-19001}"

export CI="${CI:-1}"
export EXPO_DEV_SERVER_PORT="$DEV_PORT"
export EXPO_PACKAGER_PROXY_PORT="$PACKAGER_PROXY_PORT"
export EXPO_USE_DEV_SERVER_PORT="$USE_DEV_SERVER_PORT"
export EXPO_WEB_PORT="$WEB_PORT"
export EXPO_NO_INTERACTIVE=1

if command -v lsof >/dev/null 2>&1; then
  if lsof -ti tcp:"$METRO_PORT" >/dev/null 2>&1; then
    echo "[mobile-server] Port $METRO_PORT in use, stopping existing process"
    lsof -ti tcp:"$METRO_PORT" | xargs -r kill || true
    sleep 1
  fi
fi

echo "[mobile-server] Starting Expo on Metro port ${METRO_PORT}, dev server ${DEV_PORT}"
exec npm run start --workspace mobile -- --offline --clear --port "$METRO_PORT"
