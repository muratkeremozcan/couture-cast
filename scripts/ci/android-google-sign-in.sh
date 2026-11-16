#!/usr/bin/env bash
# Learning path Step 57: Google sign-in.
# See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
#
# Story 6.17 M lane, nightly and on dispatch in android-native.yml: the Google sign-in device flows
# (maestro/google-sign-in/) on the isolated Story 6.5 debug client, through
# scripts/run-google-native.mjs, which owns the stack (isolated database, mock OIDC provider, API,
# Metro) and its cleanup. Local Supabase is already up; the job's Redis service is the run's own.
# One strict shell owns the run; the emulator action runs each script line in its own shell.
set -euo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
evidence="${GOOGLE_NATIVE_EVIDENCE:?evidence directory required}"
apk=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p "$evidence"

adb -s "$ANDROID_SERIAL" wait-for-device
adb -s "$ANDROID_SERIAL" shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 1; done'
node scripts/run-google-native.mjs --apk "$apk" --device "$ANDROID_SERIAL" --evidence "$evidence"
# Guardian consent is off by default (owner ruling 2026-11-16); the waiting-teen flow runs in its
# own lane against an API started with GUARDIAN_CONSENT_POLICY=required_13_15.
mkdir -p "$evidence/consent-required"
GUARDIAN_CONSENT_POLICY=required_13_15 node scripts/run-google-native.mjs --apk "$apk" \
  --device "$ANDROID_SERIAL" --evidence "$evidence/consent-required"
