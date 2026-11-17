#!/usr/bin/env bash
# DIAG ONLY (not for merge): android-google-sign-in.sh from main plus a resource sampler.
set -euo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
evidence="${GOOGLE_NATIVE_EVIDENCE:?evidence directory required}"
apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p "$evidence"

(
  while true; do
    {
      echo "=== $(date -u +%H:%M:%S)"
      free -m
      swapon --show 2> /dev/null || true
      df -h / /mnt 2> /dev/null || true
      uptime
      ps -eo rss,pid,args --sort=-rss | head -15 | cut -c1-200
    } >> "$evidence/resources.log"
    printf '[resources] %s %s load=%s\n' "$(date -u +%H:%M:%S)" \
      "$(free -m | awk '/Mem:/{printf "used=%dM avail=%dM", $3, $7} /Swap:/{printf " swap_used=%dM/%dM", $3, $2}')" \
      "$(cut -d' ' -f1-3 /proc/loadavg)"
    sleep 15
  done
) &
sampler=$!
trap 'kill "$sampler" 2> /dev/null || true' EXIT

adb -s "$ANDROID_SERIAL" wait-for-device
adb -s "$ANDROID_SERIAL" shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 1; done'
node scripts/run-google-native.mjs --apk "$apk" --device "$ANDROID_SERIAL" --evidence "$evidence"
mkdir -p "$evidence/consent-required"
GUARDIAN_CONSENT_POLICY=required_13_15 node scripts/run-google-native.mjs --apk "$apk" \
  --device "$ANDROID_SERIAL" --evidence "$evidence/consent-required"
