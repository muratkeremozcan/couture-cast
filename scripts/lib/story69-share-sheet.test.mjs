import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  SHARE_COPY_ENV,
  SHARE_FIXTURE_MODES,
  SHARE_LEASE_MS,
  SHARE_FORBIDDEN_PERMISSIONS,
  SHARE_RECEIVE_APK,
  SHARE_RECEIVE_MANIFESTS,
  SHARE_SHEET_NATIVE_CASE,
  SHARE_SHEET_STEPS,
  SHARE_SHEET_UITEST_MARKERS,
  androidShareFileStore,
  assertFreshShareFile,
  assertLeasedShareFile,
  assertShareReceiveInstrumentation,
  assertShareReceiveManifest,
  assertShareSheetUITestResult,
  closedShareSheetFailure,
  iosShareFileStore,
  readComposerLayout,
  runStory69ShareSheet,
  shareCopyEnv,
  shareModuleNamespace,
  shareReceiveExpectedTests,
  shareReceiveFailureSummary,
  shareReceiveTestSource,
  shareSheetFlowRuns,
  shareAnchorHandler,
  shareItemHandler,
  shareSheetUITestProject,
  withShareFixtureIngress,
} from './story69-share-sheet.mjs'

const repo = path.resolve(import.meta.dirname, '../..')
const png = (seed) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(seed),
  ])
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
// A handoff is named by its per-share directory; the file inside is always couturecast-card.png.
const NAME_A = 'cc69-share-0f0e0d0c-1111-4222-8333-944455556666'
const NAME_B = 'cc69-share-aaaaaaaa-1111-4222-8333-944455556666'
const catalog = {
  shareCard: {
    share: 'Share',
    sharing: 'Opening share options…',
    shared: 'Shared',
    sentToApp: 'Sent to the app you chose.',
    shareClosed: 'Share closed. Your card is still here.',
    shareFailed: "Sharing didn't work. Your card is still here; you can save it instead.",
    shareUnavailable:
      "Sharing isn't available on this device. You can still save your card.",
    save: 'Save to photos',
    title: 'Your share card',
    cancel: 'Cancel',
  },
}
const tempDir = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc69-share-sheet-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
/** A receive androidTest source with the given annotated methods, comments included. */
const receiveTestSource = (annotations) =>
  [
    'import org.junit.Ignore',
    'import org.junit.Test',
    '/** A commented @Test never counts. */',
    'class ShareCardShareReceiveTest {',
    '  // @Test fun disabled() {}',
    ...annotations.map((annotation, index) => `  ${annotation}\n  fun case${index}() {}`),
    '}',
    '',
  ].join('\n')
const writeReceiveTest = (root, namespace, annotations) => {
  const file = path.join(root, shareReceiveTestSource(namespace))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, receiveTestSource(annotations))
}
/** A generated manifest shaped like the module's merged library manifest. */
const shareManifest = ({
  provider = '<provider android:name="expo.modules.sharecardnativeshare.ShareCardFileProvider" android:authorities="${applicationId}.sharecardnativeshare.fileprovider" android:exported="false" android:grantUriPermissions="true" >',
  extra = '',
} = {}) =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="expo.modules.sharecardnativeshare" >',
    '    <uses-permission android:name="android.permission.REORDER_TASKS" />',
    '    <!-- <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" /> -->',
    extra,
    '    <application>',
    `        ${provider}`,
    '            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/share_card_native_share_paths" />',
    '        </provider>',
    '    </application>',
    '</manifest>',
  ].join('\n')
const writeShareManifests = (root, xml = shareManifest()) => {
  for (const manifest of SHARE_RECEIVE_MANIFESTS) {
    fs.mkdirSync(path.dirname(path.join(root, manifest)), { recursive: true })
    fs.writeFileSync(path.join(root, manifest), xml)
  }
}
const memoryStore = (files, ages = {}) => ({
  list: () => Object.keys(files).sort(),
  read: (name) => files[name],
  ageMs: (name) => ages[name] ?? 1_000,
})

describe('share copy', () => {
  test('every share key becomes an escaped Maestro text selector', () => {
    const env = shareCopyEnv(catalog)
    assert.deepEqual(Object.keys(env).sort(), Object.values(SHARE_COPY_ENV).sort())
    assert.equal(env.MAESTRO_SENT_TO_APP, 'Sent to the app you chose\\.')
    for (const [key, name] of Object.entries(SHARE_COPY_ENV))
      assert.ok(new RegExp(`^${env[name]}$`).test(catalog.shareCard[key]), key)
    assert.equal(
      shareCopyEnv({ shareCard: { ...catalog.shareCard, sharing: 'Why?' } })
        .MAESTRO_SHARING,
      'Why\\?'
    )
  })

  test('a catalog without a share key fails before any flow runs', () => {
    for (const key of Object.keys(SHARE_COPY_ENV)) {
      const shareCard = { ...catalog.shareCard }
      delete shareCard[key]
      assert.throws(() => shareCopyEnv({ shareCard }), /share_copy_missing/)
    }
    assert.throws(() => shareCopyEnv(undefined), /share_copy_missing/)
  })
})

