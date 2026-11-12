// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S2-08 and S3-02 (D12, R2-06): deploy-mobile refuses a production build from SDK 56 until a
// measurement on the current SDK clears the hold.
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { evaluateReleaseHold, readReleaseHold } from './mobile-release-hold.mjs'

const hold = (...lifts) => ({
  heldFrom: 56,
  reason: 'Hermes V1 memory regression with Worklets and Reanimated',
  lifts,
})
const lift = (overrides = {}) => ({
  sdk: 57,
  expo: '57.0.33',
  measuredAt: '2026-11-25T15:00:00Z',
  peakRatio: 1.03,
  settledRatio: 1.01,
  evidence: '_bmad-output/test-artifacts/story-6-15/s3-02-memory',
  ...overrides,
})
const sdk56 = { expoRange: '~56.0.24', expoVersion: '56.0.24' }
const sdk57 = { expoRange: '~57.0.33', expoVersion: '57.0.33' }

describe('evaluateReleaseHold', () => {
  test('before SDK 56 no hold is needed', () => {
    assert.equal(
      evaluateReleaseHold({ hold: null, expoRange: '~54.0.36', expoVersion: '54.0.36' })
        .allowed,
      true
    )
  })

  test('from SDK 56 a missing hold file refuses, so deleting it releases nothing', () => {
    const verdict = evaluateReleaseHold({ hold: null, ...sdk57 })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /it was removed/)
  })

  test('SDK 56 with no measurement is held', () => {
    assert.equal(evaluateReleaseHold({ hold: hold(), ...sdk56 }).allowed, false)
  })

  test('SDK 56 releases early only on its own measurement within 10%', () => {
    assert.equal(
      evaluateReleaseHold({ hold: hold(lift({ sdk: 56 })), ...sdk56 }).allowed,
      true
    )
    assert.equal(
      evaluateReleaseHold({ hold: hold(lift({ sdk: 56, peakRatio: 1.12 })), ...sdk56 })
        .allowed,
      false
    )
  })

  test('Step 3 over the threshold keeps the hold', () => {
    const verdict = evaluateReleaseHold({
      hold: hold(lift({ peakRatio: 1.25 })),
      ...sdk57,
    })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /exceed 1.1/)
  })

  test('Step 3 within the threshold releases', () => {
    assert.equal(evaluateReleaseHold({ hold: hold(lift()), ...sdk57 }).allowed, true)
  })

  test('a measurement from SDK 56 does not release SDK 57', () => {
    assert.equal(
      evaluateReleaseHold({ hold: hold(lift({ sdk: 56 })), ...sdk57 }).allowed,
      false
    )
  })

  test('SDK 57 before the fixed patch stays held even with a passing measurement', () => {
    const verdict = evaluateReleaseHold({
      hold: hold(lift()),
      expoRange: '~57.0.9',
      expoVersion: '57.0.9',
    })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /older than the fixed 57.0.17/)
  })

  test('missing evidence or a malformed file refuses', () => {
    assert.equal(
      evaluateReleaseHold({ hold: hold(lift({ evidence: '' })), ...sdk57 }).allowed,
      false
    )
    assert.equal(
      evaluateReleaseHold({ hold: { heldFrom: '56' }, ...sdk57 }).allowed,
      false
    )
  })

  test('the repository today is consistent with its SDK', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    assert.equal(evaluateReleaseHold(readReleaseHold(root)).allowed, true)
  })
})
