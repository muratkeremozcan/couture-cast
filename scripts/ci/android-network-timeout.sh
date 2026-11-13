#!/usr/bin/env bash
# Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
# See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
#
# Story 6.15 S2-06 (TEA-12), nightly in android-native.yml: maestro/network-timeout/
# dev-client-timeout.yaml on the app's own debug development client, against
# scripts/lib/network-tarpit.mjs, the run steps the flow's header documents. The tarpit listens on
# 4010 and never answers; Metro serves the bundle with EXPO_PUBLIC_API_BASE_URL pointing at it
# through the emulator's host alias, so only the app's own 15 s abort can end Home's request.
# One strict shell owns the run; the emulator action runs each script line in its own shell.
set -euo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
evidence="${NETWORK_TIMEOUT_EVIDENCE:?evidence directory required}"
apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p "$evidence"

# Job control gives each background service its own process group, so stopping a group also
# stops the processes npx and expo start spawn under it.
set -m
node scripts/lib/network-tarpit.mjs --port 4010 > "$evidence/tarpit.log" 2>&1 &
tarpit=$!
# The app builds its Supabase client before it reads a session; without a URL and key that client
# throws and Home's request never leaves the app. These are placeholders: the flow signs nobody
# in, and the tarpit is the only server the run reaches.
(cd apps/mobile && CI=1 EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4010 \
  EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:4011 \
  EXPO_PUBLIC_SUPABASE_ANON_KEY=network-timeout-placeholder \
  npx expo start --dev-client --port 8081 > "$evidence/metro.log" 2>&1) &
metro=$!
stop_services() {
  kill -- "-$tarpit" "-$metro" 2> /dev/null || true
}
trap stop_services EXIT

# Metro answers its status route once it listens; then one Android bundle request builds the
# bundle, so the app's first load does not wait for a cold build.
for _ in $(seq 1 90); do
  if curl -fsS --max-time 5 http://127.0.0.1:8081/status 2> /dev/null | grep -q 'packager-status:running'; then
    break
  fi
  sleep 2
done
curl -fsS --max-time 5 http://127.0.0.1:8081/status | grep -q 'packager-status:running'
curl -fsS --max-time 600 -o /dev/null \
  'http://127.0.0.1:8081/node_modules/expo-router/entry.bundle?platform=android&dev=true&minify=false'
# The tarpit must hold its port before the flow starts; a dead one would refuse at once.
kill -0 "$tarpit"

adb -s "$ANDROID_SERIAL" install -r "$apk"
"$HOME/.maestro/bin/maestro" --device "$ANDROID_SERIAL" test \
  -e MAESTRO_APP_ID=com.couturecast.app \
  -e 'APP_URL=mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081' \
  --test-output-dir "$evidence/maestro" \
  maestro/network-timeout/dev-client-timeout.yaml
# The flow's closing screenshot, where this Maestro writes it; the flow already passed.
if [ -f maestro/artifacts/network-timeout-error-state.png ]; then
  cp maestro/artifacts/network-timeout-error-state.png "$evidence/"
fi