describe('share-sheet plan', () => {
  // The copy each flow must settle on, per platform (the result model's copy table).
  const settles = {
    ios: {
      'share-failed.yaml': 'shareFailed',
      'share-completed.yaml': 'shared',
      'share-closed.yaml': 'shareClosed',
      'share-other.yaml': 'sentToApp',
      'share-sheet.yaml': 'shareClosed',
    },
    android: {
      'share-failed.yaml': 'shareFailed',
      'share-unavailable.yaml': 'shareUnavailable',
      'share-closed.yaml': 'shareClosed',
      'share-other.yaml': 'sentToApp',
      'share-not-confirmed.yaml': 'shareClosed',
      'share-chosen.yaml': 'sentToApp',
      'share-sheet.yaml': 'shareClosed',
    },
  }

  test('each platform covers its spec cases with platform-valid fixture modes and existing flows', () => {
    assert.deepEqual(SHARE_SHEET_STEPS.ios.map((step) => step.id).sort(), [
      'M-SHARE-CLOSED',
      'M-SHARE-COMPLETED',
      'M-SHARE-FAILED',
      'M-SHARE-OTHER',
      'M-SHARE-SHEET-IOS',
    ])
    assert.deepEqual(SHARE_SHEET_STEPS.android.map((step) => step.id).sort(), [
      'M-SHARE-CHOSEN',
      'M-SHARE-CLOSED',
      'M-SHARE-FAILED',
      'M-SHARE-NOT-CONFIRMED',
      'M-SHARE-OTHER',
      'M-SHARE-SHEET-ANDROID',
      'M-SHARE-UNAVAILABLE',
    ])
    const iosOnly = ['share_completed_instagram']
    const androidOnly = [
      'share_chosen_pinterest',
      'share_not_confirmed',
      'share_unavailable',
    ]
    for (const [platform, steps] of Object.entries(SHARE_SHEET_STEPS)) {
      for (const step of steps) {
        assert.ok(SHARE_FIXTURE_MODES.includes(step.mode), step.mode)
        assert.ok(fs.existsSync(path.join(repo, 'maestro/story68', step.flow)), step.flow)
        assert.equal(settles[platform][step.flow] !== undefined, true, step.flow)
      }
      const other = platform === 'ios' ? androidOnly : iosOnly
      assert.equal(
        steps.some((step) => other.includes(step.mode)),
        false,
        `${platform} never uses the other platform's modes`
      )
    }
    assert.deepEqual(SHARE_SHEET_NATIVE_CASE, {
      ios: 'N-IOS-PRESENTER-UI',
      android: 'N-AND-RECEIVE',
    })
  })

  test('consecutive steps settle on different copy, so none passes on its predecessor', () => {
    for (const [platform, steps] of Object.entries(SHARE_SHEET_STEPS))
      steps.forEach((step, index) => {
        if (index === 0 || steps[index - 1].save || steps[index - 1].relaunch) return
        assert.notEqual(
          settles[platform][step.flow],
          settles[platform][steps[index - 1].flow],
          `${platform}: ${steps[index - 1].flow} then ${step.flow}`
        )
      })
  })

  test('a failed or unavailable share never shows the success or handoff copy', () => {
    for (const flow of ['share-failed.yaml', 'share-unavailable.yaml']) {
      const [, steps] = fs
        .readFileSync(path.join(repo, 'maestro/story68', flow), 'utf8')
        .split(/^---$/m)
        .map((document) => parse(document))
      const absent = steps
        .filter((step) => typeof step?.assertNotVisible === 'string')
        .map((step) => step.assertNotVisible)
      for (const copy of ['${MAESTRO_SHARED}', '${MAESTRO_SENT_TO_APP}'])
        assert.ok(absent.includes(copy), `${flow} asserts ${copy} is not visible`)
      // The absence is checked once the error copy has settled, never before the tap.
      const settled = steps.findIndex((step) => step?.extendedWaitUntil)
      assert.ok(settled >= 0, flow)
      for (const copy of ['${MAESTRO_SHARED}', '${MAESTRO_SENT_TO_APP}'])
        assert.ok(
          steps.findIndex((step) => step?.assertNotVisible === copy) > settled,
          `${flow} checks ${copy} after settling`
        )
    }
  })

  test('failures and unavailability prove Save, the real sheet and the Android choice prove the bytes', () => {
    for (const steps of Object.values(SHARE_SHEET_STEPS)) {
      for (const step of steps) {
        const failure = ['share_failed', 'share_unavailable'].includes(step.mode)
        assert.equal(Boolean(step.save), failure || step.id === 'M-SHARE-CHOSEN', step.id)
        assert.equal(
          Boolean(step.handoff),
          step.mode === 'real' || step.id === 'M-SHARE-CHOSEN',
          step.id
        )
      }
      assert.equal(steps.at(-1).flow, 'share-sheet.yaml')
      assert.equal(steps.at(-1).mode, 'real')
    }
    const chosen = SHARE_SHEET_STEPS.android.find((step) => step.id === 'M-SHARE-CHOSEN')
    assert.equal(chosen.relaunch, true, 'the lease is proven after a restart')
    assert.equal(
      SHARE_SHEET_STEPS.ios.some((step) => step.relaunch),
      false
    )
  })

  test('the flow list starts from a fresh runtime and ends with the composer closed', () => {
    for (const platform of ['ios', 'android']) {
      const flows = shareSheetFlowRuns(platform)
      assert.deepEqual(flows.slice(0, 3), [
        'maestro/story65/open-app.yaml',
        'maestro/story65/set-locale.yaml',
        'maestro/story68/open-outfit.yaml',
      ])
      assert.equal(flows.at(-1), 'maestro/story68/cancel.yaml')
    }
    assert.throws(() => shareSheetFlowRuns('web'), /share_sheet_platform_required/)
  })
})

describe('composer layout', () => {
  const digest = 'c'.repeat(64)
  const node = (id, bounds, children = []) => ({
    attributes: { 'resource-id': id, bounds },
    children,
  })
  const hierarchy = (scroll) =>
    JSON.stringify(
      node('', '[0,0][402,874]', [
        node('share-card-title', `[24,${78 - scroll}][378,${109 - scroll}]`),
        node(
          `share-card-preview-loaded-${digest}`,
          `[24,${189 - scroll}][378,${632 - scroll}]`
        ),
        node('share-card-save', `[24,${708 - scroll}][378,${757 - scroll}]`),
        node('share-card-share', `[24,${773 - scroll}][378,${822 - scroll}]`),
      ])
    )

  test('one read gives the preview digest and Share offset below the preview', () => {
    assert.deepEqual(readComposerLayout(hierarchy(0)), {
      digest,
      share: { offset: 141, height: 49 },
    })
  })

  test('the offset holds while the composer scrolls', () => {
    assert.deepEqual(readComposerLayout(hierarchy(60)), readComposerLayout(hierarchy(0)))
  })

  test('a missing loaded preview or Share fails closed', () => {
    assert.throws(
      () => readComposerLayout(JSON.stringify(node('share-card-share', '[0,1][2,3]'))),
      /loaded_approved_preview_required/
    )
    assert.throws(
      () =>
        readComposerLayout(
          JSON.stringify(node(`share-card-preview-loaded-${digest}`, '[0,1][2,3]'))
        ),
      /share_action_required/
    )
    assert.equal(
      closedShareSheetFailure(new Error('share_action_moved')),
      'share_action_moved'
    )
  })
})

