#!/usr/bin/env bash
# Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
# See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
#
# Regenerates the dex fixtures of scripts/ci/android-release-abis.test.mjs with javac and the
# Android build-tools d8, so the reader is tested against real dex files. The Java mirrors what
# kotlinc emits for React Native's generated ReactNativeVersion.kt: a static initializer that
# boxes each number with Integer.valueOf and pairs it with its key through kotlin.TuplesKt.to.
# The minor and patch numbers are boxed before their key is loaded, as in the R8 output of a real
# release build, so the reader cannot rely on the key coming first.
#
#   ANDROID_HOME=~/Library/Android/sdk scripts/ci/fixtures/android-release-abis/build-dex.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
build_tools="$(find "${ANDROID_HOME:?set ANDROID_HOME}/build-tools" -mindepth 1 -maxdepth 1 | sort -V | tail -1)"
android_jar="$(find "$ANDROID_HOME/platforms" -name android.jar | sort -V | tail -1)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

stubs() {
  mkdir -p "$1/kotlin/collections"
  printf 'package kotlin;\npublic final class Pair { public Pair(Object a, Object b) {} }\n' \
    >"$1/kotlin/Pair.java"
  printf 'package kotlin;\npublic final class TuplesKt {\n  public static Pair to(Object a, Object b) { return new Pair(a, b); }\n}\n' \
    >"$1/kotlin/TuplesKt.java"
  printf 'package kotlin.collections;\npublic final class MapsKt {\n  public static java.util.Map mapOf(kotlin.Pair[] pairs) { return null; }\n}\n' \
    >"$1/kotlin/collections/MapsKt.java"
}

# version_class <dir> <major> <minor> <patch> <prerelease Java expression>
version_class() {
  mkdir -p "$1/com/facebook/react/modules/systeminfo"
  cat >"$1/com/facebook/react/modules/systeminfo/ReactNativeVersion.java" <<JAVA
package com.facebook.react.modules.systeminfo;

import kotlin.Pair;
import kotlin.TuplesKt;
import kotlin.collections.MapsKt;

public final class ReactNativeVersion {
  public static final ReactNativeVersion INSTANCE = new ReactNativeVersion();
  public static final java.util.Map VERSION;

  static {
    Pair[] pairs = new Pair[4];
    pairs[0] = TuplesKt.to("major", Integer.valueOf($2));
    Integer minor = Integer.valueOf($3);
    pairs[1] = TuplesKt.to("minor", minor);
    Integer patch = Integer.valueOf($4);
    pairs[2] = TuplesKt.to("patch", patch);
    pairs[3] = TuplesKt.to("prerelease", $5);
    VERSION = MapsKt.mapOf(pairs);
  }

  private ReactNativeVersion() {}
}
JAVA
}

# dex <name> <source dir>: compiles every class under the source dir into <name>.dex.
dex() {
  mkdir -p "$work/$1-classes" "$work/$1-out"
  find "$2" -name '*.java' -print0 | xargs -0 javac --release 11 -nowarn -d "$work/$1-classes"
  find "$work/$1-classes" -name '*.class' -print0 |
    xargs -0 "$build_tools/d8" --release --min-api 24 --lib "$android_jar" --output "$work/$1-out"
  cp "$work/$1-out/classes.dex" "$here/$1.dex"
}

stubs "$work/stable"
version_class "$work/stable" 0 81 5 null
dex react-native-version-0.81.5 "$work/stable"

stubs "$work/prerelease"
version_class "$work/prerelease" 0 88 0 '"rc.0"'
dex react-native-version-0.88.0-rc.0 "$work/prerelease"

# A class that only reads ReactNativeVersion.VERSION, as AndroidInfoModule does: its dex
# references the type without defining it, like most dex files of a real build.
stubs "$work/reader"
version_class "$work/reader" 0 81 5 null
mkdir -p "$work/reader/com/facebook/react/modules/systeminfo"
cat >"$work/reader/com/facebook/react/modules/systeminfo/AndroidInfoModule.java" <<'JAVA'
package com.facebook.react.modules.systeminfo;

public final class AndroidInfoModule {
  public static Object version() { return ReactNativeVersion.VERSION; }
}
JAVA
mkdir -p "$work/reader-classes" "$work/reader-out"
find "$work/reader" -name '*.java' -print0 | xargs -0 javac --release 11 -nowarn -d "$work/reader-classes"
"$build_tools/d8" --release --min-api 24 --lib "$android_jar" \
  --classpath "$work/reader-classes" --output "$work/reader-out" \
  "$work/reader-classes/com/facebook/react/modules/systeminfo/AndroidInfoModule.class"
cp "$work/reader-out/classes.dex" "$here/version-reader-only.dex"
