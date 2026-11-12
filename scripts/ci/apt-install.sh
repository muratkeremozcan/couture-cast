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
# With APT_INSTALL_ARCHIVES set to an absolute directory, apt keeps the package files it downloads
# there, so a workflow can cache them and a later run downloads none of them again. Before the
# first install every file there is checked against the SHA256 in the current package index and
# dropped when it differs (apt itself checks only the size), and a failed install drops every
# package file before the retry, so a corrupt, altered or stale cache falls back to a download.
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

config=$'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n'
archives=${APT_INSTALL_ARCHIVES:-}
if [[ -n "$archives" ]]; then
  # apt's configuration quotes the path, so it holds only plain path characters.
  [[ "$archives" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
    { echo "APT_INSTALL_ARCHIVES must be an absolute path of letters, digits and ._/-" >&2; exit 2; }
  archives=${archives%/}
  mkdir -p "$archives/partial" ||
    { echo "::error::Could not create the package directory $archives." >&2; exit 1; }
  config+="Dir::Cache::Archives \"$archives/\";"$'\n'
fi

printf '%s' "$config" |
  sudo -n tee /etc/apt/apt.conf.d/80-couture-ci-retries >/dev/null ||
  { echo "::error::Could not write apt's retry settings." >&2; exit 1; }

drop_archives() {
  find "$archives" -maxdepth 1 -type f -name '*.deb' -delete
}

# apt reuses a file in its archive directory when the name and size match the index, without
# checking its hash, so a restored file with the same size and different bytes would install.
# Every restored file is checked against the SHA256 the current package index gives for its
# package, version and architecture; a file the index does not list, or whose hash differs, is
# dropped and apt downloads it again.
verify_archives() {
  local debs=() deb
  while IFS= read -r -d '' deb; do debs+=("$deb"); done \
    < <(find "$archives" -maxdepth 1 -type f -name '*.deb' -print0 | sort -z)
  (( ${#debs[@]} > 0 )) || return 0
  local -A ids=()
  local specs=() fields package version arch
  for deb in "${debs[@]}"; do
    if ! fields=$(dpkg-deb --field "$deb" Package Version Architecture 2>/dev/null); then
      rm -f "$deb"
      continue
    fi
    package=$(sed -n 's/^Package: //p' <<<"$fields")
    version=$(sed -n 's/^Version: //p' <<<"$fields")
    arch=$(sed -n 's/^Architecture: //p' <<<"$fields")
    if [[ -z "$package" || -z "$version" || -z "$arch" ]]; then
      rm -f "$deb"
      continue
    fi
    ids[$deb]="$package|$arch|$version"
    specs+=("$package=$version")
  done
  if (( ${#specs[@]} == 0 )) || ! sudo -n apt-get update; then
    echo "::warning::Could not check the restored package files against the package index; dropping them."
    drop_archives
    return 0
  fi
  local -A expected=()
  local id hash
  # One record per package, version and architecture the index knows; versions it no longer
  # lists print nothing and are dropped below.
  while read -r id hash; do
    expected[$id]=$hash
  done < <(apt-cache show "${specs[@]}" 2>/dev/null | awk '
    /^Package: / { p = $2 } /^Version: / { v = $2 } /^Architecture: / { a = $2 }
    /^SHA256: / { h = $2 }
    /^$/ { if (p && v && a && h) print p "|" a "|" v, h; p = v = a = h = "" }
    END { if (p && v && a && h) print p "|" a "|" v, h }')
  local kept=0 dropped=0
  for deb in "${!ids[@]}"; do
    hash=${expected[${ids[$deb]}]:-}
    if [[ -n "$hash" && "$(sha256sum "$deb" | cut -d ' ' -f 1)" == "$hash" ]]; then
      kept=$((kept + 1))
    else
      rm -f "$deb"
      dropped=$((dropped + 1))
    fi
  done
  echo "Checked the restored package files against the package index: kept $kept, dropped $dropped."
}

[[ -z "$archives" ]] || verify_archives

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
  if [[ -n "$archives" ]]; then
    # A restored package file may be what failed, so the retry downloads every package.
    echo "Dropping the package files in $archives before the retry."
    drop_archives
  fi
  sleep "$pause"
  attempt=$((attempt + 1))
done
