#!/usr/bin/env bash
set -euo pipefail

METRO_PORT="${MOBILE_E2E_METRO_PORT:-8081}"
DEV_PORT="${EXPO_DEV_SERVER_PORT:-19000}"
PACKAGER_PROXY_PORT="${EXPO_PACKAGER_PROXY_PORT:-$DEV_PORT}"
USE_DEV_SERVER_PORT="${EXPO_USE_DEV_SERVER_PORT:-$DEV_PORT}"
WEB_PORT="${EXPO_WEB_PORT:-19001}"

export CI="${CI:-1}"
export EXPO_DEV_SERVER_PORT="$DEV_PORT"
export EXPO_PACKAGER_PROXY_PORT="$PACKAGER_PROXY_PORT"
export EXPO_USE_DEV_SERVER_PORT="$USE_DEV_SERVER_PORT"
export EXPO_WEB_PORT="$WEB_PORT"
export EXPO_NO_INTERACTIVE=1

# Expo Go startup differs by platform: iOS can fetch/install Expo Go via Expo
# CLI, while Android local smoke assumes an already attached Expo Go target.
ARGS=(--clear --port "$METRO_PORT")
if [[ "${MOBILE_E2E_EXPO_NO_OPEN:-}" == "1" || "${MOBILE_E2E_PLATFORM:-}" == "android" ]]; then
  # Sharded runs boot one simulator per shard, and `--ios` tells Expo CLI to
  # open the app on whichever simulator it resolves first, which is another
  # shard's device. Maestro launches the app itself through `openLink`, so the
  # bundler only has to serve; the runner has already installed Expo Go on the
  # simulator this shard owns.
  #
  # Android takes the same branch, for the same reason plus two Android-specific
  # ones. `--android` makes Expo CLI resolve a device itself, and when the
  # runner's target is not attached at that instant it boots an AVD of its own
  # choosing rather than the one `bootAndroidTarget` prepared: on a machine with
  # more than one AVD that is simply the wrong device, carrying whatever stale
  # Expo Go its system image shipped with. Expo CLI then asks whether to install
  # its recommended Expo Go build on that device, and since this script exports
  # EXPO_NO_INTERACTIVE=1 the prompt cannot be answered, so the bundler exits 1
  # before serving anything and the run dies on "Expo dev server never became
  # healthy". Dropping `--android` leaves device selection entirely to
  # `ensureExpoGoOnAndroid`, which pins the Expo Go version deliberately.
  ARGS+=(--go)
elif [[ "${MOBILE_E2E_PLATFORM:-}" == "ios" ]]; then
  ARGS+=(--ios --go)
else
  ARGS+=(--offline)
fi

# `-sTCP:LISTEN` is load-bearing, not tidiness. `lsof -i tcp:8081` matches every
# socket with 8081 at *either* end, so it returns the clients connected to Metro
# as well as Metro itself: the Android emulator, which reaches the bundler over
# `10.0.2.2:8081` and therefore holds a host-side socket whose peer port is
# 8081, and every Expo Go process on a booted iOS simulator. Killing that list
# to free the port shot the emulator instead, which is why a first run on a
# freshly booted device always worked and every run after it died partway
# through startup with
#
#   You have 0 devices connected, which is not enough to run 1 shards.
#
# Restricting the match to listening sockets leaves the clients alone. Verified
# against a real listener plus four connected Expo Go clients: the unrestricted
# form returned all five, this form returns only the listener.
#
# `xargs -r` is gone only because the empty case is now handled by the `-n`
# test above, which is clearer. It was never broken: BSD xargs documents `-r`
# explicitly for GNU compatibility and macOS accepts it.
if command -v lsof >/dev/null 2>&1; then
  METRO_LISTENER_PIDS=$(lsof -ti tcp:"$METRO_PORT" -sTCP:LISTEN || true)
  if [ -n "$METRO_LISTENER_PIDS" ]; then
    echo "[mobile-server] Port $METRO_PORT in use, stopping existing listener"
    echo "$METRO_LISTENER_PIDS" | xargs kill || true
    sleep 1
  fi
fi

echo "[mobile-server] Starting Expo on Metro port ${METRO_PORT}, dev server ${DEV_PORT}"
exec npm run start --workspace mobile -- "${ARGS[@]}"
