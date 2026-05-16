#!/bin/bash
#
# Run Pact consumer generation multiple times and compare normalized pact-file
# hashes. This catches nondeterministic Pact output before CI trusts the local
# contracts for provider verification.
#
# Why this is necessary:
# PactV4 writes one JSON file per consumer/provider pair, and parallel or
# stateful tests can drop, reorder, or mutate interactions between runs. Even
# without a Pact Broker, that makes the provider verification gate unreliable:
# the API may be verified against a contract that is not the same contract the
# consumer generated on a previous pass. Keeping this gate in front of provider
# verification makes the local brokerless workflow deterministic.

set -euo pipefail

CMD="${1:?usage: ./scripts/check-pact-determinism.sh \"<cmd>\" [runs] [pact-dir]}"
RUNS="${2:-3}"
PACT_DIR="${3:-./pacts}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required for Pact determinism checks" >&2
  exit 2
fi

if command -v md5sum >/dev/null 2>&1; then
  HASH_CMD="md5sum"
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD="shasum"
else
  echo "error: md5sum or shasum is required for Pact determinism checks" >&2
  exit 2
fi

if [ "$RUNS" -lt 2 ]; then
  echo "error: runs must be >= 2 to compare Pact output" >&2
  exit 2
fi

hash_pact_file() {
  jq -c '
    if .interactions then
      .interactions |= sort_by(
        (.providerStates // [] | map(.name) | join("|"))
        + "::" + (.description // "")
      )
    else
      .
    end
  ' "$1" | $HASH_CMD | awk '{print $1}'
}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

read -ra CMD_ARRAY <<< "$CMD"

echo "check-pact-determinism: $RUNS runs of [$CMD] against $PACT_DIR"

for run in $(seq 1 "$RUNS"); do
  rm -f "$PACT_DIR"/*.json 2>/dev/null || true
  echo "  run $run/$RUNS..."

  if ! "${CMD_ARRAY[@]}" >"$TMP_DIR/run-$run.log" 2>&1; then
    echo "error: command failed on run $run; log:" >&2
    cat "$TMP_DIR/run-$run.log" >&2
    exit 1
  fi

  for pact_file in "$PACT_DIR"/*.json; do
    [ -f "$pact_file" ] || continue
    name=$(basename "$pact_file")
    hash=$(hash_pact_file "$pact_file")
    count=$(jq '.interactions // [] | length' "$pact_file")
    echo "$name $hash $count" >> "$TMP_DIR/run-$run.hashes"
  done

  if [ -f "$TMP_DIR/run-$run.hashes" ]; then
    awk '{print $1}' "$TMP_DIR/run-$run.hashes" | sort -u > "$TMP_DIR/run-$run.files"
  else
    : > "$TMP_DIR/run-$run.files"
  fi
done

ALL_FILES=$(cat "$TMP_DIR"/run-*.files | sort -u)
FAIL=0

if [ -z "$ALL_FILES" ]; then
  echo "error: no Pact files were generated in $PACT_DIR" >&2
  exit 1
fi

echo ""
echo "Pact determinism report ($RUNS runs):"
for name in $ALL_FILES; do
  hashes=$(for run in $(seq 1 "$RUNS"); do
    awk -v n="$name" '$1 == n {print $2}' "$TMP_DIR/run-$run.hashes" || true
  done)
  counts=$(for run in $(seq 1 "$RUNS"); do
    awk -v n="$name" '$1 == n {print $3}' "$TMP_DIR/run-$run.hashes" || true
  done)
  observed=$(printf '%s\n' "$hashes" | grep -c . || true)
  unique=$(printf '%s\n' "$hashes" | sort -u | grep -c . || true)
  unique_counts=$(printf '%s\n' "$counts" | sort -u | tr '\n' ',' | sed 's/,$//')

  if [ "$observed" -lt "$RUNS" ]; then
    echo "  $name: MISSING in $((RUNS - observed))/$RUNS runs"
    FAIL=1
  elif [ "$unique" -gt 1 ]; then
    echo "  $name: UNSTABLE - $unique distinct hashes, interaction counts: [$unique_counts]"
    FAIL=1
  else
    echo "  $name: stable - $unique_counts interactions"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Most likely causes:"
  echo "  1. More than one pact.addInteraction() chain in a single it block"
  echo "  2. Parallel Pact test files writing the same consumer/provider pact"
  echo "  3. Conditional interactions or mutable provider-state params"
  exit 1
fi

echo ""
echo "PASS"
