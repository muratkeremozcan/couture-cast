#!/usr/bin/env bash
set -euo pipefail

if (( $EUID != 0 )); then
  echo "Usage: sudo $0" >&2
  exit 1
fi

XCODE_APP="/Applications/Xcode.app"
SIMULATOR_APP="$XCODE_APP/Contents/Developer/Applications/Simulator.app"

if [ ! -d "$XCODE_APP" ]; then
  echo "[simulator-reset] Xcode not found at $XCODE_APP" >&2
  exit 1
fi

if [ "$(xcode-select -p)" != "$XCODE_APP/Contents/Developer" ]; then
  echo "[simulator-reset] Switching Xcode path"
  xcode-select --switch "$XCODE_APP"
fi

restart_service() {
  local target="$1"
  local plist="$2"
  echo "[simulator-reset] bootout $target"
  launchctl bootout $target 2>/dev/null || true
  echo "[simulator-reset] bootstrap $target"
  launchctl bootstrap $target "$plist" || true
  echo "[simulator-reset] kickstart $target"
  launchctl kickstart -k $target || true
}

restart_service system /System/Library/LaunchDaemons/com.apple.CoreSimulator.CoreSimulatorService.plist
restart_service gui/$UID /System/Library/LaunchAgents/com.apple.CoreSimulator.CoreSimulatorService.plist

sudo -u "$SUDO_USER" open -a "$SIMULATOR_APP" || true
sleep 3

sudo -u "$SUDO_USER" xcrun simctl list devices | grep Booted || true
