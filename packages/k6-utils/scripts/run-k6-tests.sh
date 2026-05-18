#!/usr/bin/env bash
# Bundles and runs k6 test files. Same script for local dev and CI.
#
# The load profile is always driven by the TEST_CONFIG JSON file.
# Use smoke.json for smoke tests (1 VU, 1 iteration) or any other
# profile (constant-rate, ramp-up, soak, spike) for load tests.
#
# Usage:
#   ./scripts/run-k6-tests.sh tests/k6                              # all tests in directory
#   ./scripts/run-k6-tests.sh tests/k6/crypto.k6test.ts             # single test file
#   TEST_CONFIG=configs/smoke.json ./scripts/run-k6-tests.sh tests/k6  # smoke (1 VU, 1 iter)
#   QPS=50 DURATION=5m ./scripts/run-k6-tests.sh tests/k6           # override load params
#
# npm scripts:
#   npm run test:k6:smoke                                             # all tests, smoke mode
#   npm run test:k6                                                  # all tests, normal mode
#   npm run test:k6 -- tests/k6/crypto.k6test.ts                    # single file
#
# Env vars (all optional):
#   TEST_CONFIG  - path to config JSON (consumed by getConfig()); filename determines run mode
#   QPS          - requests per second override (consumed by applyEnvOverrides())
#   DURATION     - test duration override (e.g. 5m, 30m, 2h)
#   VUS          - virtual users override
#   ENVIRONMENT  - target environment metadata (e.g. dev, staging)
#   GIT_SHA      - git SHA metadata written into summary.json
#   TEST_ID      - optional k6 tag value; runner emits --tag testid=$TEST_ID
#   SUMMARY_OUTPUT - output path for summary JSON; per-file names are derived from this
#   SUMMARY_TREND_STATS - k6 summary trend stats (default: avg,min,med,max,p(90),p(95),p(99))
#   K6_OUT       - k6 output (e.g. experimental-prometheus-rw for Grafana)

set -euo pipefail

TARGET="${1:-tests/k6}"

mkdir -p dist

# Determine test files: single file or all *.k6test.ts in a directory
if [ -f "$TARGET" ]; then
  tests=("$TARGET")
elif [ -d "$TARGET" ]; then
  shopt -s nullglob
  tests=("${TARGET}"/*.k6test.ts)
else
  echo "ERROR: ${TARGET} is not a file or directory" >&2
  exit 1
fi

if [ ${#tests[@]} -eq 0 ]; then
  echo "ERROR: No .k6test.ts files found in ${TARGET}" >&2
  exit 1
fi

echo "Found ${#tests[@]} test(s) in ${TARGET}"

for test in "${tests[@]}"; do
  echo ""
  echo "=== ${test} ==="

  # Bundle: esbuild inlines npm imports, --external leaves k6 built-ins for runtime
  npx esbuild "$test" --bundle --outfile=dist/test.js --format=esm \
    --external:k6 --external:"k6/*" --external:"https://jslib.k6.io/*"

  k6_flags=()

  # Forward env vars for getConfig() / applyEnvOverrides() inside the test script
  [ -n "${TEST_CONFIG:-}" ] && k6_flags+=(--env "TEST_CONFIG=${TEST_CONFIG}")
  [ -n "${QPS:-}" ]         && k6_flags+=(--env "QPS=${QPS}")
  [ -n "${DURATION:-}" ]    && k6_flags+=(--env "DURATION=${DURATION}")
  [ -n "${VUS:-}" ]         && k6_flags+=(--env "VUS=${VUS}")

  # Derive run mode from config filename (smoke → smoke, otherwise load)
  config_name=$(basename "${TEST_CONFIG:-}" .json 2>/dev/null || echo "")
  k6_flags+=(--env "K6_RUN_MODE=${K6_RUN_MODE:-$( [ "$config_name" = "smoke" ] && echo smoke || echo load )}")
  [ -n "${ENVIRONMENT:-}" ] && k6_flags+=(--env "ENVIRONMENT=${ENVIRONMENT}")
  [ -n "${GIT_SHA:-}" ]     && k6_flags+=(--env "GIT_SHA=${GIT_SHA}")
  [ -n "${TEST_ID:-}" ]     && k6_flags+=(--env "TEST_ID=${TEST_ID}" --tag "testid=${TEST_ID}")
  k6_flags+=(--env "TEST_SCRIPT=${test}")
  k6_flags+=(--summary-trend-stats "${SUMMARY_TREND_STATS:-avg,min,med,max,p(90),p(95),p(99)}")

  if [ -n "${SUMMARY_OUTPUT:-}" ]; then
    test_name=$(basename "$test" .k6test.ts)
    dir=$(dirname "$SUMMARY_OUTPUT")
    [ "$dir" = "." ] && dir=""
    file_summary="${dir:+${dir}/}summary-${test_name}.json"
    k6_flags+=(--env "SUMMARY_OUTPUT=${file_summary}")
  fi

  # Forward repo-specific env vars (rate limit bypass, infra delay, etc.)
  [ -n "${E2E_TEST_RATE_LIMIT_EXCLUDE_HEADER:-}" ] && k6_flags+=(--env "E2E_TEST_RATE_LIMIT_EXCLUDE_HEADER=${E2E_TEST_RATE_LIMIT_EXCLUDE_HEADER}")
  [ -n "${INFRA_DELAY:-}" ] && k6_flags+=(--env "INFRA_DELAY=${INFRA_DELAY}")

  # Optional: push metrics to Prometheus (e.g. K6_OUT=experimental-prometheus-rw)
  [ -n "${K6_OUT:-}" ] && k6_flags+=(--out "${K6_OUT}")

  k6 run ${k6_flags[@]+"${k6_flags[@]}"} dist/test.js
done

echo ""
echo "All ${#tests[@]} test(s) passed."
