#!/usr/bin/env bash
#
# The body of the CI Maestro step, in a file rather than inline in the workflow.
#
# `reactivecircus/android-emulator-runner` does not run its `script:` block the
# way it looks. It splits the block on newlines and runs EACH LINE through its
# own `sh -c`, and `/usr/bin/sh` on the ubuntu runner image is dash. Three
# consequences, all of which have already cost this repo a run:
#
#   * `set -euo pipefail` is a bashism and dash rejects `pipefail` outright, so
#     the step died on its first line having already paid seven minutes of setup.
#   * `set -eu` on the first line is inert, because every later line is a new
#     shell. It looks like strict mode and is not.
#   * Variables, `export` and `cd` do not survive between lines, and multi-line
#     `if`/`for`/heredocs are broken outright.
#
# A one-line `script:` invoking this file gets real bash, working strict mode,
# and a CI path a developer can run locally to reproduce a CI failure.
#
# Usage: scripts/ci-mobile-e2e.sh [flow ...]
# With no arguments the runner discovers every flow, which is what the full
# suite does.
set -euo pipefail

echo "[ci-mobile-e2e] Waiting for the device"
adb wait-for-device
adb shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 1; done'

# `adb reverse` is how the device reaches Metro and the local API. Expo CLI
# normally does this from `openAsync`, which only runs when the CLI opens the
# app; this suite has Maestro open it instead, so nothing else establishes it.
# run-maestro.mjs re-establishes and verifies these, but doing it here too means
# the mapping exists before anything at all talks to the device.
for port in 8081 4000; do
  adb reverse "tcp:${port}" "tcp:${port}" || echo "[ci-mobile-e2e] adb reverse tcp:${port} failed"
done

echo "[ci-mobile-e2e] Installing the app under test"
npm run mobile:expo-go

mkdir -p maestro/artifacts

echo "[ci-mobile-e2e] Running Maestro"
node ./scripts/run-maestro.mjs "$@" --ci
