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
        assert.equal(records.length, 5)
        for (const record of records.slice(0, 2))
          assert.deepEqual(record.flags, {
            STORY68_NATIVE_TEST_BUILD: '1',
            CC68_RELEASE_PROOF_LOOPBACK: '1',
            EAS_BUILD_PROFILE: 'cc68-release-proof',
          })
        assert.ok(records[0].args.includes('--clean') && records[0].args.includes('yes'))
        assert.ok(records[1].args.includes('Release'))
        assert.equal(records[2].command, 'adb')
        assert.equal(records[3].args.includes('release-live-font'), true)
        assert.equal(records[3].flags.CC68_RELEASE_PROOF_LOOPBACK, null)
        assert.deepEqual(records[4].args, [
          'scripts/run-story68-native.mjs',
          'prebuild',
          '--platform',
          'android',
          '--clean',
          'yes',
        ])
        assert.equal(records[4].flags.CC68_RELEASE_PROOF_LOOPBACK, '0')
      } finally {
        fs.rmSync(directory, { recursive: true })
      }
    })
  }
})
