#!/usr/bin/env bash
set -euo pipefail

ANDROID_HOME_DEFAULT="$HOME/Library/Android/sdk"
SDK_ROOT="${ANDROID_HOME:-$ANDROID_HOME_DEFAULT}"
EMULATOR_BIN="$SDK_ROOT/emulator/emulator"
ADB_BIN="$SDK_ROOT/platform-tools/adb"
AVD_NAME="${AVD_NAME:-${1:-Pixel_9_Pro_XL}}"

if [ ! -x "$EMULATOR_BIN" ]; then
  echo "Android emulator not found at $EMULATOR_BIN. Set ANDROID_HOME or install Android SDK." >&2
  exit 1
fi

if [ ! -x "$ADB_BIN" ]; then
  echo "adb not found at $ADB_BIN. Install platform-tools via Android SDK Manager." >&2
  exit 1
fi

if ! "$EMULATOR_BIN" -list-avds | grep -Fx "$AVD_NAME" >/dev/null; then
  echo "AVD \"$AVD_NAME\" not found. Create it in Android Studio Device Manager or pass AVD_NAME=your-avd." >&2
  echo "Available AVDs:" >&2
  "$EMULATOR_BIN" -list-avds >&2
  exit 1
fi

echo "[android-sim] Starting \"$AVD_NAME\""
nohup "$EMULATOR_BIN" -avd "$AVD_NAME" -no-snapshot -gpu swiftshader_indirect -no-boot-anim >/tmp/avd-"$AVD_NAME".log 2>&1 &
EMULATOR_PID=$!
echo "[android-sim] Emulator PID $EMULATOR_PID (log: /tmp/avd-$AVD_NAME.log)"

echo "[android-sim] Waiting for device"
"$ADB_BIN" wait-for-device
"$ADB_BIN" shell input keyevent 82 || true
echo "[android-sim] Device ready"