describe('handoff file proof', () => {
  const bytes = png('preview')
  const digest = sha(bytes)

  test('exactly one fresh PNG with the preview digest inside its lease passes', () => {
    const store = memoryStore({ [NAME_A]: png('old'), [NAME_B]: bytes })
    assert.equal(assertFreshShareFile(store, [NAME_A], digest), NAME_B)
  })

  test('no fresh file, two fresh files, other bytes or a non-PNG fail closed', () => {
    assert.throws(
      () => assertFreshShareFile(memoryStore({ [NAME_A]: bytes }), [NAME_A], digest),
      /share_handoff_file_count/
    )
    assert.throws(
      () =>
        assertFreshShareFile(
          memoryStore({ [NAME_A]: bytes, [NAME_B]: bytes }),
          [],
          digest
        ),
      /share_handoff_file_count/
    )
    assert.throws(
      () => assertFreshShareFile(memoryStore({ [NAME_B]: png('other') }), [], digest),
      /share_handoff_digest_mismatch/
    )
    const text = Buffer.from('not a png')
    assert.throws(
      () => assertFreshShareFile(memoryStore({ [NAME_B]: text }), [], sha(text)),
      /share_handoff_digest_mismatch/
    )
  })

  test('an expired or future modification time is outside the lease', () => {
    for (const age of [SHARE_LEASE_MS, SHARE_LEASE_MS + 1, -60_000, Number.NaN])
      assert.throws(
        () =>
          assertLeasedShareFile(
            memoryStore({ [NAME_A]: bytes }, { [NAME_A]: age }),
            NAME_A,
            digest
          ),
        /share_handoff_lease_invalid/,
        String(age)
      )
    assert.doesNotThrow(() =>
      assertLeasedShareFile(
        memoryStore({ [NAME_A]: bytes }, { [NAME_A]: SHARE_LEASE_MS - 1 }),
        NAME_A,
        digest
      )
    )
  })

  test('a removed or foreign-named file fails as removed', () => {
    assert.throws(
      () => assertLeasedShareFile(memoryStore({}), NAME_A, digest),
      /share_handoff_file_removed/
    )
    assert.throws(
      () =>
        assertLeasedShareFile(memoryStore({ 'cc68-x.png': bytes }), 'cc68-x.png', digest),
      /share_handoff_file_removed/
    )
  })

  test('the Android store lists only cc69-share handoffs through run-as and reads their bytes', () => {
    const calls = []
    const ctx = {
      adb: '/owned/adb',
      device: 'emulator-5584',
      appId: 'com.couturecast.story68',
      run: (binary, args) => {
        calls.push([binary, ...args].join(' '))
        if (args.includes('find'))
          return [
            `cache/share-cards/${NAME_A}/couturecast-card.png`,
            'cache/share-cards/cc68-11111111-2222/couturecast-card.png',
            `cache/other/${NAME_B}/couturecast-card.png`,
            `cache/share-cards/nested/${NAME_B}/couturecast-card.png`,
            'cache/share-cards/cc69-share-$(reboot)/couturecast-card.png',
            '',
          ].join('\r\n')
        if (args.includes('stat')) return '1000\n'
        if (args.includes('date')) return '1060\n'
        throw new Error('unexpected')
      },
    }
    const reads = []
    const store = androidShareFileStore(ctx, (binary, args) => {
      reads.push(args)
      return { status: 0, stdout: bytes }
    })
    assert.deepEqual(store.list(), [NAME_A])
    assert.equal(
      calls[0],
      '/owned/adb -s emulator-5584 shell run-as com.couturecast.story68 find cache -maxdepth 3 -name couturecast-card.png'
    )
    assert.ok(store.read(NAME_A).equals(bytes))
    assert.deepEqual(reads[0], [
      '-s',
      'emulator-5584',
      'exec-out',
      'run-as',
      'com.couturecast.story68',
      'cat',
      `cache/share-cards/${NAME_A}/couturecast-card.png`,
    ])
    assert.equal(store.ageMs(NAME_A), 60_000)
    assert.throws(() => store.read('../databases/x.png'), /share_handoff_file_removed/)
    const failing = androidShareFileStore(ctx, () => ({
      status: 1,
      stdout: Buffer.alloc(0),
    }))
    assert.throws(() => failing.read(NAME_A), /share_handoff_file_removed/)
  })

  test('the iOS store reads the app container cache and ignores save files', (t) => {
    const container = tempDir(t)
    const cache = path.join(container, 'Library/Caches/share-cards')
    const ctx = {
      device: 'owned-sim',
      appId: 'com.couturecast.story68',
      run: (binary, args) => {
        assert.deepEqual(
          [binary, ...args],
          [
            'xcrun',
            'simctl',
            'get_app_container',
            'owned-sim',
            'com.couturecast.story68',
            'data',
          ]
        )
        return `${container}\n`
      },
    }
    const store = iosShareFileStore(ctx)
    assert.deepEqual(store.list(), [], 'no cache yet')
    fs.mkdirSync(path.join(cache, NAME_A), { recursive: true })
    fs.writeFileSync(path.join(cache, NAME_A, 'couturecast-card.png'), bytes)
    fs.writeFileSync(path.join(cache, 'cc68-11111111.png'), bytes)
    // A directory without its card is not a handoff.
    fs.mkdirSync(path.join(cache, NAME_B))
    assert.deepEqual(store.list(), [NAME_A])
    assert.ok(store.read(NAME_A).equals(bytes))
    assert.ok(store.ageMs(NAME_A) >= -2_000 && store.ageMs(NAME_A) < 60_000)
    assert.throws(() => store.read('cc68-11111111.png'), /share_handoff_file_removed/)
  })
})

