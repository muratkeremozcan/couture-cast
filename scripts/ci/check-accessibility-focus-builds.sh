#!/usr/bin/env bash
# Story 6.7: checks that builds carry the accessibility-focus module as they must.
#   android-app APK        the app APK has the module class, Expo's module list and
#                          React Native's native library (libreactnative.so).
#   android-test APK       the module's androidTest APK leaves every native library
#                          out (its build.gradle excludes them for that APK only)
#                          and still holds the instrumentation tests.
#   ios-app BINARY IOSDIR  the app binary carries the module's Swift class (its runtime
#                          name, which survives stripping) and the generated Expo
#                          modules provider registers it.
set -euo pipefail

dex_count() { unzip -p "$1" 'classes*.dex' | strings | grep -c -F "$2" || true; }
fail() {
  echo "::error::$*" >&2
  exit 1
}

[ "$#" -ge 2 ] && [ -e "$2" ] || fail "${2:-the build} does not exist"

case "${1:-}" in
  android-app)
    apk=$2
    module=$(dex_count "$apk" 'Lexpo/modules/accessibilityfocus/AccessibilityFocusModule;')
    registry=$(dex_count "$apk" 'Lexpo/modules/ExpoModulesPackageList;')
    react=$(unzip -l "$apk" | grep -c -E 'lib/[^/]+/libreactnative\.so$' || true)
    echo "$apk: module class $module, package list $registry, libreactnative.so $react"
    [ "$module" -gt 0 ] || fail "$apk has no AccessibilityFocusModule class"
    [ "$registry" -gt 0 ] || fail "$apk has no ExpoModulesPackageList"
    [ "$react" -gt 0 ] || fail "$apk has no libreactnative.so: the module's native-library exclusion reached the app"
    ;;
  android-test)
    apk=$2
    libraries=$(unzip -l "$apk" | grep -c -E '\.so$' || true)
    tests=$(dex_count "$apk" 'Lexpo/modules/accessibilityfocus/AccessibilityFocusTalkBackTest;')
    echo "$apk: native libraries $libraries, TalkBack test class $tests"
    [ "$libraries" -eq 0 ] || fail "$apk carries $libraries native libraries"
    [ "$tests" -gt 0 ] || fail "$apk has no AccessibilityFocusTalkBackTest class"
    ;;
  ios-app)
    binary=$2
    ios=$3
    # Swift mangles the class, and a stripped release binary keeps no symbol for it,
    # so match the runtime class name the binary's metadata strings always carry.
    runtime=$(strings -a "$binary" | grep -c -F '_TtC18AccessibilityFocus24AccessibilityFocusModule' || true)
    provider=$(grep -rl --include=ExpoModulesProvider.swift -F 'AccessibilityFocusModule.self' "$ios" | head -1 || true)
    echo "$binary: runtime class name $runtime, provider ${provider:-none}"
    [ "$runtime" -gt 0 ] || fail "$binary has no _TtC18AccessibilityFocus24AccessibilityFocusModule class"
    [ -n "$provider" ] || fail "no ExpoModulesProvider.swift under $ios registers AccessibilityFocusModule.self"
    ;;
  *)
    echo "usage: $0 android-app APK | android-test APK | ios-app BINARY IOSDIR" >&2
    exit 2
    ;;
esac
