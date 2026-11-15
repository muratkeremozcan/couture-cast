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
import zlib from 'node:zlib'

import {
  IDAT,
  IEND,
  IHDR,
  REAL_ANDROID_METADATA,
  REAL_IOS_METADATA,
  chunk,
  iTXt,
  pngFile,
  tEXt,
  zTXt,
} from './fixtures/png-chunks.mjs'
import {
  AUDIT_SCREEN_FILE,
  AUDIT_STATES,
  NATIVE_AUDIT_SCREEN,
  assertPublicAuditScreen,
  clearAuditScreens,
  exportAuditScreens,
} from './share-card-audit-screens.mjs'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// A whole PNG told apart from the others by an innocuous title.
const png = (label) => pngFile([tEXt('Title', label)])
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.sig'
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
      [pngFile([tEXt('Comment', JWT)]), 'private_data_in_public_evidence'],
      [pngFile([tEXt('Comment', 'service_role')]), 'private_data_in_public_evidence'],
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
  })

  // PR 237 review P2: open is written first in name order, then storage-failure is refused.
  test('one refused screen leaves no screen of any state behind', (t) => {
    const { directory, run } = fixture(t, [
      { name: `audit-failure-open_0_${uuid(1)}.png`, bytes: png('open'), timestamp: 1 },
      {
        name: `audit-failure-storage-failure_0_${uuid(2)}.png`,
        bytes: pngFile([zTXt('Comment', `member@cc68.test ${JWT}`)]),
        timestamp: 2,
      },
    ])
    fs.writeFileSync(path.join(directory, 'audit-failure-saved.png'), png('stale'))
    assert.throws(
      () => exportAuditScreens({ result: 'r.xcresult', directory, run }),
      /private_data_in_public_evidence/
    )
    assert.deepEqual(fs.readdirSync(directory), [])
  })

  // PR 237 review P2: only a .png regular file in the export folder is read.
  test('an exported name that is no PNG or no regular file is skipped', (t) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-audit-outside-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    fs.writeFileSync(
      path.join(outside, 'private.png'),
      pngFile([tEXt('Comment', 'outside')])
    )
    const { directory, run } = fixture(t, [
      {
        name: `audit-failure-open_0_${uuid(1)}.png`,
        file: 'manifest.json',
        timestamp: 1,
      },
      { name: `audit-failure-saved_0_${uuid(2)}.png`, file: '.', timestamp: 1 },
      {
        name: `audit-failure-denied_0_${uuid(3)}.png`,
        bytes: png('denied'),
        file: `${uuid(3)}.txt`,
        timestamp: 1,
      },
      {
        name: `audit-failure-limited_0_${uuid(4)}.png`,
        file: `${uuid(9)}.png`,
        timestamp: 1,
      },
      {
        name: `audit-failure-pending_0_${uuid(5)}.png`,
        bytes: png('pending'),
        timestamp: 1,
      },
    ])
    const linking = (binary, args) => {
      const result = run(binary, args)
      const out = args[args.indexOf('--output-path') + 1]
      fs.symlinkSync(path.join(outside, 'private.png'), path.join(out, `${uuid(9)}.png`))
      return result
    }
    assert.deepEqual(
      exportAuditScreens({ result: 'r.xcresult', directory, run: linking }),
      ['pending']
    )
    assert.deepEqual(fs.readdirSync(directory), ['audit-failure-pending.png'])
  })

  // PR 237 review P2: a missing or unreadable timestamp sorts last, never first.
  test('a screen without a usable timestamp never wins over a timed one', (t) => {
    const { directory, run } = fixture(t, [
      { name: `audit-failure-open_0_${uuid(1)}.png`, bytes: png('untimed') },
      {
        name: `audit-failure-open_0_${uuid(2)}.png`,
        bytes: png('garbled'),
        timestamp: 'x',
      },
      { name: `audit-failure-open_0_${uuid(3)}.png`, bytes: png('timed'), timestamp: 50 },
    ])
    assert.deepEqual(exportAuditScreens({ result: 'r.xcresult', directory, run }), [
      'open',
    ])
    assert.deepEqual(
      fs.readFileSync(path.join(directory, 'audit-failure-open.png')),
      png('timed')
    )
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
      NATIVE_AUDIT_SCREEN,
      'native-ios-en-US.png',
      'accessibility-ios.json',
    ])
      fs.writeFileSync(path.join(directory, name), 'x')
    assert.equal(NATIVE_AUDIT_SCREEN, 'native-ios-audit-failure.png')
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