describe('native receiver and presenter tests', () => {
  test('the androidTest namespace comes from the module Gradle file, or the command fails', (t) => {
    const root = tempDir(t)
    assert.throws(() => shareModuleNamespace(root), /share_receive_namespace_required/)
    const android = path.join(root, 'apps/mobile/modules/share-card-native-share/android')
    fs.mkdirSync(android, { recursive: true })
    fs.writeFileSync(
      path.join(android, 'build.gradle'),
      'android {\n  namespace "expo.modules.sharecardnativeshare"\n}\n'
    )
    assert.equal(shareModuleNamespace(root), 'expo.modules.sharecardnativeshare')
    fs.writeFileSync(path.join(android, 'build.gradle'), 'android {}\n')
    fs.writeFileSync(
      path.join(android, 'build.gradle.kts'),
      'android {\n  namespace = "expo.modules.share"\n}\n'
    )
    assert.equal(shareModuleNamespace(root), 'expo.modules.share')
    assert.match(SHARE_RECEIVE_APK, /share-card-native-share-debug-androidTest\.apk$/)
  })

  test('instrumentation passes only when every declared test ran and nothing failed or crashed', () => {
    assert.deepEqual(assertShareReceiveInstrumentation('...\n\nOK (3 tests)\n', 3), {
      tests: 3,
    })
    assert.deepEqual(assertShareReceiveInstrumentation('OK (1 test)\n', 1), { tests: 1 })
    for (const [log, expected] of [
      // One declared test did not run: an @Ignore or a filtered method is not a pass.
      ['OK (1 test)\n', 2],
      ['OK (2 tests)\n', 3],
      // More tests than declared means the count came from somewhere else.
      ['OK (3 tests)\n', 2],
      ['OK (0 tests)\n', 0],
      ['OK (2 tests)\n', undefined],
      ['', 2],
      ['Tests run: 3,  Failures: 1\nFAILURES!!!\n', 3],
      [
        'INSTRUMENTATION_FAILED: expo.modules.x.test/androidx.test.runner.AndroidJUnitRunner\n',
        2,
      ],
      ['INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nOK (2 tests)\n', 2],
    ])
      assert.throws(
        () => assertShareReceiveInstrumentation(log, expected),
        /share_receive_android_test_failed/,
        `${log} expected ${expected}`
      )
  })

  test('the expected count is every @Test in the receive class, ignored ones included', (t) => {
    const root = tempDir(t)
    const namespace = 'expo.modules.share'
    assert.throws(
      () => shareReceiveExpectedTests(root, namespace),
      /share_receive_android_test_failed/
    )
    writeReceiveTest(root, namespace, ['@Test', '@Test'])
    assert.equal(shareReceiveExpectedTests(root, namespace), 2)
    // An @Ignore keeps the test declared, so JUnit's run count falls one short and fails.
    writeReceiveTest(root, namespace, ['@Test', '@Ignore("flaky")\n  @Test'])
    const expected = shareReceiveExpectedTests(root, namespace)
    assert.equal(expected, 2)
    assert.throws(
      () => assertShareReceiveInstrumentation('OK (1 test)\n', expected),
      /share_receive_android_test_failed/
    )
    writeReceiveTest(root, namespace, [])
    assert.throws(
      () => shareReceiveExpectedTests(root, namespace),
      /share_receive_android_test_failed/
    )
  })

  test('the real receive class declares the sibling and out-of-scope cases it must run', () => {
    const namespace = shareModuleNamespace(repo)
    const source = fs.readFileSync(
      path.join(repo, shareReceiveTestSource(namespace)),
      'utf8'
    )
    assert.equal(
      shareReceiveExpectedTests(repo, namespace),
      (source.match(/^\s*@Test\b/gm) ?? []).length
    )
    assert.ok(shareReceiveExpectedTests(repo, namespace) >= 2)
  })

  test('a generated manifest has one unexported share provider and no broad permission', () => {
    assert.deepEqual(assertShareReceiveManifest(shareManifest()), { providers: 1 })
    const resolved = shareManifest({
      provider:
        '<provider android:name="expo.modules.sharecardnativeshare.ShareCardFileProvider" android:authorities="expo.modules.sharecardnativeshare.test.sharecardnativeshare.fileprovider" android:exported="false" >',
    })
    assert.deepEqual(assertShareReceiveManifest(resolved), { providers: 1 })
    const second =
      '<provider android:name="expo.modules.sharecardnativeshare.ShareCardFileProvider" android:authorities="com.other.sharecardnativeshare.fileprovider" android:exported="false" ></provider>'
    for (const [name, xml] of [
      [
        'no provider',
        shareManifest({
          provider:
            '<provider android:name="x.Other" android:authorities="x.other" android:exported="false" >',
        }),
      ],
      [
        'exported provider',
        shareManifest({
          provider:
            '<provider android:name="expo.modules.sharecardnativeshare.ShareCardFileProvider" android:authorities="${applicationId}.sharecardnativeshare.fileprovider" android:exported="true" >',
        }),
      ],
      [
        'export unspecified',
        shareManifest({
          provider:
            '<provider android:name="expo.modules.sharecardnativeshare.ShareCardFileProvider" android:authorities="${applicationId}.sharecardnativeshare.fileprovider" >',
        }),
      ],
      ['two providers', shareManifest({ extra: second })],
      ...SHARE_FORBIDDEN_PERMISSIONS.map((permission) => [
        permission,
        shareManifest({ extra: `    <uses-permission android:name="${permission}" />` }),
      ]),
      [
        'sdk-23 storage permission',
        shareManifest({
          extra:
            '    <uses-permission-sdk-23 android:name="android.permission.READ_MEDIA_IMAGES" />',
        }),
      ],
    ])
      assert.throws(
        () => assertShareReceiveManifest(xml),
        /share_receive_manifest_invalid/,
        name
      )
    assert.deepEqual([...SHARE_FORBIDDEN_PERMISSIONS].sort(), [
      'android.permission.QUERY_ALL_PACKAGES',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ])
  })

  test('a failed instrumentation is summarized by counts only', () => {
    const summary = shareReceiveFailureSummary(
      'expo.modules.x.ShareCardShareReceiveTest:\nError in siblingDenied(content://secret/uri)\nTests run: 3,  Failures: 1\nFAILURES!!!\n'
    )
    assert.deepEqual(summary, {
      testsRun: 3,
      failures: 1,
      crashed: false,
      instrumentationFailed: false,
    })
    assert.doesNotMatch(JSON.stringify(summary), /content:|secret|sibling/)
  })

  const summary = (patch = {}) => ({
    result: 'Passed',
    totalTestCount: 2,
    passedTests: 2,
    failedTests: 0,
    skippedTests: 0,
    ...patch,
  })
  const tree = (ids, result = 'Passed') => ({
    testNodes: [
      {
        nodeType: 'Unit test bundle',
        children: ids.map((id) => ({
          nodeType: 'Test Case',
          nodeIdentifier: id,
          result,
        })),
      },
    ],
  })

  test('the XCUITest passes only when every case is a passed presenter case', () => {
    const ids = [
      'ShareCardShareSheetUITests/testPresentsFromTopController()',
      'ShareCardShareSheetUITests/testAnchorsToShareButton()',
    ]
    assert.deepEqual(assertShareSheetUITestResult(summary(), tree(ids)), { tests: 2 })
    for (const [s, tr] of [
      [summary({ result: 'Failed' }), tree(ids)],
      [summary({ totalTestCount: 0, passedTests: 0 }), tree([])],
      [summary({ skippedTests: 1 }), tree(ids)],
      [summary({ failedTests: 1, passedTests: 1 }), tree(ids)],
      [summary(), tree(ids, 'Skipped')],
      [summary(), tree([ids[0], 'ShareCardAccessibilityUITests/testOther()'])],
      [summary(), tree([ids[0]])],
      [undefined, undefined],
    ])
      assert.throws(
        () => assertShareSheetUITestResult(s, tr),
        /share_sheet_ios_uitest_failed/
      )
  })

  test('the generated xcodegen spec builds and tests only the presenter target', () => {
    const spec = shareSheetUITestProject([
      'ShareCardShareSheetUITests.swift',
      'ShareCardShareSheetSupport.swift',
    ])
    assert.match(spec, /^name: ShareCardShareSheet$/m)
    assert.match(spec, /^ {6}- ShareCardShareSheetUITests\.swift$/m)
    assert.match(spec, /^ {6}- ShareCardShareSheetSupport\.swift$/m)
    assert.match(spec, /path: share-sheet-fixture\.json\n {8}buildPhase: resources/)
    assert.match(spec, /test:\n {6}targets:\n {8}- ShareCardShareSheetUITests\n$/)
    assert.doesNotMatch(spec, /apps\/mobile\/ios/, 'never the generated native project')
  })

  const UDID = '0F0E0D0C-1111-4222-8333-944455556666'
  const containerOf = (root) =>
    path.join(root, `Devices/${UDID}/data/Containers/Data/Application/APP`)
  const anchor = {
    session: '6b1f0a52-6a0e-4b5e-9b0e-2b8c9f1d0a11',
    sequence: 2,
    presented: true,
    mainThread: true,
    sourceViewSet: true,
    sourceViewIsPresenterView: true,
    sourceRect: { x: 16, y: 700, width: 170, height: 48 },
  }

  test('the ingress opens only share modes and serves the anchor and focus records read-only', async (t) => {
    const container = containerOf(tempDir(t))
    fs.mkdirSync(path.join(container, 'Documents'), { recursive: true })
    const opened = []
    await withShareFixtureIngress(
      {
        device: UDID,
        appId: 'com.couturecast.story68',
        openUrl: (url) => opened.push(url),
        readContainer: async () => `${container}\n`,
        fixturePort: 0,
      },
      async (port) => {
        const get = (route, init) => fetch(`http://127.0.0.1:${port}${route}`, init)
        assert.equal((await get('/fixture?mode=share_failed')).status, 200)
        assert.equal((await get('/fixture?mode=real')).status, 200)
        assert.equal((await get('/fixture?mode=storage')).status, 400)
        assert.equal((await get('/fixture?mode=share_failed%26x')).status, 400)
        assert.equal((await get('/other?mode=real')).status, 400)
        // Before the first presentation the report does not exist yet.
        assert.equal((await get('/share-anchor')).status, 404)
        fs.writeFileSync(
          path.join(container, 'Documents/cc69-share-anchor.json'),
          JSON.stringify({ ...anchor, extra: '/private/path' })
        )
        const served = await get('/share-anchor')
        assert.equal(served.status, 200)
        assert.deepEqual(await served.json(), anchor)
        assert.equal((await get('/share-anchor', { method: 'POST' })).status, 405)
        fs.writeFileSync(
          path.join(container, 'Documents/cc69-share-anchor.json'),
          JSON.stringify({ ...anchor, presented: 'yes' })
        )
        assert.equal((await get('/share-anchor')).status, 503)
        // The accessibility-focus record keeps its own handler.
        assert.equal((await get('/focus-observation')).status, 503)
      }
    )
    assert.deepEqual(opened, [
      'couturecast-story68://__story68__/share-card?mode=share_failed',
      'couturecast-story68://__story68__/share-card?mode=real',
    ])
  })

  test('the ingress serves the activity item report read-only, without any path', async (t) => {
    const container = containerOf(tempDir(t))
    fs.mkdirSync(path.join(container, 'Documents'), { recursive: true })
    const report = path.join(container, 'Documents/cc69-share-item.json')
    const item = {
      id: '7c2e0b63-7b1f-4c6f-8c1f-3c9d0e2f1b22',
      itemIsFileURL: true,
      itemSha256: 'a'.repeat(64),
    }
    await withShareFixtureIngress(
      {
        device: UDID,
        appId: 'com.couturecast.story68',
        openUrl: () => undefined,
        readContainer: async () => `${container}\n`,
        fixturePort: 0,
      },
      async (port) => {
        const get = (init) => fetch(`http://127.0.0.1:${port}/share-item`, init)
        // Before the first sheet the report does not exist yet.
        assert.equal((await get()).status, 404)
        fs.writeFileSync(
          report,
          JSON.stringify({ ...item, path: '/private/cache/x.png' })
        )
        const served = await get()
        assert.equal(served.status, 200)
        assert.equal(served.headers.get('cache-control'), 'no-store')
        assert.deepEqual(await served.json(), item)
        fs.writeFileSync(
          report,
          JSON.stringify({ ...item, itemIsFileURL: false, itemSha256: null })
        )
        assert.deepEqual(await (await get()).json(), {
          ...item,
          itemIsFileURL: false,
          itemSha256: null,
        })
        assert.equal((await get({ method: 'POST' })).status, 405)
        for (const invalid of [
          { ...item, itemSha256: 'A'.repeat(64) },
          { ...item, itemSha256: '/private/cache/x.png' },
          { ...item, itemIsFileURL: 'yes' },
          { ...item, id: 'x' },
        ]) {
          fs.writeFileSync(report, JSON.stringify(invalid))
          assert.equal((await get()).status, 503, JSON.stringify(invalid))
        }
        fs.writeFileSync(report, '{')
        assert.equal((await get()).status, 503)
      }
    )
    const foreign = path.join(
      tempDir(t),
      'Devices/OTHER/data/Containers/Data/Application/APP'
    )
    fs.mkdirSync(path.join(foreign, 'Documents'), { recursive: true })
    fs.writeFileSync(
      path.join(foreign, 'Documents/cc69-share-item.json'),
      JSON.stringify(item)
    )
    await withShareFixtureIngress(
      {
        device: UDID,
        appId: 'com.couturecast.story68',
        openUrl: () => undefined,
        readContainer: () => foreign,
        fixturePort: 0,
      },
      async (port) =>
        assert.equal((await fetch(`http://127.0.0.1:${port}/share-item`)).status, 503)
    )
    for (const owner of [
      { device: 'x', appId: 'com.couturecast.story68' },
      { device: UDID, appId: 'com.couturecast.app' },
    ])
      assert.throws(
        () => shareItemHandler({ ...owner, readContainer: () => foreign }),
        /owned_ios_share_anchor_required/
      )
  })

  test('the anchor route refuses a container outside the owned simulator', async (t) => {
    const foreign = path.join(
      tempDir(t),
      'Devices/OTHER/data/Containers/Data/Application/APP'
    )
    fs.mkdirSync(path.join(foreign, 'Documents'), { recursive: true })
    fs.writeFileSync(
      path.join(foreign, 'Documents/cc69-share-anchor.json'),
      JSON.stringify(anchor)
    )
    await withShareFixtureIngress(
      {
        device: UDID,
        appId: 'com.couturecast.story68',
        openUrl: () => undefined,
        readContainer: () => foreign,
        fixturePort: 0,
      },
      async (port) =>
        assert.equal((await fetch(`http://127.0.0.1:${port}/share-anchor`)).status, 503)
    )
    assert.throws(
      () =>
        shareAnchorHandler({
          device: 'x',
          appId: 'com.couturecast.story68',
          readContainer,
        }),
      /owned_ios_share_anchor_required/
    )
    function readContainer() {
      return foreign
    }
  })
})

