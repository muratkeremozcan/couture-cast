#!/usr/bin/env bash
# Installs Android SDK packages with sdkmanager before anything downloads them unguarded.
#
# Usage:
#   android-sdk-install.sh [package ...]   the named packages, or $SDK_PACKAGES when none
#   android-sdk-install.sh --gradle        what a Gradle build of the generated app needs
#                                          (scripts/ci/android-gradle-sdk-packages.mjs)
#
# android-emulator-runner and the Android Gradle plugin each download missing packages on their
# own, once, with no retry. A truncated archive left the emulator jobs with no emulator (#146 run
# 38930305333, #147 runs 38934394685 and 38946032061), and a 429 from dl.google.com failed
# android36-controls in main run 43927343722 when Gradle fetched NDK 27.1.12297006 mid-build.
# Here each package gets up to 6 attempts, with backoff, inside one budget for the whole install
# (SDK_INSTALL_BUDGET_SECONDS, default 420 s), and an attempt counts only once the package
# unpacked (its package.xml exists). A failed attempt prints the last 20 lines sdkmanager wrote:
# run 43885395866 lost 3 attempts in 2.5 minutes and the old step said nothing about why.
#
# --gradle then sets android.builder.sdkDownload=false in the user Gradle properties, so a package
# missing from that list fails the build at once, named, and is never downloaded mid-build.
set -euo pipefail

gradle=0
if [ "${1:-}" = --gradle ]; then
  gradle=1
  shift
fi
if [ "$gradle" -eq 1 ]; then
  if [ "$#" -gt 0 ]; then
    echo "Usage: android-sdk-install.sh --gradle (takes no package names)" >&2
    exit 2
  fi
  resolved="$(node "$(dirname "${BASH_SOURCE[0]}")/android-gradle-sdk-packages.mjs")"
  read -r -a packages <<< "$resolved"
elif [ "$#" -gt 0 ]; then
  packages=("$@")
else
  read -r -a packages <<< "${SDK_PACKAGES:-}"
fi
if [ "${#packages[@]}" -eq 0 ]; then
  echo "::error::No Android SDK packages to install."
  exit 2
fi
: "${ANDROID_HOME:?ANDROID_HOME must name the SDK (android-actions/setup-android sets it)}"

budget="${SDK_INSTALL_BUDGET_SECONDS:-420}"
system_image_attempt_limit="${SDK_SYSTEM_IMAGE_ATTEMPT_SECONDS:-300}"
if ! [[ "$system_image_attempt_limit" =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo '::error::SDK_SYSTEM_IMAGE_ATTEMPT_SECONDS must be a positive number of seconds.'
  exit 2
fi
backoff=(15 30 45 60 60)
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for package in "${packages[@]}"; do
  dir="$ANDROID_HOME/${package//;//}"
  attempt_limit=180
  # A cold system image can need longer than the other packages. The whole-install budget
  # still limits every attempt, including callers that allow a longer image attempt.
  case "$package" in
    system-images\;*) attempt_limit="$system_image_attempt_limit" ;;
  esac
  for attempt in 1 2 3 4 5 6; do
    remaining=$(( budget - SECONDS ))
    if [ "$remaining" -lt 20 ]; then
      echo "::error::Could not install $package: the ${budget} s install budget ran out after $(( attempt - 1 )) attempts."
      exit 1
    fi
    # Bound each attempt as well as the whole step. A stalled sdkmanager ran for 33.5
    # minutes in run 43083368586. Caching the 1.5 GB SDK entry would evict the Supabase
    # image and AVD caches that every job reads.
    limit=$(( remaining < attempt_limit ? remaining : attempt_limit ))
    timeout --kill-after=10 "$limit" sdkmanager --install "$package" --channel=0 > "$log" 2>&1 || true
    # A truncated archive never unpacks, so package.xml is the check.
    if [ -f "$dir/package.xml" ]; then
      echo "Installed $package"
      continue 2
    fi
    echo "Install attempt ${attempt} of $package left nothing behind; sdkmanager said:"
    tail -n 20 "$log" | sed 's/^/  | /'
    rm -rf "$dir"
    if [ "$attempt" -lt 6 ]; then
      # Never sleep into the step timeout: stop now if the wait would leave less than 20 s for
      # the next attempt.
      wait_seconds="${backoff[$(( attempt - 1 ))]}"
      if [ $(( budget - SECONDS - wait_seconds )) -lt 20 ]; then
        echo "::error::Could not install $package: the ${budget} s install budget ran out after ${attempt} attempts."
        exit 1
      fi
      sleep "$wait_seconds"
    fi
  done
  echo "::error::Could not install $package after 6 attempts."
  exit 1
done

if [ "$gradle" -eq 1 ]; then
  properties="${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"
  mkdir -p "$(dirname "$properties")"
  # The user-level file takes precedence over the generated project's gradle.properties. Its last
  # line may end at EOF with no newline; the setting must not run on from that line's value.
  if [ -s "$properties" ] && [ -n "$(tail -c 1 "$properties")" ]; then
    echo >> "$properties"
  fi
  echo 'android.builder.sdkDownload=false' >> "$properties"
  echo "Gradle may not download SDK packages now ($properties)."
fi
