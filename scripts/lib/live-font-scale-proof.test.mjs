// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00: the oracle judged on recorded hierarchies before it judges any device run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'

import {
  assertColdControl,
  assertLiveFontProof,
  evaluateLiveFontChange,
  fixExpectedFor,
  parseBounds,
} from './live-font-scale-proof.mjs'

const baseline = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/live-font-6-8-baseline.json', import.meta.url),
    'utf8'
  )
)
const stage = (name) => structuredClone(baseline.captures.find((c) => c.stage === name))
const ANCHORS = ['current-temperature', 'outfit-comfort-notes']
const PROBES = ['current-temperature']

/** Scale every app text box's height about its top edge; system UI is left alone. */
function grown(capture, factor, overrides = {}) {
  return {
    ...capture,
    ...overrides,
    nodes: capture.nodes.map((node) => {
      if (/^com\.android\.systemui:/.test(node.id) || node.text === '') return node
      const [left, top, right, bottom] = parseBounds(node.bounds)
      const scaled = top + Math.round((bottom - top) * factor)
      return { ...node, bounds: `[${left},${top}][${right},${scaled}]` }
    }),
  }
}

// The Story 6.8 run has no cold launch at 1.5; a correct cold layout grows every line by the
// scale, which is what a fixed live change must match.
const coldAtTarget = () => grown(stage('settled'), 1.5, { stage: 'cold' })
const bugChange = () => ({
  platform: 'android',
  before: stage('before'),
  immediate: stage('immediate'),
  settled: stage('settled'),
  cold: coldAtTarget(),
  anchors: ANCHORS,
  probes: PROBES,
})
const fixedChange = () => ({
  ...bugChange(),
  immediate: grown(stage('immediate'), 1.5),
  settled: grown(stage('settled'), 1.5),
})

describe('fixExpectedFor', () => {
  test('expects the fix from React Native 0.87.0', () => {
    assert.equal(fixExpectedFor('0.81.5'), false)
    assert.equal(fixExpectedFor('0.83.10'), false)
    assert.equal(fixExpectedFor('0.86.3'), false)
    assert.equal(fixExpectedFor('0.87.0-rc.0'), false)
    assert.equal(fixExpectedFor('0.87.0'), true)
    assert.equal(fixExpectedFor('0.88.1'), true)
    assert.equal(fixExpectedFor('1.0.0'), true)
  })

  test('refuses a missing or malformed version', () => {
    for (const version of [undefined, '', '0.88', 'latest'])
      assert.throws(() => fixExpectedFor(version), {
        code: 'live_font_rn_version_required',
      })
  })
})

describe('evaluateLiveFontChange', () => {
  test('the Story 6.8 baseline (43 nodes, temperature at 169 px) is the bug signature', () => {
    const { verdict, checks } = evaluateLiveFontChange(bugChange())
    assert.equal(verdict, 'bug-signature')
    assert.equal(checks.fullText.before, 42) // 43 nodes less the status-bar clock
    assert.equal(checks.fullText.pass, true)
    assert.equal(checks.anchors.pass, true)
    assert.equal(checks.process.pass, true)
    assert.equal(checks.growth.pass, false)
    assert.deepEqual(checks.growth.probes, [{ probe: 'current-temperature', ratio: 1 }])
    assert.equal(checks.coldParity.pass, false)
  })

  test('a live change that matches the cold layout and grows is fixed', () => {
    const { verdict, checks } = evaluateLiveFontChange(fixedChange())
    assert.equal(verdict, 'fixed')
    assert.equal(checks.coldParity.compared, 42)
    assert.ok(checks.growth.probes[0].ratio >= 1.49)
  })

  test('the 44-to-5 blank-text regression fails anchors and full text', () => {
    const change = fixedChange()
    const kept = new Set(change.settled.nodes.slice(0, 5).map((node) => node.text))
    for (const name of ['immediate', 'settled'])
      change[name].nodes = change[name].nodes.filter((node) => kept.has(node.text))
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(verdict, 'unexpected')
    assert.equal(checks.anchors.pass, false)
    assert.equal(checks.fullText.pass, false)
  })

  test('a process restart fails process even when layout is right', () => {
    const change = fixedChange()
    change.settled.pid = '20001'
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(verdict, 'unexpected')
    assert.equal(checks.process.pass, false)
  })

  test('growth short of 0.9 times the scale ratio fails growth', () => {
    const change = { ...fixedChange(), settled: grown(stage('settled'), 1.3) }
    change.cold = grown(stage('settled'), 1.3, { stage: 'cold' })
    const { checks } = evaluateLiveFontChange(change)
    assert.equal(checks.coldParity.pass, true)
    assert.equal(checks.growth.pass, false)
  })

  test('a live height off the cold height by more than the platform tolerance fails parity', () => {
    const change = fixedChange()
    change.cold = grown(stage('settled'), 1.52, { stage: 'cold' })
    assert.equal(evaluateLiveFontChange(change).checks.coldParity.pass, false)
    assert.equal(
      evaluateLiveFontChange({ ...fixedChange(), platform: 'ios' }).checks.coldParity
        .pass,
      true
    )
  })

  test('refuses a run with no scale change, no anchors, or a cold launch at another scale', () => {
    assert.throws(
      () => evaluateLiveFontChange({ ...bugChange(), settled: stage('before') }),
      { code: 'live_font_scale_change_required' }
    )
    assert.throws(() => evaluateLiveFontChange({ ...bugChange(), anchors: [] }), {
      code: 'live_font_anchors_required',
    })
    assert.throws(
      () =>
        evaluateLiveFontChange({
          ...bugChange(),
          cold: { ...coldAtTarget(), fontScale: 1 },
        }),
      { code: 'live_font_cold_scale_mismatch' }
    )
  })
})

describe('assertLiveFontProof', () => {
  test('below 0.87 the bug signature passes and the fix itself is red', () => {
    assert.equal(
      assertLiveFontProof({ reactNativeVersion: '0.81.5', ...bugChange() }).fixExpected,
      false
    )
    assert.throws(
      () => assertLiveFontProof({ reactNativeVersion: '0.86.3', ...fixedChange() }),
      {
        code: 'live_font_bug_signature_missing',
      }
    )
  })

  // Red proof for F-00 (test design): the 6.8 baseline judged as fix-expected must fail on
  // cold parity and growth.
  test('from 0.87 the Story 6.8 baseline is red on cold parity and growth', () => {
    assert.throws(
      () => assertLiveFontProof({ reactNativeVersion: '0.88.1', ...bugChange() }),
      (error) =>
        error.code === 'live_font_fix_missing' &&
        /verdict bug-signature; failing coldParity,growth/.test(error.message)
    )
    assert.equal(
      assertLiveFontProof({ reactNativeVersion: '0.88.1', ...fixedChange() }).verdict,
      'fixed'
    )
  })
})

describe('assertColdControl', () => {
  test('cold 1.0 against cold 1.5 keeps the text and grows the probes', () => {
    const base = { ...stage('before'), stage: 'cold' }
    const target = grown(base, 1.5, { fontScale: 1.5 })
    const { ratios } = assertColdControl({
      platform: 'android',
      base,
      target,
      probes: PROBES,
    })
    assert.ok(ratios[0].ratio >= 1.49)
  })

  test('a control that does not grow is red, so the oracle cannot pass blind', () => {
    const base = { ...stage('before'), stage: 'cold' }
    const target = { ...base, fontScale: 1.5 }
    assert.throws(
      () => assertColdControl({ platform: 'android', base, target, probes: PROBES }),
      { code: 'live_font_control_no_growth' }
    )
  })
})