describe('runStory69ShareSheet', () => {
  /** A fake owned device: every flow passes and each share attempt writes the previewed bytes. */
  function fakeDevice(
    t,
    platform,
    {
      breakAt,
      markers = `${SHARE_SHEET_UITEST_MARKERS.join('\n')}\n`,
      receiveTests = ['@Test', '@Test'],
      instrumentLog = 'OK (2 tests)\n',
      manifest = shareManifest(),
    } = {}
  ) {
    const root = tempDir(t)
    const directory = path.join(root, 'runtime')
    fs.mkdirSync(directory)
    const android = path.join(root, 'apps/mobile/modules/share-card-native-share/android')
    fs.mkdirSync(android, { recursive: true })
    fs.writeFileSync(
      path.join(android, 'build.gradle'),
      'namespace "expo.modules.share"\n'
    )
    writeReceiveTest(root, 'expo.modules.share', receiveTests)
    if (manifest !== null) writeShareManifests(root, manifest)
    const tests = path.join(root, 'apps/mobile/native-tests')
    fs.mkdirSync(tests, { recursive: true })
    fs.writeFileSync(path.join(tests, 'ShareCardShareSheetUITests.swift'), '// test\n')
    const bytes = png('previewed card')
    const digest = sha(bytes)
    const files = {}
    const events = []
    const reports = []
    let counter = 0
    const ctx = {
      root,
      directory,
      platform,
      device: '0F0E0D0C-1111-4222-8333-944455556666',
      readContainer: () => '/no/requests/in/this/fake',
      appId: 'com.couturecast.story68',
      adb: '/owned/adb',
      catalog,
      fixturePort: 0,
      store: memoryStore(files),
      privateJson: (name, value) => reports.push([name, structuredClone(value)]),
      read: () => ({}),
      openUrl: (url) => events.push(`open ${url.split('mode=')[1] ?? 'dev-client'}`),
      composerLayout: () => ({ digest, share: { offset: 108, height: 49 } }),
      captureApproved: () => events.push('capture'),
      extract: () => events.push('extract'),
      maestro: (flow, env) => {
        events.push(`flow ${flow}`)
        if (flow === breakAt) throw new Error(`native_flow_failed:${flow}`)
        if (/share-(sheet|chosen)\.yaml$/.test(flow)) {
          assert.equal(
            env.MAESTRO_SHARE_CLOSED,
            shareCopyEnv(catalog).MAESTRO_SHARE_CLOSED
          )
          files[`cc69-share-${String(++counter).padStart(8, '0')}-aaaa`] = bytes
        }
      },
      run: (binary, args) => {
        events.push(`run ${path.basename(binary)} ${args[0]}`)
        if (binary === 'xcrun' && args.includes('summary'))
          return JSON.stringify({
            result: 'Passed',
            totalTestCount: 1,
            passedTests: 1,
            failedTests: 0,
            skippedTests: 0,
          })
        if (binary === 'xcrun' && args.includes('tests'))
          return JSON.stringify({
            testNodes: [
              {
                nodeType: 'Test Case',
                nodeIdentifier: 'ShareCardShareSheetUITests/testSheet()',
                result: 'Passed',
              },
            ],
          })
        return ''
      },
      spawnSync: (binary, args, options) => {
        events.push(
          `spawn ${path.basename(binary)} ${args.includes('instrument') ? 'instrument' : args[0]}`
        )
        if (args.includes('instrument')) fs.writeSync(options.stdio[1], instrumentLog)
        return { status: 0 }
      },
      spawn: (binary, args, options) => {
        events.push(`spawn ${binary} ${args[0]}`)
        fs.writeSync(options.stdio[1], markers)
        const child = new EventEmitter()
        child.pid = 0
        setImmediate(() => child.emit('close', 0))
        return child
      },
    }
    return { ctx, events, reports, files, digest }
  }

  for (const platform of ['ios', 'android']) {
    test(`${platform}: runs exactly the planned flows, proves every case and publishes closed fields`, async (t) => {
      const { ctx, events, reports } = fakeDevice(t, platform)
      const logs = []
      t.mock.method(console, 'log', (line) => logs.push(line))
      await runStory69ShareSheet(ctx)
      const flows = events.filter((e) => e.startsWith('flow ')).map((e) => e.slice(5))
      assert.deepEqual(flows, shareSheetFlowRuns(platform))
      const modes = events
        .filter((e) => e.startsWith('open ') && e !== 'open dev-client')
        .map((e) => e.slice(5))
      // Every step sets its own mode first; the run starts and ends on real.
      for (const step of SHARE_SHEET_STEPS[platform]) assert.ok(modes.includes(step.mode))
      assert.equal(modes[0], 'real')
      assert.equal(modes.at(-1), 'real')
      const saves = SHARE_SHEET_STEPS[platform].filter((step) => step.save).length
      assert.equal(events.filter((e) => e === 'extract').length, saves)
      assert.equal(events.filter((e) => e === 'capture').length, saves)
      const [name, report] = reports.at(-1)
      assert.equal(name, `native-share-sheet-${platform}.json`)
      assert.deepEqual(report, {
        platform,
        passed: true,
        cases: [
          ...SHARE_SHEET_STEPS[platform].map((step) => step.id),
          SHARE_SHEET_NATIVE_CASE[platform],
        ],
      })
      assert.deepEqual(logs, [JSON.stringify({ shareSheet: report })])
      if (platform === 'android') {
        assert.ok(events.includes('run gradlew -p'))
        assert.ok(events.includes('spawn adb instrument'))
      } else {
        assert.ok(events.includes('run xcodegen generate'))
        assert.ok(events.includes('spawn xcodebuild build-for-testing'))
        assert.ok(events.includes('spawn xcodebuild test-without-building'))
        const spec = fs.readFileSync(
          path.join(ctx.directory, 'share-sheet-project/project.yml'),
          'utf8'
        )
        assert.match(spec, /- ShareCardShareSheetUITests\.swift/)
        const fixture = JSON.parse(
          fs.readFileSync(
            path.join(ctx.directory, 'share-sheet-project/share-sheet-fixture.json'),
            'utf8'
          )
        )
        assert.equal(fixture.shareClosed, catalog.shareCard.shareClosed)
      }
    })
  }

  test('android: the chosen file must survive Save and the relaunch, unchanged and leased', async (t) => {
    const { ctx, files } = fakeDevice(t, 'android')
    t.mock.method(console, 'log', () => undefined)
    const extract = ctx.extract
    ctx.extract = () => {
      extract()
      for (const name of Object.keys(files)) delete files[name]
    }
    await assert.rejects(runStory69ShareSheet(ctx), /share_handoff_file_removed/)
  })

  test('ios: the XCUITest must print the item, public name, anchor, closed and failed-focus markers', () => {
    assert.deepEqual(SHARE_SHEET_UITEST_MARKERS, [
      'CC69_PRESENTER_ITEM_PASS',
      'CC69_PRESENTER_PUBLIC_NAME_PASS',
      'CC69_PRESENTER_ANCHOR_PASS',
      'CC69_PRESENTER_CLOSED_PASS',
      'CC69_PRESENTER_FAILED_FOCUS_PASS',
    ])
    const source = fs.readFileSync(
      path.join(repo, 'apps/mobile/native-tests/ShareCardShareSheetUITests.swift'),
      'utf8'
    )
    for (const marker of SHARE_SHEET_UITEST_MARKERS)
      assert.ok(source.includes(`print("${marker}")`), marker)
  })

  for (const missing of SHARE_SHEET_UITEST_MARKERS)
    test(`ios: an XCUITest run without ${missing} fails even when xcodebuild passed`, async (t) => {
      const { ctx, reports } = fakeDevice(t, 'ios', {
        markers: `${SHARE_SHEET_UITEST_MARKERS.filter((marker) => marker !== missing).join('\n')}\n`,
      })
      t.mock.method(console, 'log', () => undefined)
      await assert.rejects(runStory69ShareSheet(ctx), /share_sheet_ios_uitest_failed/)
      assert.equal(reports.at(-1)[1].code, 'share_sheet_ios_uitest_failed')
      assert.equal(reports.at(-1)[1].cases.includes('N-IOS-PRESENTER-UI'), false)
    })

  test('android: an instrumentation run that skipped a declared receive test fails', async (t) => {
    const { ctx, reports } = fakeDevice(t, 'android', {
      receiveTests: ['@Test', '@Ignore\n  @Test'],
      instrumentLog: 'OK (1 test)\n',
    })
    t.mock.method(console, 'log', () => undefined)
    await assert.rejects(runStory69ShareSheet(ctx), /share_receive_android_test_failed/)
    assert.equal(reports.at(-1)[1].code, 'share_receive_android_test_failed')
    assert.equal(reports.at(-1)[1].cases.includes('N-AND-RECEIVE'), false)
  })

  for (const [name, manifest] of [
    ['is missing', null],
    [
      'exports the provider',
      shareManifest({
        provider:
          '<provider android:name="expo.modules.sharecardnativeshare.ShareCardFileProvider" android:authorities="${applicationId}.sharecardnativeshare.fileprovider" android:exported="true" >',
      }),
    ],
    [
      'asks for QUERY_ALL_PACKAGES',
      shareManifest({
        extra: '<uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />',
      }),
    ],
  ])
    test(`android: a generated manifest that ${name} fails before the test APK is installed`, async (t) => {
      const { ctx, events, reports } = fakeDevice(t, 'android', { manifest })
      t.mock.method(console, 'log', () => undefined)
      await assert.rejects(runStory69ShareSheet(ctx), /share_receive_manifest_invalid/)
      const afterBuild = events.slice(events.indexOf('run gradlew -p') + 1)
      assert.ok(events.includes('run gradlew -p'))
      // Neither the install nor the instrumentation runs after a bad manifest.
      assert.deepEqual(afterBuild, [])
      assert.equal(reports.at(-1)[1].code, 'share_receive_manifest_invalid')
    })

  test('a changed preview digest fails the step as a composition change', async (t) => {
    const { ctx } = fakeDevice(t, 'ios')
    t.mock.method(console, 'log', () => undefined)
    let reads = 0
    ctx.composerLayout = () => ({
      digest: ++reads === 2 ? 'b'.repeat(64) : 'a'.repeat(64),
      share: { offset: 108, height: 49 },
    })
    await assert.rejects(runStory69ShareSheet(ctx), /share_composition_changed/)
  })

  test('feedback copy that moves Share fails the step as a moved action', async (t) => {
    const { ctx, reports, digest } = fakeDevice(t, 'android')
    t.mock.method(console, 'log', () => undefined)
    let reads = 0
    // The resting slot held one line and the two-line failure copy pushed Share down a line.
    ctx.composerLayout = () => ({
      digest,
      share: { offset: ++reads === 2 ? 166 : 108, height: 136 },
    })
    await assert.rejects(runStory69ShareSheet(ctx), /share_action_moved/)
    assert.equal(reports.at(-1)[1].code, 'share_action_moved')
    assert.deepEqual(reports.at(-1)[1].cases, [])
  })

  test('a failed flow publishes only a closed code and the passed cases, never paths or digests', async (t) => {
    const { ctx, reports, digest } = fakeDevice(t, 'android', {
      breakAt: 'maestro/story68/share-chosen.yaml',
    })
    const logs = []
    t.mock.method(console, 'log', (line) => logs.push(line))
    await assert.rejects(runStory69ShareSheet(ctx), /native_flow_failed/)
    const [, report] = reports.at(-1)
    assert.deepEqual(report, {
      platform: 'android',
      passed: false,
      cases: [
        'M-SHARE-FAILED',
        'M-SHARE-UNAVAILABLE',
        'M-SHARE-CLOSED',
        'M-SHARE-OTHER',
        'M-SHARE-NOT-CONFIRMED',
      ],
      code: 'native_flow_failed',
    })
    const published = JSON.stringify([logs, reports])
    assert.doesNotMatch(published, new RegExp(digest))
    assert.doesNotMatch(published, /cc69-share-|share-chosen|\/owned|runtime/)
  })

  test('a missing share catalog key fails before the device is touched', async (t) => {
    const { ctx, events, reports } = fakeDevice(t, 'ios')
    t.mock.method(console, 'log', () => undefined)
    ctx.catalog = { shareCard: {} }
    await assert.rejects(runStory69ShareSheet(ctx), /share_copy_missing/)
    assert.deepEqual(events, [])
    assert.equal(reports.at(-1)[1].code, 'share_copy_missing')
  })

  test('failures map to closed codes', () => {
    assert.equal(
      closedShareSheetFailure(
        new Error('native_flow_failed:maestro/story68/share-sheet.yaml')
      ),
      'native_flow_failed'
    )
    assert.equal(
      closedShareSheetFailure(new Error('share_handoff_digest_mismatch')),
      'share_handoff_digest_mismatch'
    )
    assert.equal(
      closedShareSheetFailure(
        new Error('owned_command_failed:adb:1:/data/user/0/secret')
      ),
      'share_sheet_failed'
    )
    assert.equal(closedShareSheetFailure('text'), 'share_sheet_failed')
  })
})

