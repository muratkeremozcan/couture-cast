#!/usr/bin/env bash
# Story 6.7: the accessibility-focus module's instrumentation tests against real
# TalkBack on the connected emulator, then the suppressed-focus control: the same
# suite with the focus action skipped. Each run starts from an empty result
# directory and keeps its own copy. The job passes only when the first run's
# results show every test passing and the control's show exactly the tests that
# need the OS focus report failing on that assertion; a build or install failure,
# a missing result or any other outcome fails it.
# Run from the repository root after `expo prebuild --platform android`.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
module=apps/mobile/modules/accessibility-focus/android
raw="$module/build/outputs/androidTest-results/connected"
results="${ACCESSIBILITY_FOCUS_RESULTS:-$module/build/talkback-results}"
# Native code is built only for the emulator's ABI.
abi=$("${ADB:-adb}" shell getprop ro.product.cpu.abi | tr -d '\r')
gradle() { (cd apps/mobile/android && ./gradlew --console=plain -PreactNativeArchitectures="$abi" "$@"); }

# run NAME [gradle args...]: one fresh run, its results copied to $results/NAME.
run() {
  local name=$1
  shift
  rm -rf "$raw" "${results:?}/$name"
  mkdir -p "$results/$name"
  gradle :accessibility-focus:connectedDebugAndroidTest "$@"
  local status=$?
  [ -d "$raw" ] && cp -R "$raw/." "$results/$name/"
  return $status
}

rm -rf "${results:?}"
bash "$here/android-talkback.sh" enable || exit 1

echo "== Instrumentation tests with TalkBack"
run positive
positive_status=$?

echo "== Suppressed-focus control (must fail on the OS focus report)"
run suppressed -Pandroid.testInstrumentationRunnerArguments.suppressFocus=true
suppressed_status=$?

bash "$here/android-talkback.sh" disable || true

node "$here/check-accessibility-focus-results.mjs" "$results" "$positive_status" "$suppressed_status"
