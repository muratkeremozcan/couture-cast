#!/usr/bin/env bash
# One strict shell owns the full emulator journey; action script lines are separate shells.
set -euo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
# Resolve and verify the exact matrix target before any install or journey action.
sdk="$(adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')"
if [[ ! "$sdk" =~ ^[1-9][0-9]*$ ]] || [[ ! "${CC68_ANDROID_API:-}" =~ ^[1-9][0-9]*$ ]] || [[ "$sdk" != "$CC68_ANDROID_API" ]]; then
  echo 'Owned emulator SDK must equal the explicit native CI matrix API' >&2
  exit 2
fi
# API36 partitions require an explicit suite; each fresh runner authenticates itself.
suite="${CC68_ANDROID_SUITE:-}"
case "$sdk:$suite" in
  32:all|36:matrix|36:original|36:interaction) ;;
  *) echo 'Explicit native CI suite must match the verified Android API' >&2; exit 2 ;;
esac
# Device permissions alone do not prove the emulator can use KVM.
"$ANDROID_HOME/emulator/emulator" -accel-check 2>&1 | tee /tmp/cc68-accel-check.txt
grep -q 'KVM .* is installed and usable' /tmp/cc68-accel-check.txt
adb -s "$ANDROID_SERIAL" install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
node scripts/run-story68-native.mjs open --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs signin --platform android --device "$ANDROID_SERIAL"
if [[ "$suite" == all || "$suite" == original ]]; then
  node scripts/run-story68-native.mjs proof --platform android --device "$ANDROID_SERIAL" --reinitialize-owned-app yes
fi
if [[ "$suite" == all || "$suite" == matrix ]]; then
  node scripts/run-story68-native.mjs matrix --platform android --device "$ANDROID_SERIAL"
fi
if [[ "$suite" == all || "$suite" == interaction ]]; then
  node scripts/run-story68-native.mjs rapid-watermark --platform android --device "$ANDROID_SERIAL"
  if [ "$sdk" -ge 33 ]; then
    node scripts/run-story68-native.mjs a11y --platform android --device "$ANDROID_SERIAL"
    node scripts/run-story68-native.mjs fallback-focus --platform android --device "$ANDROID_SERIAL"
  fi
  if [ "$sdk" -eq 36 ]; then
    # Story 6.9 native share: fixture outcomes, the real chooser smoke and the receiving androidTest.
    node scripts/run-story68-native.mjs share-sheet --platform android --device "$ANDROID_SERIAL"
    bash scripts/ci/share-card-android-release-font.sh
  fi
fi
