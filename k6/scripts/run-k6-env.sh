#!/usr/bin/env bash

set -euo pipefail

ENVIRONMENT="${1:?Usage: run-k6-env.sh <environment> (local, preview, production)}"

case "$ENVIRONMENT" in
  local)
    ENV_FILE=".env.local"
    DEFAULT_BASE_URL="http://127.0.0.1:4000"
    ;;
  preview)
    ENV_FILE=".env.preview"
    DEFAULT_BASE_URL="${API_PREVIEW_BASE_URL:-${COUTURE_CAST_API_PREVIEW_URL:-}}"
    ;;
  production)
    ENV_FILE=".env.prod"
    DEFAULT_BASE_URL="${API_PRODUCTION_BASE_URL:-${COUTURE_CAST_API_PRODUCTION_URL:-}}"
    ;;
  *)
    echo "Unknown environment: ${ENVIRONMENT} (expected: local, preview, production)" >&2
    exit 1
    ;;
esac

if [ -f "$ENV_FILE" ]; then
  set -a
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value%\"}"
    value="${value#\"}"
    export "$key=$value"
  done < "$ENV_FILE"
  set +a
fi

export TEST_CONFIG="${TEST_CONFIG:-../packages/k6-utils/templates/load-profiles/smoke.json}"
export SUMMARY_OUTPUT="${SUMMARY_OUTPUT:-k6/summary.json}"
export TEST_ENV="${TEST_ENV:-$ENVIRONMENT}"
export ENVIRONMENT="${ENVIRONMENT}"
export BASE_URL="${BASE_URL:-$DEFAULT_BASE_URL}"

if [ -z "$BASE_URL" ]; then
  echo "BASE_URL is required for ${ENVIRONMENT}" >&2
  exit 1
fi

exec ./k6/scripts/run-k6-tests.sh k6/tests
