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
# The debug dev client is signed with the pinned test-only keystore (Story 6.15 TEA-19) and the
# Release build keeps the template key, so Android refuses the Release APK over it
# (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Remove the dev client first, then sign in again on the
# Release build: the uninstall drops the session the dev client's sign-in left.
adb -s "$ANDROID_SERIAL" uninstall com.couturecast.story68
adb -s "$ANDROID_SERIAL" install apps/mobile/android/app/build/outputs/apk/release/app-release.apk
node scripts/run-story68-native.mjs signin --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs release-live-font --platform android --device "$ANDROID_SERIAL"
