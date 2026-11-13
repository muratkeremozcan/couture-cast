// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00: the oracle judged on recorded and derived hierarchies before it judges any device run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'

import {
  androidScaledSize,
  assertColdControl,
  assertComposerControls,
  assertComposerFeedbackStable,
  assertLiveFontProof,
  evaluateLiveFontChange,
  expectedTextRatio,
  fixExpectedFor,
  parseBounds,
} from './live-font-scale-proof.mjs'

const baseline = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/live-font-6-8-baseline.json', import.meta.url),
    'utf8'
  )
)
const IDENTITY = { activity: 'activity-1', root: 'root-a1', onCreate: 1 }
const stage = (name) => ({
  ...structuredClone(baseline.captures.find((c) => c.stage === name)),
  identity: { ...IDENTITY },
})
const ANCHORS = ['current-temperature', 'outfit-comfort-notes']
// 48 sp temperature: Android 14+ keeps it at 48 dp at 1.5, so it correctly does not grow.
// 14 sp condition line: 22 dp at 1.5, a 1.571 ratio.
const PROBES = [
  { id: 'current-temperature', sizeSp: 48 },
  { id: 'current-condition', sizeSp: 14 },
]
const LARGE = new Set(['current-temperature'])

/**
 * A correct layout at the target scale: every app text box grows by the 14 sp ratio about its
 * top edge, except the large temperature, which Android leaves at its size. System UI is left
 * alone. Positions are not reflowed; the oracle compares heights and parents.
 */
function correct(capture, overrides = {}, factor = 22 / 14) {
  return {
    ...capture,
    ...overrides,
    nodes: capture.nodes.map((node) => {
      if (
        /^com\.android\.systemui:/.test(node.id) ||
        node.text === '' ||
        LARGE.has(node.id)
      )
        return node
      const [left, top, right, bottom] = parseBounds(node.bounds)
      const scaled = top + Math.round((bottom - top) * factor)
      return { ...node, bounds: `[${left},${top}][${right},${scaled}]` }
    }),
  }
}

