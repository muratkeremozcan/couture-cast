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
# and the API36 matrix run as three shards each (all-1 to all-3, matrix-1 to matrix-3), planned
# in scripts/ci/native-matrix-shards.mjs.
suite="${CC68_ANDROID_SUITE:-}"
case "$sdk:$suite" in
  32:all-1|32:all-2|32:all-3|36:matrix-1|36:matrix-2|36:matrix-3|36:original|36:controls|36:interaction|36:release-font) ;;
  *) echo 'Explicit native CI suite must match the verified Android API' >&2; exit 2 ;;
esac
# Device permissions alone do not prove the emulator can use KVM. The check output stays in this
# process: a fixed /tmp file is shared by every concurrent run on one machine, so a parallel test
# that writes an unusable report there would fail this run.
# The report prints before any verdict, so a failing check still shows why it failed.
accel_status=0
accel_check="$("$ANDROID_HOME/emulator/emulator" -accel-check 2>&1)" || accel_status=$?
printf '%s\n' "$accel_check"
if [ "$accel_status" -ne 0 ]; then
  echo "emulator -accel-check exited $accel_status" >&2
  exit "$accel_status"
fi
grep -q 'KVM .* is installed and usable' <<<"$accel_check"
adb -s "$ANDROID_SERIAL" install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
node scripts/run-story68-native.mjs open --platform android --device "$ANDROID_SERIAL"
node scripts/run-story68-native.mjs signin --platform android --device "$ANDROID_SERIAL"
native() {
  node scripts/run-story68-native.mjs "$1" --platform android --device "$ANDROID_SERIAL" "${@:2}"
}
case "$suite" in
  all-1)
    native proof --reinitialize-owned-app yes
    native matrix --shard 1/3
    native rapid-watermark
    ;;
  all-2|all-3)
    # proof grants the API32 storage permission in shard 1; these shards set it directly.
    native permission-baseline
    native matrix --shard "${suite#all-}/3"
    ;;
  matrix-*)
    native matrix --shard "${suite#matrix-}/3"
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
    # androidTest. CI builds the receiving APKs before the emulator starts.
    native share-sheet
    ;;
  release-font)
    # The Release font proof replaces the debug dev client with a Release build. Its set-locale
    # flow needs the profile that signin created above.
    bash scripts/ci/share-card-android-release-font.sh
    ;;
esac
