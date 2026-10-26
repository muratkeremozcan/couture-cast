#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
owned_dir="$(mktemp -d "${TMPDIR:-/tmp}/cc68-header-semantics.XXXXXX")"
trap 'rm -rf "$owned_dir"' EXIT
swiftc "$root/apps/mobile/native-tests/ShareCardHeaderSemantics.swift" \
  "$root/scripts/tests/story68-header-semantics/main.swift" -o "$owned_dir/controls"
"$owned_dir/controls"
