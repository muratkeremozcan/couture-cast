#!/usr/bin/env bash
# Story 6.7: the accessibility-focus module's instrumentation tests against real
# TalkBack on the connected emulator, then the suppressed-focus control, which
# must fail: with the focus action skipped, no OS focus report may arrive.
# Run from the repository root after `expo prebuild --platform android`.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# Native code is built only for the emulator's ABI.
abi=$("${ADB:-adb}" shell getprop ro.product.cpu.abi | tr -d '\r')
gradle() { (cd apps/mobile/android && ./gradlew --console=plain -PreactNativeArchitectures="$abi" "$@"); }

bash "$here/android-talkback.sh" enable || exit 1

echo "== Instrumentation tests with TalkBack"
gradle :accessibility-focus:connectedDebugAndroidTest || exit 1

echo "== Suppressed-focus control (must fail)"
if gradle :accessibility-focus:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.suppressFocus=true; then
  echo "::error::The suppressed-focus control passed: the tests do not observe the OS focus."
  exit 1
fi
echo "The suppressed-focus control failed, as it must."
bash "$here/android-talkback.sh" disable || true
