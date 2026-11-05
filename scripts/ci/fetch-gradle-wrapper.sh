#!/usr/bin/env bash
# Learning path Step 52: the Gradle wrapper downloads its distribution from GitHub releases with no
# retry of its own, so a short burst of 504 failed the Android jobs of PR 196 before any build ran.
# Later `./gradlew` calls in the project reuse what this downloads.
# Usage: fetch-gradle-wrapper.sh <generated Android project directory>
set -u -o pipefail

if (( $# != 1 )); then
  echo "Usage: fetch-gradle-wrapper.sh <android project directory>" >&2
  exit 2
fi
cd "$1" || exit 2

fetch_log=$(mktemp) || exit 1
trap 'rm -f "$fetch_log"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for attempt in 1 2 3; do
  ./gradlew --version 2>&1 | tee "$fetch_log"
  status="${PIPESTATUS[0]}"
  if (( status == 0 )); then exit 0; fi
  if (( status >= 128 )); then exit "$status"; fi
  if (( attempt == 3 )) || ! grep -Eq 'HTTP response code: 50[0234]\b|SocketTimeoutException|ConnectTimeoutException|Read timed out|Connection timed out' "$fetch_log"; then
    exit "$status"
  fi
  echo "::warning::The Gradle wrapper hit a transient download error (attempt $attempt/3); retrying."
  sleep "$((30 * attempt))" || exit "$?"
done