// PR 237 review P1: the PNG is walked chunk by chunk; only whole files pass, and every metadata
// chunk, compressed or not, is read for the private text the public diagnostics refuse.
describe('assertPublicAuditScreen', () => {
  test('passes the chunks real XCUITest, simctl and adb screenshots carry', () => {
    assert.doesNotThrow(() => assertPublicAuditScreen(pngFile(REAL_IOS_METADATA)))
    assert.doesNotThrow(() => assertPublicAuditScreen(pngFile(REAL_ANDROID_METADATA)))
    assert.doesNotThrow(() => assertPublicAuditScreen(pngFile()))
  })

  test('pixels are never read as text', () => {
    // Stored (uncompressed) deflate keeps the bytes literal inside the IDAT.
    const literal = chunk(
      'IDAT',
      zlib.deflateSync(Buffer.from(`\0member@cc68.test /Users/x ${JWT}`), { level: 0 })
    )
    assert.doesNotThrow(() =>
      assertPublicAuditScreen(Buffer.concat([SIGNATURE, IHDR, literal, IEND]))
    )
  })

  test('refuses anything but a whole PNG', () => {
    const whole = pngFile(REAL_IOS_METADATA)
    for (const [label, bytes] of [
      ['the signature alone', SIGNATURE],
      [
        'the signature before other bytes',
        Buffer.concat([SIGNATURE, Buffer.from('<html>')]),
      ],
      ['bytes after IEND', Buffer.concat([whole, Buffer.from('member@cc68.test')])],
      ['a second file after IEND', Buffer.concat([whole, whole])],
      ['no IEND', Buffer.concat([SIGNATURE, IHDR, IDAT])],
      ['no IDAT', Buffer.concat([SIGNATURE, IHDR, IEND])],
      ['IHDR not first', Buffer.concat([SIGNATURE, IDAT, IHDR, IEND])],
      [
        'a short IHDR',
        Buffer.concat([SIGNATURE, chunk('IHDR', Buffer.alloc(12)), IDAT, IEND]),
      ],
      ['a chunk cut short', whole.subarray(0, whole.length - 3)],
      [
        'a broken CRC',
        Buffer.concat([
          SIGNATURE,
          IHDR,
          IDAT,
          Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]),
        ]),
      ],
      [
        'an IEND with data',
        Buffer.concat([SIGNATURE, IHDR, IDAT, chunk('IEND', Buffer.from('x'))]),
      ],
      [
        'a zTXt that does not inflate',
        pngFile([chunk('zTXt', Buffer.from('Comment\0\0garbage'))]),
      ],
    ])
      assert.throws(
        () => assertPublicAuditScreen(bytes),
        /^Error: invalid_audit_failure_screen/,
        label
      )
  })

  test('refuses private text in every metadata chunk, compressed or not', () => {
    for (const [label, meta] of [
      ['a JWT in a zTXt', zTXt('Comment', JWT)],
      [
        'service_role in a compressed iTXt',
        iTXt('Comment', 'service_role', { compressed: true }),
      ],
      [
        'an email in a compressed iTXt',
        iTXt('Author', 'owner@personal.invalid', { compressed: true }),
      ],
      ['an email in an iTXt', iTXt('Author', 'owner@personal.invalid')],
      ['an email in a tEXt', tEXt('Author', 'owner@personal.invalid')],
      ['a fixture account in a tEXt', tEXt('Author', 'member@cc68.test')],
      ['a local path in a tEXt', tEXt('Source', '/Users/runner/work/couture-cast/x.png')],
      ['a private folder in a zTXt', zTXt('Source', 'at /private/var/folders/x')],
      [
        'a database URI in a tEXt',
        tEXt('Source', 'postgres://postgres:pw@127.0.0.1:54322/postgres'),
      ],
      ['a Redis URI in a zTXt', zTXt('Source', 'redis://127.0.0.1:49240')],
      ['a bearer header in a tEXt', tEXt('Header', 'Authorization: Bearer abc.def')],
      ['a secret key in a tEXt', tEXt('Key', 'sb_secret_0123456789')],
      ['a private key in a zTXt', zTXt('Key', '-----BEGIN PRIVATE KEY-----')],
      ['a keyword alone', tEXt('service_role', 'x')],
      [
        'an email in UTF-16 inside eXIf',
        chunk('eXIf', Buffer.from('MM\0*owner@personal.invalid', 'utf16le')),
      ],
      [
        'an email in odd-aligned UTF-16 inside eXIf',
        chunk(
          'eXIf',
          Buffer.concat([
            Buffer.from([0x4d]),
            Buffer.from('owner@personal.invalid', 'utf16le'),
          ])
        ),
      ],
      [
        'a token in an unknown chunk',
        chunk('prVt', Buffer.from(`\0\x01refresh_token=${JWT}`)),
      ],
    ])
      assert.throws(
        () => assertPublicAuditScreen(pngFile([meta])),
        /^Error: private_data_in_public_evidence$/,
        label
      )
  })
})
