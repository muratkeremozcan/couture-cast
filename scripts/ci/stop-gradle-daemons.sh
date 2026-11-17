#!/usr/bin/env bash
# Stops every JVM a Gradle build left running, before an emulator job boots the device.
#
# The Gradle daemon, its Kotlin compile daemons and its javac workers stay alive after a build and
# idle through the rest of the job. On the 16 GB ubuntu-latest runner of android-native.yml's
# Google sign-in job they held about 5.5 GB while the emulator (4 GB of guest RAM, 5.2 GB RSS),
# local Supabase, the API, its workers, Metro and Maestro ran: 1.45 GB stayed available and swap
# was in use (diag run 44008046979). The same job lost its runner in run 43964196075 ("The hosted
# runner lost communication with the server").
#
# `gradlew --stop` stops the Gradle daemons and their workers; the Kotlin daemons outlive it, so
# every JVM still started from the Gradle user home gets SIGTERM, then SIGKILL. Any survivor fails
# the step. Other JVMs (Maestro's, under ~/.maestro) are left alone.
# Usage: stop-gradle-daemons.sh <android project directory>
set -euo pipefail

if (( $# != 1 )); then
  echo "Usage: stop-gradle-daemons.sh <android project directory>" >&2
  exit 2
fi
project=$1
gradle_home="${GRADLE_USER_HOME:-$HOME/.gradle}"
grace="${STOP_GRADLE_GRACE_SECONDS:-30}"

# A JVM whose command line names the Gradle user home: the daemon's classpath, a Kotlin daemon's
# compiler jar, a worker's argument file.
build_jvms() {
  pgrep -f -- "java.*${gradle_home}/" || true
}
# Waits up to $1 seconds for every build JVM to exit.
wait_gone() {
  local deadline=$((SECONDS + $1))
  while [ -n "$(build_jvms)" ] && ((SECONDS < deadline)); do
    sleep 1
  done
  [ -z "$(build_jvms)" ]
}

echo "Before:"
free -m 2> /dev/null || true
(cd "$project" && ./gradlew --stop)

if ! wait_gone 0; then
  echo "Still running after gradlew --stop:"
  ps -o pid=,rss=,args= -p "$(build_jvms | paste -sd, -)" | cut -c1-200 || true
  # shellcheck disable=SC2046 # one pid per word
  kill -TERM $(build_jvms) 2> /dev/null || true
  if ! wait_gone "$grace"; then
    # shellcheck disable=SC2046
    kill -KILL $(build_jvms) 2> /dev/null || true
    if ! wait_gone 5; then
      echo "::error::Build JVMs survived SIGKILL: $(build_jvms | paste -sd' ' -)" >&2
      exit 1
    fi
  fi
fi

echo "After:"
free -m 2> /dev/null || true
echo "No Gradle, Kotlin or worker JVM is left running."
