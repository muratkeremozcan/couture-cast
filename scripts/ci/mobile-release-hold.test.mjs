// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S2-08 and S3-02 (D12, R2-06, R3-02): deploy-mobile refuses a production build from SDK 56
// until a committed measurement artifact on the current SDK clears the hold.
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { evaluateReleaseHold, readReleaseHold } from './mobile-release-hold.mjs'

/** A repository where the candidate is SDK 57, the control SDK 55, and HEAD adds only evidence. */
function fakeGit(overrides = {}) {
  const trees = {
    ['a'.repeat(40)]: { expo: '~57.0.33', lock: '57.0.33' },
    ['d'.repeat(40)]: { expo: '~55.0.32', lock: '55.0.32' },
  }
  return {
    tracked: () => true,
    commitExists: (commit) => commit in trees,
    show: (revision, file) => {
      const tree = trees[revision]
      if (!tree) return null
      return file === 'apps/mobile/package.json'
        ? JSON.stringify({ dependencies: { expo: tree.expo } })
        : JSON.stringify({ packages: { 'node_modules/expo': { version: tree.lock } } })
    },
    isAncestorOfHead: () => true,
    changedSince: () => ['apps/mobile/release-hold.json', EVIDENCE],
    ...overrides,
  }
}

const EVIDENCE = '_bmad-output/implementation-artifacts/story-6-15/memory/sdk-57.json'
const hold = (...lifts) => ({
  heldFrom: 56,
  reason: 'Hermes V1 memory regression with Worklets and Reanimated',
  lifts,
})
const measured = (peakMb, settledMb) => ({ peakMb, settledMb })
function artifact(overrides = {}) {
  return {
    sdk: 57,
    expoVersion: '57.0.33',
    measuredAt: '2026-11-25T15:00:00Z',
    build: { commit: 'a'.repeat(40), android: 'b'.repeat(64), ios: 'c'.repeat(64) },
    control: { sdk: 55, expoVersion: '55.0.32', commit: 'd'.repeat(40) },
    android: { control: measured(300, 240), candidate: measured(309, 244) },
    ios: { control: measured(280, 210), candidate: measured(290, 214) },
    ...overrides,
  }
}
const sdk56 = { expoRange: '~56.0.24', expoVersion: '56.0.24' }
const sdk57 = { expoRange: '~57.0.33', expoVersion: '57.0.33' }
const verdict = (lifted, context = sdk57, git = fakeGit()) =>
  evaluateReleaseHold({
    hold: hold(EVIDENCE),
    ...context,
    git,
    readArtifact: (relative) => (relative === EVIDENCE ? lifted : null),
  })

