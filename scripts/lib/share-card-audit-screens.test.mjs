// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
//
// iOS 26.5 canary shard 3 failed preparing on "Potentially inaccessible text" with no screen. A
// failed audit run exports each refused issue's screen from its xcresult as
// audit-failure-<state>.png; scripts/ci/share-card-native-failure.spec.mjs proves what the
// public evidence then publishes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import {
  AUDIT_SCREEN_FILE,
  AUDIT_STATES,
  assertPublicAuditScreen,
  clearAuditScreens,
  exportAuditScreens,
} from './share-card-audit-screens.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const png = (text) => Buffer.concat([PNG, Buffer.from(text)])
const uuid = (n) => `9D127D44-07B2-4E1F-BDC7-${String(n).padStart(12, '0')}`

/**
 * A harness directory and a `run` that answers the export as xcresulttool 3.x does: one file
 * per attachment named by a UUID, and manifest.json naming each `<name>_<index>_<UUID>.<ext>`.
 */
function fixture(t, attachments) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-audit-screens-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const calls = []
  const run = (binary, args) => {
    calls.push([binary, ...args])
    const out = args[args.indexOf('--output-path') + 1]
    fs.mkdirSync(out, { recursive: true })
    const manifest = attachments.map(({ name, bytes, timestamp, file }, index) => {
      const exportedFileName = file ?? `${uuid(index)}.png`
      if (bytes) fs.writeFileSync(path.join(out, path.basename(exportedFileName)), bytes)
      return {
        configurationName: 'Test Scheme Action',
        deviceId: uuid(99),
        deviceName: 'iPhone 16',
        exportedFileName,
        isAssociatedWithFailure: false,
        suggestedHumanReadableName: name,
        timestamp,
      }
    })
    fs.writeFileSync(
      path.join(out, 'manifest.json'),
      JSON.stringify([
        {
          attachments: manifest,
          testIdentifier:
            'ShareCardAccessibilityUITests/testPreparingCancelAndRetryTraversal()',
        },
      ])
    )
    return ''
  }
  return { directory, run, calls }
}

