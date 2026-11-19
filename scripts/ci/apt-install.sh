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
# first install every file there is checked against the SHA256 in the package index apt holds after
# a refresh (a partial refresh included) and dropped when it differs (apt itself checks only the
# size), and a failed install drops every package file before the retry, so a corrupt, altered or
# stale cache falls back to a download.
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

retries=$'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n'
config=$retries
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
  find "$archives" -maxdepth 1 \( -type f -o -type l \) -name '*.deb' -delete
}

# Removes one restored file and succeeds only when it is gone.
discard() {
  rm -f -- "$1" 2>/dev/null
  [[ ! -e "$1" && ! -L "$1" ]]
}

# The restored files could not all be checked, or a rejected one could not be removed: apt goes
# back to its own archive directory, so nothing restored is read, and the install downloads.
abandon_archives() {
  echo "::warning::$1 The install uses apt's own archive directory and downloads every package."
  printf '%s' "$retries" |
    sudo -n tee /etc/apt/apt.conf.d/80-couture-ci-retries >/dev/null ||
    { echo "::error::Could not write apt's retry settings." >&2; exit 1; }
  archives=
}

# The name apt gives a package file it downloads (QuoteString in apt's acquire-item.cc): package,
# version and architecture joined by '_', with '%', '_' and ':' percent-encoded, and '.' too in
# the architecture. apt finds a cached file by this name and checks only its size. The
# architecture in the name is the index stanza's Architecture-Variant, or its Architecture when it
# has none (apt 3.2's acquire-item.cc and deblistparser.cc): on Ubuntu 26.04 an x86-64-v3 runner
# installs the amd64v3 builds, Architecture amd64 and Architecture-Variant amd64v3, which apt saves
# as libsndfile1_1.2.2-4_amd64v3.deb. The pool path plays no part, so neither does it here.
apt_cache_name() {
  local package=$1 version=$2 arch=$3
  quote() {
    local value=$1 dots=${2:-}
    value=${value//%/%25}
    value=${value//_/%5f}
    value=${value//:/%3a}
    [[ -z "$dots" ]] || value=${value//./%2e}
    printf '%s' "$value"
  }
  printf '%s_%s_%s.deb' "$(quote "$package")" "$(quote "$version")" "$(quote "$arch" dots)"
}

# apt reuses a file in its archive directory when the name and size match the index, without
# checking its hash, so a restored file with the same size and different bytes would install.
# Every restored file is checked against the SHA256 the current package index gives for its
# package, version and architecture, and must sit at the name apt builds from those fields; a file
# the index does not list, whose hash differs, or whose name says another version is dropped, as
# is any symlink, and apt downloads it again.
verify_archives() {
  # Plain indexed arrays and a lookup file, so the script runs on macOS's Bash 3.2, where the
  # harness that tests it also runs.
  local debs=() ids=() specs=() deb fields package version arch
  # Every restored file is accounted for in one summary line, so a restore reconciles with what
  # stays: kept plus each reason it was dropped.
  # A file counts as dropped only once it is gone; one that stays is counted apart, and the
  # caller then keeps apt away from the whole directory.
  local kept=0 links=0 unreadable=0 misnamed=0 unvouched=0 stuck=0
  report() {
    (( kept + links + unreadable + misnamed + unvouched + stuck > 0 )) || return 0
    local unremoved=''
    (( stuck == 0 )) || unremoved=" $stuck rejected files could not be removed."
    echo "Checked the restored package files against the package index: kept $kept, dropped $((links + unreadable + misnamed + unvouched)) ($links symlinks, $unreadable unreadable, $misnamed under a name apt would not give them, $unvouched the index does not vouch for).$unremoved"
    (( stuck == 0 ))
  }
  # drop <counter> <file>: removes a rejected file and counts it under its reason.
  drop() {
    if discard "$2"; then eval "$1=\$(( $1 + 1 ))"; else stuck=$((stuck + 1)); fi
  }
  # A symlink is not a file this script downloaded, and apt would follow it past the hash check
  # below, which reads regular files only. Listed NUL-delimited, so any name counts once.
  while IFS= read -r -d '' deb; do drop links "$deb"; done \
    < <(find "$archives" -maxdepth 1 -type l -name '*.deb' -print0)
  while IFS= read -r -d '' deb; do debs+=("$deb"); done \
    < <(find "$archives" -maxdepth 1 -type f -name '*.deb' -print0 | sort -z)
  (( ${#debs[@]} > 0 )) || { report; return; }
  local kept_debs=() packages=() versions=()
  for deb in "${debs[@]}"; do
    if ! fields=$(dpkg-deb --field "$deb" Package Version Architecture 2>/dev/null); then
      drop unreadable "$deb"
      continue
    fi
    package=$(sed -n 's/^Package: //p' <<<"$fields")
    version=$(sed -n 's/^Version: //p' <<<"$fields")
    arch=$(sed -n 's/^Architecture: //p' <<<"$fields")
    if [[ -z "$package" || -z "$version" || -z "$arch" ]]; then
      drop unreadable "$deb"
      continue
    fi
    kept_debs+=("$deb")
    packages+=("$package")
    versions+=("$version")
    ids+=("$package|$arch|$version")
    specs+=("$package=$version")
  done
  (( ${#specs[@]} > 0 )) || { report; return; }
  # Error-Mode any makes a partial refresh visible. A failed refresh still leaves apt the signed
  # indexes it held before, and the install that follows (Playwright's install-deps runs its own
  # update and tolerates the same failure) installs from those or from fresher ones. So each
  # restored file is checked against the indexes apt holds either way: a file whose hash one of
  # them vouches for is a genuine archive package, apt uses it only when the index it installs
  # from names that version, and dropping it buys nothing. PR 256 run 44523768936: security.ubuntu.com
  # refused one refresh, the old rule dropped the whole WebKit cache, and the re-download from a
  # slow mirror ran into the step's 600 s bound while install-deps' own update, 15 s later, worked.
  if ! sudo -n apt-get -o APT::Update::Error-Mode=any update; then
    echo "::warning::The package index refresh was partial; checking the restored package files against the indexes apt holds."
  fi
  local index
  if ! index=$(mktemp); then
    echo "::warning::Could not create a file for the package index; the restored package files are not checked."
    return 1
  fi
  # One line per package, architecture and version the index knows, from one signed stanza: its
  # SHA256 and the architecture apt names the file by (Architecture-Variant, else Architecture).
  # Versions it no longer lists print nothing and are dropped below.
  apt-cache show "${specs[@]}" 2>/dev/null | awk '
    function emit() {
      if (p && v && a && h) print p "|" a "|" v " " h " " (w ? w : a)
      p = v = a = w = h = ""
    }
    /^Package: / { p = $2 } /^Version: / { v = $2 } /^Architecture: / { a = $2 }
    /^Architecture-Variant: / { w = $2 } /^SHA256: / { h = $2 }
    /^$/ { emit() }
    END { emit() }' > "$index"
  local i record hash label
  for (( i = 0; i < ${#kept_debs[@]}; i++ )); do
    deb=${kept_debs[i]}
    record=$(awk -v id="${ids[i]}" '$1 == id { print $2 " " $3; exit }' "$index")
    hash=${record%% *}
    label=${record#* }
    if [[ -z "$record" ]]; then
      drop unvouched "$deb"
    # apt would hand this file to dpkg as whatever version its name says, so an authentic older
    # archive stored under a newer version's name must not pass the hash check for its own version.
    elif [[ "$(basename "$deb")" != "$(apt_cache_name "${packages[i]}" "${versions[i]}" "$label")" ]]; then
      drop misnamed "$deb"
    elif [[ "$(sha256sum "$deb" | cut -d ' ' -f 1)" == "$hash" ]]; then
      kept=$((kept + 1))
    else
      drop unvouched "$deb"
    fi
  done
  rm -f "$index"
  report
}

if [[ -n "$archives" ]] && ! verify_archives; then
  abandon_archives "The restored package files in $archives could not all be checked and cleaned up."
fi

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
