#!/usr/bin/env bash
set -euo pipefail

DEVICE="${IOS_SIM_DEVICE:-${1:-iPhone 17}}"

echo "[ios-sim] Booting \"$DEVICE\""
xcrun simctl boot "$DEVICE" >/dev/null 2>&1 || true
open -a Simulator >/dev/null 2>&1 || true

echo "[ios-sim] Booted devices:"
xcrun simctl list devices | grep Booted || true
