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
ADB="${ADB:-adb}"
module=apps/mobile/modules/accessibility-focus/android
raw="$module/build/outputs/androidTest-results/connected"
results="${ACCESSIBILITY_FOCUS_RESULTS:-$module/build/talkback-results}"
window_wait="${ACCESSIBILITY_FOCUS_WINDOW_WAIT:-30}"
# Native code is built only for the emulator's ABI.
abi=$("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r')
gradle() { (cd apps/mobile/android && ./gradlew --console=plain -PreactNativeArchitectures="$abi" "$@"); }

# diagnose NAME: what the window system and accessibility showed, kept with the results.
diagnose() {
  local out="$results/diagnostics/$1"
  mkdir -p "$out"
  "$ADB" shell dumpsys accessibility > "$out/accessibility.txt" 2>&1
  "$ADB" shell dumpsys input > "$out/input.txt" 2>&1
  "$ADB" shell dumpsys window windows > "$out/windows.txt" 2>&1
  "$ADB" exec-out screencap -p > "$out/screen.png" 2>/dev/null || true
}

# A test activity that closes onto the home screen hands the Pixel launcher a
# return-home transition. The launcher relaunches the first time it stops after
# boot, and when that relaunch meets the close, the transition leaves the
# DefaultTaskDisplayArea surface at alpha 0: SurfaceFlinger hides every app window,
# accessibility tracks none of them and TalkBack never focuses the test window
# (run 41238053357). The tests therefore run over a Settings window: their
# activities close onto it and the home task stays in the back.
park_backdrop() {
  "$ADB" shell am start -W -a android.settings.SETTINGS > /dev/null || return 1
  app_window_tracked "the Settings backdrop"
}

# app_window_tracked WHAT: accessibility tracks an active app window, as TalkBack
# needs for every test window. Fails with a diagnostic after $window_wait seconds.
app_window_tracked() {
  for _ in $(seq 1 "$window_wait"); do
    if "$ADB" shell dumpsys accessibility | grep -qE 'A11yWindow\[.*type=TYPE_APPLICATION.*active=true'; then
      return 0
    fi
    sleep 1
  done
  echo "::error::accessibility tracks no active app window under $1; TalkBack cannot focus a test window." >&2
  diagnose no-app-window
  return 1
}

# run NAME [gradle args...]: one fresh run, its results copied to $results/NAME.
run() {
  local name=$1
  shift
  rm -rf "$raw" "${results:?}/$name"
  mkdir -p "$results/$name"
  app_window_tracked "the $name run" || return 1
  gradle :accessibility-focus:connectedDebugAndroidTest "$@"
  local status=$?
  [ -d "$raw" ] && cp -R "$raw/." "$results/$name/"
  return $status
}

rm -rf "${results:?}"
# Build first, so TalkBack and the backdrop are set up right before the runs.
gradle :accessibility-focus:assembleDebugAndroidTest || exit 1
bash "$here/android-talkback.sh" enable || exit 1
park_backdrop || { bash "$here/android-talkback.sh" disable || true; exit 1; }

echo "== Instrumentation tests with TalkBack"
run positive -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.accessibilityfocus.AccessibilityFocusTalkBackTest
positive_status=$?
[ "$positive_status" = 0 ] || diagnose positive

echo "== Suppressed-focus control (must fail on the OS focus report)"
run suppressed -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.accessibilityfocus.AccessibilityFocusTalkBackTest -Pandroid.testInstrumentationRunnerArguments.suppressFocus=true
suppressed_status=$?

bash "$here/android-talkback.sh" disable || true

node "$here/check-accessibility-focus-results.mjs" "$results" "$positive_status" "$suppressed_status"
