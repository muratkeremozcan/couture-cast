// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S2-08 (D12): deploy-mobile refuses a production build while SDK 56 is held.
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { evaluateReleaseHold, readReleaseHold } from './mobile-release-hold.mjs'

const hold = (lift = null) => ({
  sdk: 56,
  reason: 'Hermes V1 memory regression with Worklets and Reanimated',
  lift,
})
const lift = (overrides = {}) => ({
  measuredAt: '2026-11-20T15:00:00Z',
  peakRatio: 1.04,
  settledRatio: 1.02,
  limit: 1.1,
  evidence: '_bmad-output/test-artifacts/story-6-15/s2-07-memory',
  ...overrides,
})

describe('evaluateReleaseHold', () => {
  test('no hold file allows the build', () => {
    assert.equal(evaluateReleaseHold({ hold: null, expoRange: '~56.0.24' }).allowed, true)
  })

  test('an active hold on the current SDK refuses the build', () => {
    const verdict = evaluateReleaseHold({ hold: hold(), expoRange: '~56.0.24' })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /SDK 56 is held/)
  })

  test('a measured lift within the limit allows it; one past the limit does not', () => {
    assert.equal(
      evaluateReleaseHold({ hold: hold(lift()), expoRange: '~56.0.24' }).allowed,
      true
    )
    for (const bad of [
      { peakRatio: 1.2 },
      { settledRatio: 1.11 },
      { evidence: '' },
      { measuredAt: 'soon' },
    ])
      assert.equal(
        evaluateReleaseHold({ hold: hold(lift(bad)), expoRange: '~56.0.24' }).allowed,
        false,
        JSON.stringify(bad)
      )
  })

  test('a hold left behind after the SDK moved refuses until it is deleted', () => {
    const verdict = evaluateReleaseHold({ hold: hold(), expoRange: '~57.0.33' })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /delete the stale hold/)
  })

  test('a malformed hold refuses', () => {
    assert.equal(
      evaluateReleaseHold({ hold: { sdk: '56' }, expoRange: '~56.0.24' }).allowed,
      false
    )
  })

  test('the repository today carries no hold', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    assert.equal(evaluateReleaseHold(readReleaseHold(root)).allowed, true)
  })
})
