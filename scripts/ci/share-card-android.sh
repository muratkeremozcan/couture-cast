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
adb -s "$ANDROID_SERIAL" install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
node scripts/run-story68-native.mjs open --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs signin --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs proof --platform android --device "$ANDROID_SERIAL" --reinitialize-owned-app yes
node scripts/run-story68-native.mjs matrix --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs rapid-watermark --platform android --device "$ANDROID_SERIAL"
if [ "$sdk" -ge 33 ]; then
  node scripts/run-story68-native.mjs a11y --platform android --device "$ANDROID_SERIAL"
  node scripts/run-story68-native.mjs fallback-focus --platform android --device "$ANDROID_SERIAL"
fi
if [ "$sdk" -eq 36 ]; then
  bash scripts/ci/share-card-android-release-font.sh
fi
