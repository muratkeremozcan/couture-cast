import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  IOS_RETRYABLE_DENIAL_EVIDENCE,
  IOS_SETTINGS_MARKERS,
  assertNativeEvidence,
  nativeEvidenceFamilies,
} from './story68-native-evidence-schema.mjs'
import {
  closedShareCardAuditReport,
  shareCardAuditTestIDs,
} from './share-card-audit-report.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const audit = closedShareCardAuditReport(
  { result: 'Passed', totalTestCount: 9, passedTests: 9 },
  {
    testNodes: shareCardAuditTestIDs.map((id) => ({
      nodeType: 'Test Case',
      nodeIdentifier: id,
      result: 'Passed',
    })),
  },
  'CC68_STATE_PASS en-US open on\nCC68_STATE_PASS en-US preparing none\nCC68_AUDIT_CLOSED open|1|false|Potentially inaccessible text\nCC68_NATIVE_BEHAVIOR_PASS owned-saving\n'
)
const valid = () => ({
  'native-matrix-android.json': {
    platform: 'android',
    cases: [
      { id: 'M-CANCEL:preparation-before-commit', passed: true },
      { id: 'M-STORAGE:cache_failure:retry-recovers', passed: true },
      { id: 'M-SINGLE-WRITE M-IDENTITY:close', passed: true },
    ],
    completed: true,
  },
  'native-matrix-ios.json': {
    platform: 'ios',
    cases: [{ id: 'U-PERMISSION-LIMITED:native-adapter-integration', passed: true }],
    completed: false,
  },
  'accessibility-android.json': {
    platform: 'android',
    service: 'TalkBack',
    actualService: true,
    openTitleFocus: true,
    saveFocusContained: true,
    cancelOpenerFocus: true,
    ownedSavingFocus: true,
    reopenedFinishingFocus: true,
    watermarkReenabled: true,
    existingHeaderLabels: true,
    traversalLabelsTraits: true,
  },
  'accessibility-ios.json': structuredClone(audit),
  'accessibility-bridge.json': {
    method:
      'React Native posted accessibility announcement and intended focus bridge unit assertions',
    passed: true,
    cases: [
      { locale: 'en-US', state: 'saved', passed: true },
      { locale: 'tr-TR', state: 'preparing', passed: true },
    ],
    runner: {
      classification: 'passed',
      exitCode: 0,
      reportPresent: true,
      reportSuccessful: true,
      assertionsObserved: 120,
      assertionsFailed: 0,
      matchedCases: 90,
      requiredCases: 90,
    },
  },
  'expo-go-unavailable.json': {
    platform: 'ios',
    actualExpoGo: true,
    nativeAdapterAbsent: true,
    previewLoaded: true,
    saveDisabled: true,
    actualAssetCountUnchanged: true,
  },
  'permission-ios.json': {
    platform: 'ios',
    actualAddOnlyDenial: true,
    readPermissionBeforeSave: { read: 0, addOnly: 2 },
    canAskAgain: false,
    actualSettingsOpened: true,
    settingsEvidence: { foregroundMarkers: [...IOS_SETTINGS_MARKERS] },
    settingsGrantReturnedWithoutImport: true,
    retryableDenialEvidence: IOS_RETRYABLE_DENIAL_EVIDENCE,
    readPermissionAfterSave: { read: 0, addOnly: 2 },
    readRemainedDenied: true,
    addOnlyGranted: true,
  },
})
const rejects = (name, value) =>
  assert.throws(() => assertNativeEvidence(name, value), {
    message: 'invalid_native_evidence',
  })