// The Story 6.8 run has no cold launch at 1.5; its correct layout is derived as above.
const cold = () => correct(stage('settled'), { stage: 'cold' })
const bugChange = () => ({
  platform: 'android',
  before: stage('before'),
  immediate: stage('immediate'),
  settled: stage('settled'),
  cold: cold(),
  anchors: ANCHORS,
  probes: PROBES,
})
const fixedChange = () => ({
  ...bugChange(),
  immediate: correct(stage('immediate')),
  settled: correct(stage('settled')),
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

describe('expected text scaling', () => {
  test('Android 14+ follows the AOSP 1.5 curve', () => {
    assert.equal(androidScaledSize(20, 1.5), 26)
    assert.equal(androidScaledSize(24, 1.5), 28)
    assert.equal(androidScaledSize(30, 1.5), 30)
    assert.equal(androidScaledSize(48, 1.5), 48)
    assert.equal(androidScaledSize(14, 1.5), 22)
    assert.equal(androidScaledSize(6, 1.5), 9)
  })

  test('Android stays linear outside the tables and blends between them', () => {
    assert.equal(androidScaledSize(20, 1), 20)
    assert.equal(androidScaledSize(20, 1.04), 20 * 1.04)
    assert.equal(androidScaledSize(20, 2.5), 50)
    assert.ok(Math.abs(androidScaledSize(20, 1.4) - 24.8) < 1e-9)
  })

  test('Android before 14 (API 34) scales linearly', () => {
    assert.equal(
      expectedTextRatio({
        platform: 'android',
        androidApi: 32,
        sizeSp: 48,
        from: 1,
        to: 1.5,
      }),
      1.5
    )
    assert.equal(
      expectedTextRatio({
        platform: 'android',
        androidApi: 36,
        sizeSp: 48,
        from: 1,
        to: 1.5,
      }),
      1
    )
  })

  test('iOS scales by the content-size multiplier ratio', () => {
    assert.equal(expectedTextRatio({ platform: 'ios', from: 1, to: 1.353 }), 1.353)
    assert.ok(
      Math.abs(
        expectedTextRatio({ platform: 'android', sizeSp: 14, from: 1, to: 1.5 }) - 22 / 14
      ) < 1e-9
    )
  })
})

describe('evaluateLiveFontChange', () => {
  test('the Story 6.8 baseline is a known residual: small text stale, large text correct', () => {
    const { verdict, checks } = evaluateLiveFontChange(bugChange())
    assert.equal(verdict, 'known-residual')
    assert.equal(checks.fullText.before, 42) // 43 nodes less the status-bar clock
    assert.equal(checks.identity.pass, true)
    assert.equal(checks.coldParity.pass, false)
    assert.ok(checks.coldParity.misses.every((miss) => miss.stale))
    const [temperature, condition] = checks.growth.probes
    assert.equal(
      temperature.pass,
      true,
      'unchanged 48 sp text matches its cold reference'
    )
    assert.equal(temperature.expected, 1)
    assert.equal(condition.pass, false, 'the 14 sp line stayed at its 1.0 height')
    assert.equal(condition.ratio, 1)
  })

  test('a leg that starts from a stale screen measures growth from the cold reference', () => {
    // The 1.5 -> 1.0 leg after a residual: `before` reads 1.5 but kept its 1.0 heights, and the
    // return to 1.0 lands exactly on the 1.0 cold layout.
    const staleBefore = stage('settled')
    const backAtBase = (name) => ({ ...stage('before'), stage: name })
    const reverse = {
      platform: 'android',
      before: staleBefore,
      immediate: backAtBase('immediate'),
      settled: backAtBase('settled'),
      cold: backAtBase('cold'),
      coldBefore: cold(),
      anchors: ANCHORS,
      probes: PROBES,
    }
    const { checks, verdict } = evaluateLiveFontChange(reverse)
    assert.equal(checks.coldParity.pass, true)
    assert.equal(checks.growth.pass, true, JSON.stringify(checks.growth.probes))
    assert.equal(verdict, 'fixed')
    // Without the cold reference the stale start reads as text that failed to shrink.
    const withoutColdBefore = { ...reverse }
    delete withoutColdBefore.coldBefore
    assert.equal(evaluateLiveFontChange(withoutColdBefore).checks.growth.pass, false)
    // Text stuck at the 1.5 size after the return still fails, with or without it.
    const stuck = { ...reverse, settled: { ...cold(), stage: 'settled', fontScale: 1 } }
    const judged = evaluateLiveFontChange(stuck)
    assert.equal(judged.checks.growth.pass, false)
    assert.equal(judged.checks.coldParity.pass, false)
    assert.throws(
      () =>
        evaluateLiveFontChange({ ...reverse, coldBefore: { ...cold(), fontScale: 2 } }),
      { code: 'live_font_cold_before_scale_mismatch' }
    )
  })

  test('a live change that matches the cold layout is fixed, with large text unchanged', () => {
    const { verdict, checks } = evaluateLiveFontChange(fixedChange())
    assert.equal(verdict, 'fixed')
    assert.equal(checks.coldParity.compared, 42)
    assert.equal(checks.growth.probes[0].ratio, 1)
    assert.ok(checks.growth.probes[1].ratio > 1.5)
  })

  // F-00e: Android recreates MainActivity on a font change unless it declares fontScale.
  test('a same-PID Activity recreation is restored, never fixed, and says how', () => {
    const change = fixedChange()
    change.before.identity = { ...IDENTITY, onCreate: 1 }
    change.immediate.identity = { ...IDENTITY, activity: 'activity-2', onCreate: 2 }
    change.settled.identity = { ...IDENTITY, activity: 'activity-2', onCreate: 2 }
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(verdict, 'restored')
    assert.equal(checks.identity.processKept, true)
    assert.equal(checks.identity.activityChanged, true)
    assert.equal(checks.identity.onCreateDelta, 1)
    assert.deepEqual(checks.identity.activities, [
      'activity-1',
      'activity-2',
      'activity-2',
    ])
  })

  test('an onCreate rise is restored even when the token reads raced it', () => {
    const change = fixedChange()
    change.before.identity = { ...IDENTITY, onCreate: 3 }
    change.settled.identity = { ...IDENTITY, onCreate: 4 }
    assert.equal(evaluateLiveFontChange(change).verdict, 'restored')
  })

  test('a same-PID React remount is restored, never fixed', () => {
    const change = fixedChange()
    change.immediate.identity = { ...IDENTITY, root: 'root-a2' }
    change.settled.identity = { ...IDENTITY, root: 'root-a2' }
    assert.equal(evaluateLiveFontChange(change).verdict, 'restored')
  })

  // F-15 / Codex R4-05: Android must supply its native identity; unavailable is not zero.
  test('Android without an Activity token or onCreate count cannot pass identity', () => {
    for (const missing of ['activity', 'onCreate']) {
      const change = fixedChange()
      delete change.settled.identity[missing]
      const { verdict, checks } = evaluateLiveFontChange(change)
      assert.equal(checks.identity.nativeKnown, false, missing)
      assert.notEqual(verdict, 'fixed', missing)
    }
    const ios = { ...fixedChange(), platform: 'ios' }
    for (const name of ['before', 'immediate', 'settled'])
      ios[name].identity = { root: 'root-a1' }
    assert.equal(evaluateLiveFontChange(ios).checks.identity.pass, true)
  })

  // F-14 / Codex R4-04: the post-update stage keeps the screen whole and the same mount.
  test('a remounted screen after the update is never fixed', () => {
    const change = fixedChange()
    change.updated = {
      ...correct(stage('settled')),
      pid: '20001',
      identity: { activity: 'activity-9', root: 'root-z9', onCreate: 2 },
    }
    change.coldUpdated = cold()
    assert.notEqual(evaluateLiveFontChange(change).verdict, 'fixed')
    change.updated.pid = change.settled.pid
    assert.equal(evaluateLiveFontChange(change).verdict, 'restored')
  })

  test('a mostly missing screen after the update is never fixed', () => {
    const change = fixedChange()
    change.updated = correct(stage('settled'))
    change.updated.nodes = change.updated.nodes.filter(
      (node) => node.id === 'current-condition'
    )
    change.coldUpdated = cold()
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(
      checks.postUpdateParity.pass,
      false,
      'one surviving node does not pass parity'
    )
    assert.equal(checks.postUpdateFullText.pass, false)
    assert.equal(checks.postUpdateAnchors.pass, false)
    assert.equal(verdict, 'unexpected')
  })

  test('text measured at an earlier scale on the same launch is stale too', () => {
    // The return leg's update brings back a label the 1.5 leg measured; it keeps that height.
    const label = { text: 'Collapse', id: '', bounds: '[831,807][1017,872]' }
    const reverse = {
      platform: 'android',
      before: stage('settled'),
      immediate: { ...stage('before'), stage: 'immediate' },
      settled: { ...stage('before'), stage: 'settled' },
      cold: { ...stage('before'), stage: 'cold' },
      coldBefore: cold(),
      anchors: ANCHORS,
      probes: PROBES,
    }
    reverse.updated = {
      ...reverse.settled,
      stage: 'updated',
      nodes: [...reverse.settled.nodes, label],
    }
    reverse.coldUpdated = {
      ...reverse.cold,
      nodes: [...reverse.cold.nodes, { ...label, bounds: '[894,818][1017,861]' }],
    }
    const unexplained = evaluateLiveFontChange(reverse)
    assert.equal(unexplained.verdict, 'unexpected')
    assert.equal(unexplained.checks.postUpdateParity.misses[0].stale, false)
    const earlier = [{ ...stage('settled'), nodes: [label] }]
    const explained = evaluateLiveFontChange({ ...reverse, earlier })
    assert.equal(explained.verdict, 'known-residual')
    assert.equal(explained.checks.postUpdateParity.misses[0].staleFrom, 'earlier')
    // A height no earlier capture showed stays unexplained.
    const other = [
      { ...stage('settled'), nodes: [{ ...label, bounds: '[831,807][1017,900]' }] },
    ]
    assert.equal(
      evaluateLiveFontChange({ ...reverse, earlier: other }).verdict,
      'unexpected'
    )
  })

  test('a whole, same-mount update that matches its cold reference stays fixed', () => {
    const change = fixedChange()
    change.updated = correct(stage('settled'))
    change.coldUpdated = cold()
    assert.equal(evaluateLiveFontChange(change).verdict, 'fixed')
  })

  test('a capture without the mount marker cannot pass identity', () => {
    const change = fixedChange()
    delete change.settled.identity.root
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(checks.identity.rootKnown, false)
    assert.equal(verdict, 'unexpected')
  })

  test('the 44-to-5 blank-text regression is unexpected', () => {
    const change = fixedChange()
    const kept = new Set(change.settled.nodes.slice(0, 5).map((node) => node.text))
    for (const name of ['immediate', 'settled'])
      change[name].nodes = change[name].nodes.filter((node) => kept.has(node.text))
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(verdict, 'unexpected')
    assert.equal(checks.anchors.pass, false)
    assert.equal(checks.fullText.pass, false)
  })

  test('a process restart is unexpected even when layout is right', () => {
    const change = fixedChange()
    change.settled.pid = '20001'
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(verdict, 'unexpected')
    assert.equal(checks.identity.processKept, false)
  })

  test('text that leaves its parent is clipped and never fixed', () => {
    const change = fixedChange()
    const node = change.settled.nodes.find((n) => n.id === 'current-condition')
    const [left, top, right] = parseBounds(node.bounds)
    node.parent = `[${left},${top}][${right},${top + 40}]`
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(checks.clipping.pass, false)
    assert.equal(verdict, 'unexpected')
  })

  /** Gives the probe's node in `capture` a parent with `above` and `below` px of overhang. */
  function overhang(capture, id, above, below) {
    const node = capture.nodes.find((n) => n.id === id)
    const [left, top, right, bottom] = parseBounds(node.bounds)
    node.parent = `[${left},${top + above}][${right},${bottom - below}]`
    return node
  }
  /** A node box of `size` px at `top`, centred over a `row` px parent. */
  function centredBox(capture, id, size, row, top = 100) {
    const node = capture.nodes.find((n) => n.id === id)
    const [left, , right] = parseBounds(node.bounds)
    const gap = (size - row) / 2
    node.bounds = `[${left},${top}][${right},${top + size}]`
    node.parent = `[${left},${top + gap}][${right},${top + size - gap}]`
  }

  test('a touch target centred over a shorter row is not clipped text', () => {
    // iOS: a 44 pt icon button (About CoutureCast) centred on a 38 pt header row overflows it by
    // 3 pt above and below with the same box at every text size, the cold base launch included.
    const change = { ...fixedChange(), coldBase: structuredClone(stage('before')) }
    overhang(change.coldBase, 'current-temperature', 3, 3)
    overhang(change.settled, 'current-temperature', 3, 3)
    assert.equal(evaluateLiveFontChange(change).checks.clipping.pass, true)
    // Without the cold base launch there is nothing to compare with: no exemption.
    const withoutBase = { ...change }
    delete withoutBase.coldBase
    assert.equal(evaluateLiveFontChange(withoutBase).checks.clipping.pass, false)
    // Overhang only below is grown text, never a centred target.
    overhang(change.settled, 'current-temperature', 0, 6)
    assert.equal(evaluateLiveFontChange(change).checks.clipping.pass, false)
  })

  test('text that grew past a row that centres it is clipped (P2-1)', () => {
    // Yoga centres the overflow of grown text equally above and below a fixed-height row.
    const change = { ...fixedChange(), coldBase: structuredClone(stage('before')) }
    overhang(change.settled, 'current-condition', 6, 6)
    const { checks, verdict } = evaluateLiveFontChange(change)
    assert.equal(checks.clipping.pass, false)
    assert.notEqual(verdict, 'fixed')
  })

  test('growth within the height tolerance still ends the exemption (P2-1 re-check)', () => {
    // Android tolerance is 2 px: 28 px text in a 24 px centred row at the base scale, 30 px live.
    const change = { ...fixedChange(), coldBase: structuredClone(stage('before')) }
    centredBox(change.coldBase, 'current-temperature', 28, 24)
    centredBox(change.settled, 'current-temperature', 30, 24)
    assert.equal(evaluateLiveFontChange(change).checks.clipping.pass, false)
    // A parent that shrinks under a box of the same height ends it too.
    centredBox(change.settled, 'current-temperature', 28, 22)
    assert.equal(evaluateLiveFontChange(change).checks.clipping.pass, false)
    centredBox(change.settled, 'current-temperature', 28, 24)
    assert.equal(evaluateLiveFontChange(change).checks.clipping.pass, true)
  })

  test('stale text on a return leg is judged against the cold base launch (P2-1 re-check)', () => {
    // 1.5 to 1.0: `before` is the stale 1.5 capture, so it shows the same 50 px box; the cold
    // base launch shows the text at 20 px inside the 38 px row.
    const before = structuredClone(stage('settled'))
    centredBox(before, 'current-condition', 50, 38)
    const settled = { ...structuredClone(stage('before')), stage: 'settled' }
    centredBox(settled, 'current-condition', 50, 38)
    const coldBase = structuredClone(stage('before'))
    centredBox(coldBase, 'current-condition', 20, 20)
    const change = {
      platform: 'android',
      before,
      immediate: { ...settled, stage: 'immediate' },
      settled,
      cold: { ...stage('before'), stage: 'cold' },
      coldBase,
      anchors: ANCHORS,
      probes: PROBES,
    }
    assert.equal(evaluateLiveFontChange(change).checks.clipping.pass, false)
  })

  test('a height that matches neither the base nor the cold layout is unexpected', () => {
    const change = { ...fixedChange(), settled: correct(stage('settled'), {}, 1.3) }
    assert.equal(evaluateLiveFontChange(change).verdict, 'unexpected')
  })

  test('stale text after a post-scale React update is a residual, caught after a clean settle', () => {
    const change = fixedChange()
    change.updated = stage('settled') // the update re-used the 1.0 measurements
    change.coldUpdated = cold()
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(checks.coldParity.pass, true)
    assert.equal(checks.postUpdateParity.pass, false)
    assert.equal(verdict, 'known-residual')
  })

  test('refuses a run with no scale change, no anchors, a cold launch at another scale, or half an update', () => {
    assert.throws(
      () => evaluateLiveFontChange({ ...bugChange(), settled: stage('before') }),
      { code: 'live_font_scale_change_required' }
    )
    assert.throws(() => evaluateLiveFontChange({ ...bugChange(), anchors: [] }), {
      code: 'live_font_anchors_required',
    })
    assert.throws(
      () => evaluateLiveFontChange({ ...bugChange(), cold: { ...cold(), fontScale: 1 } }),
      { code: 'live_font_cold_scale_mismatch' }
    )
    assert.throws(
      () => evaluateLiveFontChange({ ...bugChange(), updated: stage('settled') }),
      {
        code: 'live_font_update_pair_required',
      }
    )
  })
})

describe('assertLiveFontProof', () => {
  // R2-05: the Story 6.8 Home residual as a reviewed baseline would describe it.
  const BASELINE = {
    staleIds: ['', 'current-condition', 'outfit-comfort-notes'],
    maxStaleMisses: 41,
  }

  test('below 0.87 a residual passes only inside its reviewed baseline', () => {
    const result = assertLiveFontProof({
      reactNativeVersion: '0.81.5',
      residualBaseline: BASELINE,
      ...bugChange(),
    })
    assert.equal(result.verdict, 'known-residual')
    assert.equal(result.baselineReview, false)
    assert.throws(
      () => assertLiveFontProof({ reactNativeVersion: '0.81.5', ...bugChange() }),
      {
        code: 'live_font_residual_unapproved',
      }
    )
    assert.throws(
      () =>
        assertLiveFontProof({
          reactNativeVersion: '0.81.5',
          residualBaseline: { ...BASELINE, staleIds: [''] },
          ...bugChange(),
        }),
      (error) =>
        error.code === 'live_font_residual_unapproved' &&
        /current-condition/.test(error.message)
    )
    assert.throws(
      () =>
        assertLiveFontProof({
          reactNativeVersion: '0.81.5',
          residualBaseline: { ...BASELINE, maxStaleMisses: 3 },
          ...bugChange(),
        }),
      { code: 'live_font_residual_unapproved' }
    )
  })

  test('the version switch: the residual fails from 0.87, the healthy run passes on both sides', () => {
    assert.throws(
      () =>
        assertLiveFontProof({
          reactNativeVersion: '0.87.0',
          residualBaseline: BASELINE,
          ...bugChange(),
        }),
      { code: 'live_font_fix_missing' }
    )
    for (const version of ['0.81.5', '0.88.1'])
      assert.equal(
        assertLiveFontProof({ reactNativeVersion: version, ...fixedChange() }).verdict,
        'fixed'
      )
  })

  test('a required control off screen fails inside an approved residual', () => {
    const change = bugChange()
    change.settled.window = '[0,0][1080,2400]'
    change.settled.controls = [{ id: 'tab-settings', bounds: '[810,2410][1080,2520]' }]
    assert.throws(
      () =>
        assertLiveFontProof({
          reactNativeVersion: '0.81.5',
          residualBaseline: BASELINE,
          requiredControls: ['tab-settings'],
          ...change,
        }),
      (error) =>
        error.code === 'live_font_baseline_unexpected' && /controls/.test(error.message)
    )
  })

  test('below 0.87 an early correct relayout passes and flags the baseline for review', () => {
    const result = assertLiveFontProof({
      reactNativeVersion: '0.83.10',
      ...fixedChange(),
    })
    assert.equal(result.verdict, 'fixed')
    assert.equal(result.baselineReview, true)
  })

  test('a restored screen is red at every version', () => {
    const change = fixedChange()
    change.settled.identity = { ...IDENTITY, activity: 'activity-2' }
    assert.throws(
      () => assertLiveFontProof({ reactNativeVersion: '0.81.5', ...change }),
      {
        code: 'live_font_baseline_unexpected',
      }
    )
    assert.throws(
      () => assertLiveFontProof({ reactNativeVersion: '0.88.1', ...change }),
      {
        code: 'live_font_fix_missing',
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
        /verdict known-residual; failing coldParity,growth/.test(error.message)
    )
    assert.equal(
      assertLiveFontProof({ reactNativeVersion: '0.88.1', ...fixedChange() }).verdict,
      'fixed'
    )
  })
})

describe('assertColdControl', () => {
  const base = () => ({ ...stage('before'), stage: 'cold' })

  test('cold 1.0 against cold 1.5 keeps the text and scales each probe as the platform does', () => {
    const target = correct(base(), { fontScale: 1.5 })
    const { ratios } = assertColdControl({
      platform: 'android',
      base: base(),
      target,
      probes: PROBES,
    })
    assert.deepEqual(
      ratios.map(({ probe, pass }) => [probe, pass]),
      [
        ['current-temperature', true],
        ['current-condition', true],
      ]
    )
  })

  test('a control that does not grow is red, so the oracle cannot pass blind', () => {
    const target = { ...base(), fontScale: 1.5 }
    assert.throws(
      () =>
        assertColdControl({ platform: 'android', base: base(), target, probes: PROBES }),
      { code: 'live_font_control_ratio_mismatch' }
    )
  })

  test('a probe declared at the wrong size is red', () => {
    const target = correct(base(), { fontScale: 1.5 })
    const probes = [{ id: 'current-condition', sizeSp: 30 }]
    assert.throws(
      () => assertColdControl({ platform: 'android', base: base(), target, probes }),
      { code: 'live_font_control_growth_probe_required' }
    )
    assert.throws(
      () =>
        assertColdControl({
          platform: 'android',
          base: base(),
          target,
          probes: [...probes, { id: 'current-temperature', sizeSp: 14 }],
        }),
      { code: 'live_font_control_ratio_mismatch' }
    )
  })
})

describe('composer controls (F-05)', () => {
  const capture = (save, share) => ({
    controls: [
      { id: 'share-card-save', bounds: save },
      { id: 'share-card-share', bounds: share },
    ],
  })
  const window = '[0,0][1080,2400]'

  test('across scales the controls may move but stay on screen, apart and touchable', () => {
    assert.equal(
      assertComposerControls({
        capture: capture('[42,2000][530,2126]', '[550,2000][1038,2126]'),
        window,
        minTarget: 126,
      }).tier,
      'row'
    )
    assert.equal(
      assertComposerControls({
        capture: capture('[42,1900][1038,2026]', '[42,2050][1038,2176]'),
        window,
        minTarget: 126,
      }).tier,
      'stacked'
    )
  })

  test('overlapping, off-screen or undersized controls are red', () => {
    assert.throws(
      () =>
        assertComposerControls({
          capture: capture('[42,2000][600,2126]', '[550,2000][1038,2126]'),
          window,
          minTarget: 126,
        }),
      { code: 'live_font_composer_controls_overlap' }
    )
    assert.throws(
      () =>
        assertComposerControls({
          capture: capture('[42,2350][530,2476]', '[550,2000][1038,2126]'),
          window,
          minTarget: 126,
        }),
      { code: 'live_font_composer_control_off_screen' }
    )
    assert.throws(
      () =>
        assertComposerControls({
          capture: capture('[42,2000][530,2100]', '[550,2000][1038,2126]'),
          window,
          minTarget: 126,
        }),
      { code: 'live_font_composer_control_too_small' }
    )
  })

  test('at one scale, feedback copy must not move Save or Share', () => {
    const still = capture('[42,2000][530,2126]', '[550,2000][1038,2126]')
    assert.deepEqual(
      assertComposerFeedbackStable({ withoutFeedback: still, withFeedback: still }),
      { stable: true }
    )
    assert.throws(
      () =>
        assertComposerFeedbackStable({
          withoutFeedback: still,
          withFeedback: capture('[42,2040][530,2166]', '[550,2040][1038,2166]'),
        }),
      { code: 'live_font_composer_feedback_moved_control' }
    )
  })
})
