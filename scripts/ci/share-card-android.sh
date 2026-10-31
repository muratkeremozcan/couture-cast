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
# Every lane names an explicit suite; each fresh runner authenticates itself. The API32 journey
# and the API36 matrix run as two shards each (all-1 and all-2, matrix-1 and matrix-2), planned
# in scripts/ci/native-matrix-shards.mjs.
suite="${CC68_ANDROID_SUITE:-}"
case "$sdk:$suite" in
  32:all-1|32:all-2|36:matrix-1|36:matrix-2|36:original|36:controls|36:interaction) ;;
  *) echo 'Explicit native CI suite must match the verified Android API' >&2; exit 2 ;;
esac
# Device permissions alone do not prove the emulator can use KVM.
"$ANDROID_HOME/emulator/emulator" -accel-check 2>&1 | tee /tmp/cc68-accel-check.txt
grep -q 'KVM .* is installed and usable' /tmp/cc68-accel-check.txt
adb -s "$ANDROID_SERIAL" install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
node scripts/run-story68-native.mjs open --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs signin --platform android --device "$ANDROID_SERIAL"
native() {
  node scripts/run-story68-native.mjs "$1" --platform android --device "$ANDROID_SERIAL" "${@:2}"
}
case "$suite" in
  all-1)
    native proof --reinitialize-owned-app yes
    native matrix --shard 1/2
    native rapid-watermark
    ;;
  all-2)
    # proof grants the API32 storage permission in shard 1; this shard sets it directly.
    native permission-baseline
    native matrix --shard 2/2
    ;;
  matrix-*)
    native matrix --shard "${suite#matrix-}/2"
    ;;
  original)
    native proof --reinitialize-owned-app yes
    ;;
  controls)
    native rapid-watermark
    native a11y
    native fallback-focus
    ;;
  interaction)
    # Story 6.9 native share: fixture outcomes, the real chooser smoke and the receiving
    # androidTest. The Release font proof then replaces the debug dev client share-sheet drives.
    native share-sheet
    bash scripts/ci/share-card-android-release-font.sh
    ;;
esac
