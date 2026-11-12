#!/usr/bin/env bash
# Story 6.15 D6: one owned share-card runtime per segment of the single iOS job (ios-native.yml).
# The iOS journey used to run as a build job, four shard jobs and the Expo Go job, each on its own
# runner with its own UUID database, signed-in account, auth proxy, API, Metro and simulator. In
# one job the segments run in turn, and each still gets every one of them fresh:
#
#   start        provision the runtime (prepare.mjs) and start the auth proxy, the API and Metro,
#                each recording its exit status so an early crash is reported by name.
#   exits        fail when a service exited while the segment ran; its log stays private.
#   stop NAME    drop the owned database, identities and objects, stop the services, delete the
#                owned simulator and move the private runtime directory to
#                $RUNNER_TEMP/ios-native-runtimes/NAME, so the next segment provisions anew. The
#                moved directory is never uploaded.
#
# The native Supabase stack, the built packages and the development client are shared: they
# carry no account or runtime state.
set -euo pipefail

directory=${CC68_HARNESS_DIR:?CC68_HARNESS_DIR names the owned runtime directory}
# Where the harness keeps its service logs, exit files and simulator receipt; a test moves it.
tmp=${CC68_TMP:-/tmp}
# The owned services and the children they start, by command line.
service_patterns=(
  'scripts/e2e-share-card/auth.mjs'
  'scripts/run-story68-native.mjs serve'
  'scripts/lib/story68-api-entry.mjs'
  'scripts/run-story68-native.mjs metro'
  'expo start --dev-client --port 8089'
)

running() {
  local pattern
  for pattern in "${service_patterns[@]}"; do
    if pgrep -f "$pattern" > /dev/null; then return 0; fi
  done
  return 1
}

case "${1:-}" in
  start)
    node scripts/e2e-share-card/prepare.mjs
    rm -f "$tmp/cc68-auth.exit" "$tmp/cc68-api.exit" "$tmp/cc68-metro.exit"
    (node scripts/e2e-share-card/auth.mjs > "$tmp/cc68-auth.log" 2>&1; echo $? > "$tmp/cc68-auth.exit") &
    (node scripts/run-story68-native.mjs serve > "$tmp/cc68-api.log" 2>&1; echo $? > "$tmp/cc68-api.exit") &
    (node scripts/run-story68-native.mjs metro --platform ios > "$tmp/cc68-metro.log" 2>&1; echo $? > "$tmp/cc68-metro.exit") &
    node scripts/maestro-install.mjs
    ;;
  exits)
    # Logs stay private: they can carry owned-runtime credentials.
    status=0
    for service in auth api metro; do
      if [ -f "$tmp/cc68-$service.exit" ]; then
        echo "::error::owned $service service exited early with status $(cat "$tmp/cc68-$service.exit"); its private log has $(wc -l < "$tmp/cc68-$service.log" | tr -d ' ') lines"
        status=1
      fi
    done
    exit "$status"
    ;;
  stop)
    name=${2:?stop needs the segment name}
    [[ "$name" =~ ^[a-z0-9-]+$ ]] || { echo "::error::invalid segment name $name"; exit 2; }
    status=0
    node scripts/e2e-share-card/cleanup.mjs || status=1
    for pattern in "${service_patterns[@]}"; do pkill -TERM -f "$pattern" || true; done
    for _ in $(seq 1 30); do
      running || break
      sleep 1
    done
    if running; then
      echo "::warning::owned services outlived SIGTERM by 30 s; killing them"
      for pattern in "${service_patterns[@]}"; do pkill -KILL -f "$pattern" || true; done
      sleep 1
    fi
    # A stopped service writes its exit file; the next segment reports only its own exits.
    rm -f "$tmp/cc68-auth.exit" "$tmp/cc68-api.exit" "$tmp/cc68-metro.exit"
    node scripts/ci/native-ios-device-cleanup.mjs || status=1
    rm -f "$tmp/cc68-simulator"
    if [ -d "$directory" ]; then
      mkdir -p "$RUNNER_TEMP/ios-native-runtimes"
      mv "$directory" "$RUNNER_TEMP/ios-native-runtimes/$name"
    fi
    exit "$status"
    ;;
  *)
    echo "usage: $0 start | exits | stop NAME" >&2
    exit 2
    ;;
esac