describe('closed native evidence schemas', () => {
  test('every published family has a valid example and nothing else is accepted', () => {
    assert.deepEqual(Object.keys(valid()).sort(), [...nativeEvidenceFamilies].sort())
    for (const [name, value] of Object.entries(valid()))
      assert.equal(assertNativeEvidence(name, value), value)
    assert.throws(() => assertNativeEvidence('native-matrix-web.json', {}), {
      message: 'unknown_native_evidence_family',
    })
  })

  for (const name of nativeEvidenceFamilies) {
    test(`${name} rejects an extra, a missing or a retyped top-level key`, () => {
      for (const value of [null, [], 'text']) rejects(name, value)
      rejects(name, { ...valid()[name], privateLog: 'raw' })
      for (const key of Object.keys(valid()[name])) {
        const missing = valid()[name]
        delete missing[key]
        if (!(name === 'permission-ios.json' && key.endsWith('AfterSave'))) {
          if (
            !(
              name === 'permission-ios.json' &&
              ['readRemainedDenied', 'addOnlyGranted'].includes(key)
            )
          )
            rejects(name, missing)
        }
        rejects(name, { ...valid()[name], [key]: { nested: 'replacement' } })
      }
    })
  }

  test('nested objects and lists are closed too', () => {
    const matrix = valid()['native-matrix-android.json']
    rejects('native-matrix-android.json', { ...matrix, platform: 'ios' })
    rejects('native-matrix-android.json', {
      ...matrix,
      cases: [{ id: 'M-SAVE', passed: false }],
    })
    rejects('native-matrix-android.json', {
      ...matrix,
      cases: [{ id: 'M-SAVE', passed: true, log: 'raw' }],
    })
    rejects('native-matrix-android.json', {
      ...matrix,
      cases: [{ id: 'story65-real-1@example.test', passed: true }],
    })
    const ios = valid()['accessibility-ios.json']
    rejects('accessibility-ios.json', {
      ...ios,
      states: [{ ...ios.states[0], label: 'private' }],
    })
    rejects('accessibility-ios.json', {
      ...ios,
      strictIssues: [{ ...ios.strictIssues[0], compact: 'raw issue text' }],
    })
    rejects('accessibility-ios.json', { ...ios, missingTests: ['OtherTests/test()'] })
    rejects('accessibility-ios.json', { ...ios, focusEvidence: 'edited' })
    const bridge = valid()['accessibility-bridge.json']
    rejects('accessibility-bridge.json', {
      ...bridge,
      runner: { ...bridge.runner, log: 'raw' },
    })
    rejects('accessibility-bridge.json', {
      ...bridge,
      cases: [{ locale: 'xx-XX', state: 'saved', passed: true }],
    })
    rejects('accessibility-android.json', {
      ...valid()['accessibility-android.json'],
      saveFocusContained: false,
    })
  })

  test('iOS permission evidence needs every Settings marker and the whole after-save trio', () => {
    const permission = valid()['permission-ios.json']
    const { readPermissionAfterSave, readRemainedDenied, addOnlyGranted, ...beforeSave } =
      permission
    assert.ok(readPermissionAfterSave && readRemainedDenied && addOnlyGranted)
    assert.equal(assertNativeEvidence('permission-ios.json', beforeSave), beforeSave)
    rejects('permission-ios.json', { ...beforeSave, addOnlyGranted: true })
    for (const markers of [
      [],
      [IOS_SETTINGS_MARKERS[0]],
      [IOS_SETTINGS_MARKERS[0], IOS_SETTINGS_MARKERS[0]],
      [...IOS_SETTINGS_MARKERS, 'Settings'],
    ])
      rejects('permission-ios.json', {
        ...permission,
        settingsEvidence: { foregroundMarkers: markers },
      })
    rejects('permission-ios.json', { ...permission, actualSettingsOpened: false })
    rejects('permission-ios.json', {
      ...permission,
      readPermissionBeforeSave: { read: 'denied', addOnly: 2 },
    })
  })
})