describe('evaluateReleaseHold', () => {
  test('before SDK 56 no hold is needed', () => {
    assert.equal(
      evaluateReleaseHold({ hold: null, expoRange: '~54.0.36', expoVersion: '54.0.36' })
        .allowed,
      true
    )
  })

  test('from SDK 56 a missing hold file refuses, so deleting it releases nothing', () => {
    const result = evaluateReleaseHold({ hold: null, ...sdk57, readArtifact: () => null })
    assert.equal(result.allowed, false)
    assert.match(result.reason, /it was removed/)
  })

  test('SDK 56 with no lift is held', () => {
    assert.equal(
      evaluateReleaseHold({ hold: hold(), ...sdk56, readArtifact: () => null }).allowed,
      false
    )
  })

  test('a measurement on the current SDK within 10% on both platforms releases', () => {
    assert.equal(verdict(artifact()).allowed, true)
    const sdk56Git = fakeGit({
      show: (revision, file) => {
        const control = revision === 'd'.repeat(40)
        return file === 'apps/mobile/package.json'
          ? JSON.stringify({ dependencies: { expo: control ? '~55.0.32' : '~56.0.24' } })
          : JSON.stringify({
              packages: {
                'node_modules/expo': { version: control ? '55.0.32' : '56.0.24' },
              },
            })
      },
    })
    assert.equal(
      verdict(artifact({ sdk: 56, expoVersion: '56.0.24' }), sdk56, sdk56Git).allowed,
      true
    )
  })

  test('over the threshold on either platform keeps the hold', () => {
    const result = verdict(
      artifact({ ios: { control: measured(280, 210), candidate: measured(330, 214) } })
    )
    assert.equal(result.allowed, false)
    assert.match(result.reason, /ios memory ratios 1.179/)
  })

  // R3-02 refusals: each one released the build before.
  for (const [name, overrides, reason] of [
    [
      'null measurements',
      { android: { control: measured(300, 240), candidate: measured(null, null) } },
      /finite positive/,
    ],
    [
      'zero measurements',
      { android: { control: measured(0, 240), candidate: measured(309, 244) } },
      /finite positive/,
    ],
    [
      'negative measurements',
      { android: { control: measured(300, 240), candidate: measured(-1, -1) } },
      /finite positive/,
    ],
    [
      'non-finite measurements',
      { ios: { control: measured(280, 210), candidate: measured(Infinity, 214) } },
      /finite positive/,
    ],
    ['a measurement on another SDK', { sdk: 56 }, /measured on SDK 56/],
    [
      'a measurement on another expo version',
      { expoVersion: '57.0.9' },
      /measured on expo 57.0.9/,
    ],
    [
      'a control that is not Step 1',
      { control: { sdk: 56, expoVersion: '56.0.24', commit: 'd'.repeat(40) } },
      /Step 1 SDK 55/,
    ],
    [
      'an unidentified build',
      { build: { commit: 'a'.repeat(40), android: 'pending', ios: 'c'.repeat(64) } },
      /SHA-256/,
    ],
    ['a missing measurement date', { measuredAt: 'soon' }, /measurement date/],
  ])
    test(`refuses ${name}`, () => {
      const result = verdict(artifact(overrides))
      assert.equal(result.allowed, false)
      assert.match(result.reason, reason)
    })

  test('refuses a lift whose evidence artifact does not exist or is not a path', () => {
    assert.match(verdict(null).reason, /evidence artifact missing or unreadable/)
    const objectLift = evaluateReleaseHold({
      hold: hold({ path: EVIDENCE }),
      ...sdk57,
      git: fakeGit(),
      readArtifact: () => artifact(),
    })
    assert.equal(objectLift.allowed, false)
    assert.match(objectLift.reason, /must name its evidence artifact/)
  })

  // R4-02: the evidence is bound to the repository, the measured build and the Step 1 control.
  for (const [name, git, overrides, reason] of [
    [
      'an untracked or locally changed artifact',
      fakeGit({ tracked: () => false }),
      {},
      /not committed/,
    ],
    [
      'a candidate commit that does not exist',
      fakeGit(),
      { build: { commit: 'e'.repeat(40), android: 'b'.repeat(64), ios: 'c'.repeat(64) } },
      /does not exist/,
    ],
    [
      'a control commit that does not exist',
      fakeGit(),
      { control: { sdk: 55, expoVersion: '55.0.32', commit: 'f'.repeat(40) } },
      /does not exist/,
    ],
    [
      'the candidate as its own control',
      fakeGit(),
      { control: { sdk: 55, expoVersion: '55.0.32', commit: 'a'.repeat(40) } },
      /same commit/,
    ],
    [
      'a control whose expo does not match its commit',
      fakeGit(),
      { control: { sdk: 55, expoVersion: '57.0.33', commit: 'd'.repeat(40) } },
      /is not SDK 55 with expo 57.0.33/,
    ],
    [
      'a candidate commit on another SDK',
      fakeGit({
        show: (revision, file) =>
          file === 'apps/mobile/package.json'
            ? JSON.stringify({
                dependencies: {
                  expo: revision === 'd'.repeat(40) ? '~55.0.32' : '~56.0.24',
                },
              })
            : JSON.stringify({
                packages: {
                  'node_modules/expo': {
                    version: revision === 'd'.repeat(40) ? '55.0.32' : '56.0.24',
                  },
                },
              }),
      }),
      {},
      /candidate commit .* is not SDK 57/,
    ],
    [
      'a candidate outside this history',
      fakeGit({ isAncestorOfHead: () => false }),
      {},
      /not in this history/,
    ],
    [
      'a release that changed the app after the measurement',
      fakeGit({ changedSince: () => [EVIDENCE, 'apps/mobile/app/_layout.tsx'] }),
      {},
      /beyond evidence/,
    ],
  ])
    test(`refuses ${name}`, () => {
      const result = verdict(artifact(overrides), sdk57, git)
      assert.equal(result.allowed, false)
      assert.match(result.reason, reason)
    })

  test('SDK 57 before the fixed patch stays held even with a passing measurement', () => {
    const result = verdict(artifact({ expoVersion: '57.0.9' }), {
      expoRange: '~57.0.9',
      expoVersion: '57.0.9',
    })
    assert.equal(result.allowed, false)
    assert.match(result.reason, /older than the fixed 57.0.17/)
  })

  test('a malformed hold refuses', () => {
    assert.equal(
      evaluateReleaseHold({
        hold: { heldFrom: '56' },
        ...sdk57,
        readArtifact: () => null,
      }).allowed,
      false
    )
  })

  test('the reader refuses evidence outside the repository', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    assert.equal(readReleaseHold(root).readArtifact('../../etc/hosts'), null)
  })

  test('the repository today is consistent with its SDK', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    assert.equal(evaluateReleaseHold(readReleaseHold(root)).allowed, true)
  })
})