describe('share-card audit screens', () => {
  test('the closed states are exactly the states audit(_:) is called with', () => {
    const swift = fs.readFileSync(
      'apps/mobile/native-tests/ShareCardAccessibilityUITests.swift',
      'utf8'
    )
    const called = [
      ...new Set([...swift.matchAll(/audit\("([a-z-]+)"\)/g)].map((m) => m[1])),
    ]
    assert.deepEqual(called.sort(), [...AUDIT_STATES])
    for (const state of AUDIT_STATES)
      assert.ok(AUDIT_SCREEN_FILE.test(`audit-failure-${state}.png`), state)
    for (const name of [
      'audit-failure-unknown.png',
      'audit-failure-preparing.jpg',
      'audit-failure-preparing_0.png',
      'audit-preparing.png',
      'x-audit-failure-preparing.png',
    ])
      assert.equal(AUDIT_SCREEN_FILE.test(name), false, name)
  })

  test('exports the earliest screen of each state under its fixed name', (t) => {
    const { directory, run, calls } = fixture(t, [
      {
        name: `audit-failure-preparing_0_${uuid(1)}.png`,
        bytes: png('second'),
        timestamp: 20,
      },
      {
        name: `audit-failure-preparing_0_${uuid(2)}.png`,
        bytes: png('first'),
        timestamp: 10,
      },
      {
        name: `audit-failure-storage-failure_0_${uuid(3)}.png`,
        bytes: png('storage'),
        timestamp: 30,
      },
      // Neither a closed state nor a screen of the audit: left in the private export.
      {
        name: `audit-failure-cancel_0_${uuid(4)}.png`,
        bytes: png('cancel'),
        timestamp: 1,
      },
      { name: `audit-preparing_0_${uuid(5)}.txt`, bytes: png('text'), timestamp: 1 },
      // An exported name that leaves the export folder is ignored.
      {
        name: `audit-failure-open_0_${uuid(6)}.png`,
        file: '../owned-env.json',
        timestamp: 1,
      },
    ])
    const result = path.join(directory, 'accessibility-ios-1.xcresult')
    assert.deepEqual(exportAuditScreens({ result, directory, run }), [
      'preparing',
      'storage-failure',
    ])
    assert.deepEqual(calls[0].slice(0, 4), [
      'xcrun',
      'xcresulttool',
      'export',
      'attachments',
    ])
    assert.equal(calls[0][calls[0].indexOf('--path') + 1], result)
    assert.equal(calls[0][calls[0].indexOf('--filter') + 1], 'audit-failure-*')
    assert.deepEqual(fs.readdirSync(directory).sort(), [
      'audit-failure-preparing.png',
      'audit-failure-storage-failure.png',
    ])
    assert.deepEqual(
      fs.readFileSync(path.join(directory, 'audit-failure-preparing.png')),
      png('first')
    )
  })

  test('a screen that is no PNG or carries private text writes nothing public', (t) => {
    for (const [bytes, code] of [
      [Buffer.from('GIF89a'), 'invalid_audit_failure_screen'],
      [
        png('tEXt eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.sig'),
        'private_data_in_public_evidence',
      ],
      [png('tEXt service_role'), 'private_data_in_public_evidence'],
    ]) {
      const { directory, run } = fixture(t, [
        { name: `audit-failure-open_0_${uuid(1)}.png`, bytes, timestamp: 1 },
      ])
      assert.throws(
        () => exportAuditScreens({ result: 'r.xcresult', directory, run }),
        new RegExp(code)
      )
      assert.deepEqual(fs.readdirSync(directory), [])
    }
    assert.doesNotThrow(() => assertPublicAuditScreen(png('IHDR')))
  })

  test('a failed export leaves no private folder behind', (t) => {
    const { directory } = fixture(t, [])
    assert.throws(
      () =>
        exportAuditScreens({
          result: 'r.xcresult',
          directory,
          run: () => {
            throw new Error('owned_command_failed:xcrun:64:no result bundle')
          },
        }),
      /owned_command_failed/
    )
    assert.deepEqual(fs.readdirSync(directory), [])
  })

  test('an earlier run’s screens are cleared, and nothing else', (t) => {
    const { directory } = fixture(t, [])
    for (const name of [
      'audit-failure-open.png',
      'native-ios-en-US.png',
      'accessibility-ios.json',
    ])
      fs.writeFileSync(path.join(directory, name), 'x')
    clearAuditScreens(directory)
    assert.deepEqual(fs.readdirSync(directory).sort(), [
      'accessibility-ios.json',
      'native-ios-en-US.png',
    ])
  })

  test('the harness clears before the audit runs and exports only on its failure', () => {
    const harness = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const clear = harness.indexOf('clearAuditScreens(directory)')
    const audit = harness.indexOf("const audit = child(\n    'xcodebuild'")
    const failed = harness.indexOf('if (code !== 0 || !closed.passed) {')
    const exported = harness.indexOf('exportAuditScreens({ result, directory, run })')
    const thrown = harness.indexOf("throw new Error('ios_accessibility_audit_failed')")
    assert.ok(clear > 0 && clear < audit, 'cleared before the audit starts')
    assert.ok(
      failed > audit && exported > failed && exported < thrown,
      'only on a failure'
    )
    // The export sits in its own try, so it can never replace the audit failure.
    const block = harness.slice(failed, thrown)
    assert.match(
      block,
      /try \{\n\s+console\.log\(\n\s+JSON\.stringify\(\{\n\s+iosAuditFailureScreens: exportAuditScreens\(\{ result, directory, run \}\),\n\s+\}\)\n\s+\)\n\s+\} catch \(error\) \{/
    )
  })
})
