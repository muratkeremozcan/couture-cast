#!/usr/bin/env bash
# The one place CI installs Ubuntu packages (PR #205). On 2026-11-11 the hosted runners could not
# resolve security.ubuntu.com for about five minutes and three PR jobs failed installing Playwright's
# system packages. Two layers of retry ride out a blip that long:
#
# - apt's own: each failed fetch is retried 5 times, and a fetch that hangs gives up after 30 s;
# - this script: a failed install runs again after 15, 30, 60 and 120 s.
#
# It never signals anything. The bound is the calling step's `timeout-minutes`, which the runner
# enforces on the whole process tree; every step that runs this script sets one.
#
#   bash scripts/ci/apt-install.sh --playwright <browser>...   Playwright's system packages
#   bash scripts/ci/apt-install.sh <package>...                Ubuntu packages
#
# scripts/ci/apt-install.test.mjs fails when an apt call appears anywhere else under .github or
# scripts, or in a package.json script.
set -u -o pipefail

usage() {
  echo "usage: apt-install.sh --playwright <browser>... | <package>..." >&2
  exit 2
}
(( $# > 0 )) || usage

read -r -a pauses <<< "${APT_INSTALL_PAUSES:-15 30 60 120}"
for pause in "${pauses[@]}"; do
  [[ "$pause" =~ ^[0-9]{1,3}$ ]] || { echo "APT_INSTALL_PAUSES must be whole seconds." >&2; exit 2; }
done

printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' |
  sudo -n tee /etc/apt/apt.conf.d/80-couture-ci-retries >/dev/null ||
  { echo "::error::Could not write apt's retry settings." >&2; exit 1; }

if [[ "$1" == "--playwright" ]]; then
  shift
  (( $# > 0 )) || usage
  # The lockfile's Playwright, so the packages match the browsers it downloads.
  install() { npx --no-install playwright install-deps "$@"; }
else
  install() {
    sudo -n apt-get update &&
      sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
  }
fi

attempt=1
while true; do
  install "$@" && exit 0
  status=$?
  if (( attempt > ${#pauses[@]} )); then
    echo "::error::Package install failed $attempt times; the last exit status was $status." >&2
    exit "$status"
  fi
  pause=${pauses[attempt - 1]}
  echo "::warning::Package install failed (attempt $attempt, status $status); retrying in ${pause}s in case an Ubuntu mirror or the runner's resolver is briefly unavailable."
  sleep "$pause"
  attempt=$((attempt + 1))
done
