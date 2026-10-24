#!/usr/bin/env bash
# Story 6.7: turn TalkBack on or off on the connected emulator over adb, and wait
# until touch exploration follows. Usage: android-talkback.sh enable|disable
set -euo pipefail
ADB="${ADB:-adb}"
service=com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService

"$ADB" wait-for-device
case "${1:-}" in
  enable)
    "$ADB" shell pm grant com.google.android.marvin.talkback android.permission.POST_NOTIFICATIONS || true
    "$ADB" shell settings put secure enabled_accessibility_services "$service"
    "$ADB" shell settings put secure accessibility_enabled 1
    want=1
    ;;
  disable)
    "$ADB" shell settings delete secure enabled_accessibility_services
    "$ADB" shell settings put secure accessibility_enabled 0
    want=0
    ;;
  *)
    echo "usage: $0 enable|disable" >&2
    exit 2
    ;;
esac
for _ in $(seq 1 30); do
  state=$("$ADB" shell settings get secure touch_exploration_enabled | tr -d '\r')
  if [ "$want" = 1 ] && [ "$state" = 1 ]; then echo "TalkBack on, touch exploration on."; exit 0; fi
  if [ "$want" = 0 ] && [ "$state" != 1 ]; then echo "TalkBack off."; exit 0; fi
  sleep 2
done
echo "::error::touch_exploration_enabled is '$state' after waiting for TalkBack to turn $1." >&2
exit 1
