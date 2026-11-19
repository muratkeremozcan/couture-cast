#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_SERIAL:?explicit owned Android serial required}"
restore_normal_generation() {
  proof_status=$?
  trap - EXIT
  set +e
  CC68_RELEASE_PROOF_LOOPBACK=0 node scripts/run-story68-native.mjs prebuild --platform android --clean yes
  cleanup_status=$?
  if [ "$proof_status" -ne 0 ]; then exit "$proof_status"; fi
  exit "$cleanup_status"
}
trap restore_normal_generation EXIT
# Scheduled run 44297840032 lost the emulator during the 12-minute Release build: the build
# passed, then the install found no device and port 5554 refused the emulator kill, with not one
# line from the emulator in between. The emulator (a 4 GiB guest), the local Supabase stack, the
# owned auth, API and Metro services and this build share one 16 GiB runner, and a process that
# ends with no output is how the kernel's OOM killer ends it. On a GitHub-hosted Linux runner the
# build gets 8 GiB more swap, so memory pressure pages the idle emulator out instead.
memory_report() {
  echo "== Runner memory $1"
  free -m || true
  swapon --show || true
}
add_build_swap() {
  if [ "${GITHUB_ACTIONS:-}" != true ] || [ "$(uname -s)" != Linux ]; then return 0; fi
  local file="${RUNNER_TEMP:?RUNNER_TEMP is set on every GitHub-hosted runner}/cc68-release-build.swap"
  if ! { sudo fallocate -l 8G "$file" && sudo chmod 600 "$file" && sudo mkswap "$file" &&
    sudo swapon "$file"; }; then
    echo "::error::Adding 8 GiB of swap for the Release build failed; see the output above." >&2
    return 1
  fi
  memory_report "with the Release build's swap"
}
# The install below would only say "device not found"; this names the emulator's exit and keeps
# the kernel's account of it.
require_emulator() {
  if [ "$(adb -s "$ANDROID_SERIAL" get-state 2>/dev/null)" = device ]; then return 0; fi
  echo "::error::The emulator $ANDROID_SERIAL exited during the Release build." >&2
  memory_report "after the emulator exited"
  echo "== Kernel OOM records"
  sudo -n dmesg 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -n 20 || true
  return 1
}
add_build_swap
STORY68_NATIVE_TEST_BUILD=1 CC68_RELEASE_PROOF_LOOPBACK=1 EAS_BUILD_PROFILE=cc68-release-proof \
  node scripts/run-story68-native.mjs prebuild --platform android --clean yes
STORY68_NATIVE_TEST_BUILD=1 CC68_RELEASE_PROOF_LOOPBACK=1 EAS_BUILD_PROFILE=cc68-release-proof \
  node scripts/run-story68-native.mjs build --platform android --configuration Release --arch x86_64
require_emulator
# Over the debug dev client, so the session its sign-in left carries over: this proof build signs
# release with the same pinned test-only key (apps/mobile/plugins/with-minified-debuggable.js).
adb -s "$ANDROID_SERIAL" install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
node scripts/run-story68-native.mjs release-live-font --platform android --device "$ANDROID_SERIAL"
