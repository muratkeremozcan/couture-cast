#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
owned_dir="$(mktemp -d "${TMPDIR:-/tmp}/cc68-header-semantics.XXXXXX")"
trap 'rm -rf "$owned_dir"' EXIT
# Linux has no CoreGraphics. The share module's shim re-exports Foundation, which defines CGRect
# there, so the same sources compile unchanged on the pull request's Linux job (story 6.15 D6).
link=()
if [ "$(uname -s)" = Linux ]; then
  swiftc -parse-as-library -emit-library -emit-module -module-name CoreGraphics \
    -emit-module-path "$owned_dir/CoreGraphics.swiftmodule" -o "$owned_dir/libCoreGraphics.so" \
    "$root/apps/mobile/modules/share-card-native-share/ios/LinuxShims/CoreGraphics/CoreGraphics.swift"
  link=(-I "$owned_dir" -L "$owned_dir" -lCoreGraphics -Xlinker -rpath -Xlinker "$owned_dir")
fi
swiftc "$root/apps/mobile/native-tests/ShareCardHeaderSemantics.swift" \
  "$root/scripts/tests/story68-header-semantics/main.swift" ${link[@]+"${link[@]}"} -o "$owned_dir/controls"
"$owned_dir/controls"