describe('public evidence publisher', () => {
  const publish = (files) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-native-evidence-'))
    try {
      for (const [name, value] of Object.entries(files))
        fs.writeFileSync(path.join(directory, name), JSON.stringify(value))
      const result = spawnSync(
        process.execPath,
        [path.join(root, 'scripts/e2e-share-card/public-evidence.mjs')],
        {
          cwd: root,
          env: { ...process.env, CC68_HARNESS_DIR: directory },
          encoding: 'utf8',
        }
      )
      const output = path.join(directory, 'public-evidence')
      return {
        status: result.status,
        stderr: result.stderr,
        published: fs.existsSync(output) ? fs.readdirSync(output).sort() : [],
      }
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  }

  test('publishes every valid family', () => {
    const result = publish(valid())
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.published, [...nativeEvidenceFamilies].sort())
  })

  for (const platform of ['android', 'ios']) {
    for (const suffix of ['367fea4a-e1da-456e-a355-1bcc7f9da4f3', 'Private-Person']) {
      test(`${platform} publishes nothing for an identifier or name suffix: ${suffix}`, () => {
        const name = `native-matrix-${platform}.json`
        const result = publish({
          ...valid(),
          [name]: {
            ...valid()[name],
            cases: [{ id: `M-LOCALE:${suffix}`, passed: true }],
          },
        })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /invalid_native_evidence/)
        assert.deepEqual(result.published, [])
      })
    }
  }

  test('publishes nothing when any family breaks its schema', () => {
    const result = publish({
      ...valid(),
      'accessibility-android.json': {
        ...valid()['accessibility-android.json'],
        rawHierarchy: 'private',
      },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /invalid_native_evidence/)
    assert.deepEqual(result.published, [])
  })
})

// On a real landing screen of app-settings: (iOS 26.1 probe, 2026-10-29) the Settings status bar
// carries id `breadcrumb` whose text ends with the app name (the arrow form or `Return to`, which
// differs with how the accessibility session started) on every screen opened
// from this app. The General row (com.apple.settings.general) is on the Settings root only; the
// first iOS 18.5 CI run waited 15.66 s for it and failed, so it cannot be a marker.
test('the iOS Settings markers are the breadcrumb pair, which every Settings screen opened from this app shows', () => {
  assert.deepEqual([...IOS_SETTINGS_MARKERS], ['breadcrumb', 'CoutureCast Story68'])
  assert.equal(
    IOS_SETTINGS_MARKERS.some((marker) => marker.startsWith('com.apple.settings.')),
    false
  )
})

// Maestro scopes a flow to its appId. Probed on iOS 26.1 (2026-10-29) with the Settings app in
// front: a flow with appId = the app under test does not see the breadcrumb (extendedWaitUntil
// FAILED), a flow with appId com.apple.Preferences does, and a parent flow can run such a flow.
// Both CI waits (the General row, then the breadcrumb) sat under the app's appId and could never
// succeed, whatever Settings showed.
test('settings.yaml waits for the breadcrumb in a subflow scoped to the Settings app', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (name) =>
    readFileSync(new URL(`../../maestro/story68/${name}`, import.meta.url), 'utf8')
  const flow = read('settings.yaml')
  const ios = flow.slice(flow.indexOf('platform: iOS'), flow.indexOf('platform: Android'))
  assert.match(ios, /file: wait-os-settings-ios\.yaml/)
  assert.doesNotMatch(flow, /breadcrumb|com\.apple\.settings\./)
  assert.match(flow, /assertNotVisible:\s+id: share-card-title/)
  const sub = read('wait-os-settings-ios.yaml')
  assert.match(sub, /^appId: com\.apple\.Preferences\n---/)
  assert.match(
    sub,
    /extendedWaitUntil:\s+visible:\s+id: breadcrumb\s+text: ".\*CoutureCast Story68"\s+timeout: 15000/
  )
})

test('the breadcrumb check accepts both label forms the status bar shows and rejects other apps', async () => {
  const { breadcrumbIn } = await import('./story68-native-evidence-schema.mjs')
  const tree = (text) => ({
    attributes: {},
    children: [
      {
        attributes: { 'resource-id': 'breadcrumb', accessibilityText: text },
        children: [],
      },
    ],
  })
  assert.equal(breadcrumbIn(tree('\u200e\u25c0\ufe0e CoutureCast Story68')), true)
  assert.equal(breadcrumbIn(tree('Return to CoutureCast Story68')), true)
  assert.equal(breadcrumbIn(tree('Return to Other App')), false)
  assert.equal(
    breadcrumbIn({ attributes: { 'resource-id': 'other', text: 'CoutureCast Story68' } }),
    false
  )
  assert.equal(breadcrumbIn(null), false)
})
