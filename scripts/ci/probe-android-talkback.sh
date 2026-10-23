#!/usr/bin/env bash
# Story 6.7: does this emulator image carry TalkBack, and does it start with touch
# exploration from adb alone? The accessibility-focus device lane needs both.
# Prints the evidence and exits non-zero when either is missing.
set -uo pipefail
ADB="${ADB:-adb}"
service=com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService

"$ADB" wait-for-device
echo "Image: $("$ADB" shell getprop ro.product.name | tr -d '\r') API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')"
packages=$("$ADB" shell pm list packages | tr -d '\r' | grep -E 'talkback|marvin' || true)
echo "TalkBack packages: ${packages:-none}"
if [ -z "$packages" ]; then
  echo "::error::No TalkBack package on this image."
  exit 1
fi
"$ADB" shell pm grant com.google.android.marvin.talkback android.permission.POST_NOTIFICATIONS || true
"$ADB" shell settings put secure enabled_accessibility_services "$service"
"$ADB" shell settings put secure accessibility_enabled 1
for _ in $(seq 1 30); do
  [ "$("$ADB" shell settings get secure touch_exploration_enabled | tr -d '\r')" = "1" ] && break
  sleep 2
done
exploring=$("$ADB" shell settings get secure touch_exploration_enabled | tr -d '\r')
echo "touch_exploration_enabled: $exploring"
"$ADB" shell dumpsys accessibility | tr -d '\r' | grep -E 'Bound services|touchExplorationEnabled' | head -4
if [ "$exploring" != "1" ]; then
  echo "::error::TalkBack did not start touch exploration."
  exit 1
fi
echo "TalkBack is available and starts from adb on this image."
