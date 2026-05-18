#!/usr/bin/env bash

set -euo pipefail

TARGET="${1:-k6/tests}"

if [ -n "${BASE_URL:-}" ]; then
  INFRA_DELAY=$(curl -sf -o /dev/null -w '%{time_total}' "${BASE_URL%/}/api/health" | awk '{printf "%.0f", $1 * 1000}' || echo "0")
  echo "Infra baseline: ${INFRA_DELAY}ms (${BASE_URL%/}/api/health)"
  export INFRA_DELAY
fi

export SUMMARY_TREND_STATS="${SUMMARY_TREND_STATS:-avg,min,med,max,p(90),p(95),p(99)}"

exec ./packages/k6-utils/scripts/run-k6-tests.sh "$TARGET"