describe('runner wiring', () => {
  const source = fs.readFileSync(
    path.join(repo, 'scripts/run-story68-native.mjs'),
    'utf8'
  )

  test('share-sheet is a disk-checked runner command that hands the owned helpers to the module', () => {
    const disk = source.slice(0, source.indexOf('assertStory68DiskSpace(root)'))
    assert.match(disk, /'share-sheet',\n\s*\]\.includes\(command\)/)
    const start = source.indexOf("} else if (command === 'share-sheet') {")
    const end = source.indexOf('} else if (command ===', start + 1)
    assert.ok(start > 0 && end > start)
    const branch = source.slice(start, end)
    assert.match(branch, /requireDevice\(\)/)
    assert.match(branch, /activeLocale = 'en-US'/)
    assert.match(branch, /await runStory69ShareSheet\(\{/)
    for (const key of [
      'root',
      'directory',
      'device',
      'platform',
      'appId',
      'adb',
      'maestro',
      'run',
      'read',
      'privateJson',
      'openUrl',
      'composerLayout',
      'captureApproved',
    ])
      assert.match(branch, new RegExp(`\\n\\s+${key},\\n`), key)
    assert.match(branch, /catalog: readLocale\(\)/)
    assert.match(branch, /'extract',\n\s+'--harness',/)
  })

  test('the fixture command accepts every share mode', () => {
    const start = source.indexOf("} else if (command === 'fixture') {")
    const branch = source.slice(
      start,
      source.indexOf('} else if (command ===', start + 1)
    )
    assert.match(branch, /\.\.\.SHARE_FIXTURE_MODES,/)
    assert.match(
      source,
      /import \{\n\s+SHARE_FIXTURE_MODES,\n\s+readComposerLayout,\n\s+runStory69ShareSheet,\n\} from/
    )
  })
})
