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
STORY68_NATIVE_TEST_BUILD=1 CC68_RELEASE_PROOF_LOOPBACK=1 EAS_BUILD_PROFILE=cc68-release-proof \
  node scripts/run-story68-native.mjs prebuild --platform android --clean yes
STORY68_NATIVE_TEST_BUILD=1 CC68_RELEASE_PROOF_LOOPBACK=1 EAS_BUILD_PROFILE=cc68-release-proof \
  node scripts/run-story68-native.mjs build --platform android --configuration Release --arch x86_64
adb -s "$ANDROID_SERIAL" install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
node scripts/run-story68-native.mjs release-live-font --platform android --device "$ANDROID_SERIAL"
