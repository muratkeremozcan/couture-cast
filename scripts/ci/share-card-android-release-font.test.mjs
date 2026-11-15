// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'

describe('share-card-android-release-font.sh', () => {
  for (const failure of ['none', 'proof', 'cleanup']) {
    test(`actual CI Release script scopes proof flags and cleanly switches off after ${failure}`, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-release-ci-'))
      try {
        const bin = path.join(directory, 'bin')
        fs.mkdirSync(bin)
        const events = path.join(directory, 'events.jsonl')
        for (const command of ['node', 'adb']) {
          fs.writeFileSync(
            path.join(bin, command),
            `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
const flags = Object.fromEntries(['STORY68_NATIVE_TEST_BUILD', 'CC68_RELEASE_PROOF_LOOPBACK', 'EAS_BUILD_PROFILE'].map(key => [key, process.env[key] ?? null]))
fs.appendFileSync(process.env.CC68_CI_EVENTS, JSON.stringify({ command: '${command}', args, flags }) + '\\n')
// The device holds the debug dev client, signed with the pinned test keystore (Story 6.15
// TEA-19); the Release APK keeps the template key, so an install over it is refused.
if ('${command}' === 'adb' && args.includes('install')) {
  const events = fs.readFileSync(process.env.CC68_CI_EVENTS, 'utf8').trim().split('\\n').map((line) => JSON.parse(line))
  if (!events.some((event) => event.command === 'adb' && event.args.includes('uninstall'))) {
    console.error('adb: failed to install app-release.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.couturecast.story68 signatures do not match newer version; ignoring!]')
    process.exit(1)
  }
}
if (process.env.CC68_CI_FAILURE === 'proof' && args.includes('release-live-font')) process.exit(19)
if (process.env.CC68_CI_FAILURE === 'cleanup' && args.includes('prebuild') && flags.CC68_RELEASE_PROOF_LOOPBACK === '0') process.exit(37)
`,
            { mode: 0o755 }
          )
        }
        const result = spawnSync(
          'bash',
          ['scripts/ci/share-card-android-release-font.sh'],
          {
            encoding: 'utf8',
            timeout: 5000,
            env: {
              ...process.env,
              PATH: `${bin}${path.delimiter}${process.env.PATH}`,
              ANDROID_SERIAL: 'emulator-5554',
              CC68_CI_EVENTS: events,
              CC68_CI_FAILURE: failure,
              CC68_RELEASE_PROOF_LOOPBACK: undefined,
              STORY68_NATIVE_TEST_BUILD: undefined,
              EAS_BUILD_PROFILE: undefined,
            },
          }
        )
        assert.equal(
          result.status,
          failure === 'proof' ? 19 : failure === 'cleanup' ? 37 : 0,
          result.stderr
        )
        const records = fs
          .readFileSync(events, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        assert.equal(records.length, 8)
        for (const record of records.slice(0, 2))
          assert.deepEqual(record.flags, {
            STORY68_NATIVE_TEST_BUILD: '1',
            CC68_RELEASE_PROOF_LOOPBACK: '1',
            EAS_BUILD_PROFILE: 'cc68-release-proof',
          })
        assert.ok(records[0].args.includes('--clean') && records[0].args.includes('yes'))
        assert.ok(records[1].args.includes('Release'))
        // The debug dev client is signed with another key, so it is removed before the Release
        // APK goes on, and the removed session is signed in again on the Release build.
        assert.deepEqual(records[2], {
          command: 'adb',
          args: ['-s', 'emulator-5554', 'uninstall', 'com.couturecast.story68'],
          flags: {
            STORY68_NATIVE_TEST_BUILD: null,
            CC68_RELEASE_PROOF_LOOPBACK: null,
            EAS_BUILD_PROFILE: null,
          },
        })
        assert.deepEqual(records[3].args, [
          '-s',
          'emulator-5554',
          'install',
          'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
        ])
        // The sign-in flow waits for an app the runner opened, so the Release activity starts.
        assert.deepEqual(records[4].args, [
          '-s',
          'emulator-5554',
          'shell',
          'am',
          'start',
          '-n',
          'com.couturecast.story68/.MainActivity',
        ])
        assert.deepEqual(records[5].args, [
          'scripts/run-story68-native.mjs',
          'signin',
          '--platform',
          'android',
          '--device',
          'emulator-5554',
        ])
        assert.equal(records[6].args.includes('release-live-font'), true)
        assert.equal(records[6].flags.CC68_RELEASE_PROOF_LOOPBACK, null)
        assert.deepEqual(records[7].args, [
          'scripts/run-story68-native.mjs',
          'prebuild',
          '--platform',
          'android',
          '--clean',
          'yes',
        ])
        assert.equal(records[7].flags.CC68_RELEASE_PROOF_LOOPBACK, '0')
      } finally {
        fs.rmSync(directory, { recursive: true })
      }
    })
  }
})
