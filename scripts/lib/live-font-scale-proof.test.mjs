// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00: the oracle judged on recorded and derived hierarchies before it judges any device run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import {
  mountTracker,
  readWithMounts,
  rootIdentity,
  widenMounts,
} from './live-font-capture.mjs'

import {
  androidScaledSize,
  assertColdControl,
  assertComposerControls,
  assertComposerFeedbackStable,
  assertLiveFontProof,
  evaluateLiveFontChange,
  expectedTextRatio,
  fixExpectedFor,
  HOUR_LABEL,
  parseBounds,
  proposedResidualEntry,
  requiredMounts,
  stageKeys,
  WEATHER_BANNER_MARKER,
  WEATHER_STALE_TEXT,
  weatherBannerState,
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

  test('one screen mount across the stages is kept; a changed one is not', () => {
    const both = 'live-font-mount-root-h16mcs1,live-font-mount-settings-h16mcs3'
    const change = fixedChange()
    for (const name of ['before', 'immediate', 'settled'])
      change[name].identity.root = both
    assert.equal(evaluateLiveFontChange(change).checks.identity.rootKept, true)
    change.settled.identity.root =
      'live-font-mount-root-h16mcs1,live-font-mount-settings-k77abc3'
    assert.equal(evaluateLiveFontChange(change).checks.identity.rootKept, false)
    change.settled.identity.root = 'live-font-mount-settings-h16mcs3'
    const noRoot = evaluateLiveFontChange(change).checks.identity
    assert.equal(noRoot.rootKnown, false)
    assert.equal(noRoot.rootKept, false)
  })

  // Antigravity handover R1 (P2-1): a marker left out of any capture could hide a remount whose
  // fresh render passes every height check, so it leaves identity unknown.
  test('a screen marker missing from any stage leaves identity unknown', () => {
    const both = 'live-font-mount-root-h16mcs1,live-font-mount-settings-h16mcs3'
    const rootOnly = 'live-font-mount-root-h16mcs1'
    for (const dropped of ['before', 'immediate', 'settled', 'updated']) {
      const change = fixedChange()
      change.updated = correct(stage('settled'))
      change.coldUpdated = cold()
      for (const name of ['before', 'immediate', 'settled', 'updated'])
        change[name].identity.root = name === dropped ? rootOnly : both
      const { verdict, checks } = evaluateLiveFontChange(change)
      assert.equal(checks.identity.rootKnown, false, dropped)
      assert.equal(checks.identity.rootKept, false, dropped)
      assert.equal(verdict, 'unexpected', dropped)
    }
  })

  test("the screen's own marker is required even when no stage shows it", () => {
    const change = fixedChange()
    for (const name of ['before', 'immediate', 'settled'])
      change[name].identity.root = 'live-font-mount-root-h16mcs1'
    assert.equal(evaluateLiveFontChange(change).checks.identity.rootKept, true)
    const { verdict, checks } = evaluateLiveFontChange({ ...change, mount: 'settings' })
    assert.equal(checks.identity.rootKnown, false)
    assert.equal(verdict, 'unexpected')
    for (const name of ['before', 'immediate', 'settled'])
      change[name].identity.root =
        'live-font-mount-root-h16mcs1,live-font-mount-settings-h16mcs3'
    assert.equal(
      evaluateLiveFontChange({ ...change, mount: 'settings' }).checks.identity.rootKept,
      true
    )
  })

  // Antigravity handover r2 (P2): Home stays mounted under Settings, so the before capture
  // carries its marker and every stage must. The runner widens its reread to each scope the
  // before capture showed: one dropped Home dump is reread and passes, three fail the leg.
  test('a scope the before capture showed is reread, and fails only after three drops', () => {
    const before = [
      'live-font-mount-home-h1',
      'live-font-mount-root-r1',
      'live-font-mount-settings-s1',
    ]
    const dropped = ['live-font-mount-root-r1', 'live-font-mount-settings-s1']
    const scopes = widenMounts(['root', 'settings'], before)
    assert.deepEqual(scopes, ['root', 'settings', 'home'])
    const settledWith = (dumps) => {
      let index = 0
      const read = () => ({ markers: dumps[Math.min(index++, dumps.length - 1)] })
      return rootIdentity(readWithMounts(read, scopes).markers)
    }
    const change = fixedChange()
    change.before.identity.root = rootIdentity(before)
    change.immediate.identity.root = rootIdentity(before)
    change.settled.identity.root = settledWith([dropped, before])
    const once = evaluateLiveFontChange({ ...change, mount: 'settings' })
    assert.equal(once.checks.identity.rootKept, true)
    assert.equal(once.verdict, 'fixed')
    change.settled.identity.root = settledWith([dropped, dropped, dropped, before])
    const thrice = evaluateLiveFontChange({ ...change, mount: 'settings' })
    assert.equal(thrice.checks.identity.rootKnown, false)
    assert.equal(thrice.verdict, 'unexpected')
  })

  test('two mounts of one scope in one capture are no kept identity', () => {
    const change = fixedChange()
    const one = 'live-font-mount-modal-m2,live-font-mount-root-r1'
    change.before.identity.root = one
    change.immediate.identity.root = one
    change.settled.identity.root =
      'live-font-mount-modal-m1,live-font-mount-modal-m2,live-font-mount-root-r1'
    const { verdict, checks } = evaluateLiveFontChange(change)
    assert.equal(checks.identity.rootKept, false)
    assert.notEqual(verdict, 'fixed')
  })

  test('a modal capture with only the modal marker judges identity by the modal mount', () => {
    // Android dumps only the modal window while it is up (device run 2026-11-13, composer).
    const change = fixedChange()
    const modal = 'live-font-mount-modal-m1'
    for (const name of ['before', 'immediate', 'settled'])
      change[name].identity.root = modal
    const kept = evaluateLiveFontChange({ ...change, mount: 'modal' })
    assert.equal(kept.checks.identity.rootKnown, true)
    assert.equal(kept.checks.identity.rootKept, true)
    assert.equal(kept.verdict, 'fixed')
    // A root remount remounts the modal inside it: a new modal id is no kept identity.
    change.settled.identity.root = 'live-font-mount-modal-m2'
    const remounted = evaluateLiveFontChange({ ...change, mount: 'modal' })
    assert.equal(remounted.checks.identity.rootKept, false)
    assert.notEqual(remounted.verdict, 'fixed')
    // Root shown in one modal stage must show in every stage (iOS shows both).
    change.settled.identity.root = 'live-font-mount-modal-m1,live-font-mount-root-r1'
    const partial = evaluateLiveFontChange({ ...change, mount: 'modal' })
    assert.equal(partial.checks.identity.rootKnown, false)
    // Other screens still need the root marker.
    for (const name of ['before', 'immediate', 'settled'])
      change[name].identity.root = 'live-font-mount-settings-s1'
    const noRoot = evaluateLiveFontChange({ ...change, mount: 'settings' })
    assert.equal(noRoot.checks.identity.rootKnown, false)
  })

  // Antigravity r28 (P3): the runner rereads for the scopes the identity check requires, so a
  // composer capture on Android (modal window only) is read once.
  test('the runner rereads for exactly the scopes the identity check requires', () => {
    assert.deepEqual(requiredMounts('modal'), ['modal'])
    assert.deepEqual(requiredMounts('settings'), ['root', 'settings'])
    assert.deepEqual(requiredMounts(undefined), ['root'])
    const readsFor = (mount, markers) => {
      const tracker = mountTracker(requiredMounts(mount))
      let reads = 0
      readWithMounts(() => {
        reads += 1
        return { markers }
      }, tracker.scopes())
      return reads
    }
    assert.equal(readsFor('modal', ['live-font-mount-modal-m1']), 1)
    assert.equal(readsFor('settings', ['live-font-mount-settings-s1']), 3)
    assert.equal(
      readsFor('settings', ['live-font-mount-root-r1', 'live-font-mount-settings-s1']),
      1
    )
  })

  test('a remount between legs of one launch is caught by the later leg', () => {
    const change = fixedChange()
    const later = 'live-font-mount-root-r1,live-font-mount-settings-s2'
    for (const name of ['before', 'immediate', 'settled'])
      change[name].identity.root = later
    assert.equal(evaluateLiveFontChange(change).checks.identity.rootKept, true)
    const earlierLeg = correct(stage('settled'))
    earlierLeg.identity.root = 'live-font-mount-root-r1,live-font-mount-settings-s1'
    const { verdict, checks } = evaluateLiveFontChange({
      ...change,
      earlier: [earlierLeg],
    })
    assert.equal(checks.identity.rootKept, false)
    assert.notEqual(verdict, 'fixed')
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
  // The stale miss keys of the Story 6.8 Home residual, as the oracle reports them, each with
  // its stage: every miss of this leg is a cold parity miss.
  const STALE_KEYS = evaluateLiveFontChange(bugChange())
    .checks.coldParity.misses.map((miss) => `cold:${miss.key}`)
    .sort()
  const TZ = 'America/Chicago'
  const BANNER = 'out-of-date'
  // R2-05: the Story 6.8 Home residual as a reviewed baseline would describe it.
  const BASELINE = {
    timezone: TZ,
    weatherBanner: BANNER,
    staleKeys: STALE_KEYS,
    review: {
      verdict: 'known-residual',
      structuralPass: true,
      everyMissStale: true,
      growthFailing: ['current-condition'],
      controlPass: true,
    },
  }
  const attempt =
    (residualBaseline, timezone = TZ, weatherBanner = BANNER, change = bugChange()) =>
    () =>
      assertLiveFontProof({
        reactNativeVersion: '0.81.5',
        residualBaseline,
        timezone,
        weatherBanner,
        ...change,
      })
  const refused = (pattern) => (error) =>
    error.code === 'live_font_residual_unapproved' && pattern.test(error.message)
  const differs = (pattern) => (error) =>
    error.code === 'live_font_residual_environment_differs' && pattern.test(error.message)
  const unlabeled = STALE_KEYS.filter((key) => key.startsWith('cold:["",'))

  test('the residual has 41 stale keys, two of them labeled, and no key twice', () => {
    assert.equal(STALE_KEYS.length, 41)
    assert.deepEqual(
      STALE_KEYS.filter((key) => !key.startsWith('cold:["",')),
      [
        'cold:["current-condition","t-c63401aba20f"]#0',
        'cold:["outfit-comfort-notes","t-cf83675a2f00"]#0',
      ]
    )
    const { checks } = evaluateLiveFontChange(bugChange())
    assert.deepEqual(proposedResidualEntry(checks, bugChange()).staleKeys, STALE_KEYS)
    assert.equal(new Set(STALE_KEYS).size, 41)
  })

  test('below 0.87 a residual passes only inside its reviewed baseline', () => {
    const result = attempt(BASELINE)()
    assert.equal(result.verdict, 'known-residual')
    assert.equal(result.baselineReview, false)
    assert.throws(
      () =>
        assertLiveFontProof({
          reactNativeVersion: '0.81.5',
          timezone: TZ,
          weatherBanner: BANNER,
          ...bugChange(),
        }),
      refused(/no reviewed baseline/)
    )
    // The keys may come in any order; the compare sorts them.
    assert.doesNotThrow(attempt({ ...BASELINE, staleKeys: [...STALE_KEYS].reverse() }))
  })

  // TEA, 2026-11-13: an entry approves only in the timezone it was approved in, checked before
  // its keys.
  test('an entry approves only in the run timezone, and one with none approves nothing', () => {
    assert.doesNotThrow(attempt(BASELINE, TZ))
    assert.throws(
      attempt(BASELINE, 'Europe/Istanbul'),
      differs(/baseline timezone America\/Chicago, run timezone Europe\/Istanbul/)
    )
    const noZone = { ...BASELINE }
    delete noZone.timezone
    assert.throws(attempt(noZone), differs(/baseline timezone missing/))
    assert.throws(attempt({ ...BASELINE, timezone: '' }), differs(/baseline timezone/))
    assert.throws(attempt(BASELINE, null), differs(/run timezone missing/))
    // The timezone is checked first: a wrong one fails there even with broken keys.
    assert.throws(
      attempt({ ...BASELINE, staleKeys: 'all' }, 'UTC'),
      differs(/run timezone UTC/)
    )
  })

  // TEA, 2026-11-13: a proposal committed verbatim approves nothing when one of its review facts
  // breaks the six approval rules, and growth may fail only on a probe the entry names.
  test('an entry whose review facts break an approval rule approves nothing', () => {
    const broken = {
      verdict: 'restored',
      structuralPass: false,
      everyMissStale: false,
      controlPass: false,
      growthFailing: ['current-temperature'],
    }
    for (const [fact, value] of Object.entries(broken))
      assert.throws(
        attempt({ ...BASELINE, review: { ...BASELINE.review, [fact]: value } }),
        refused(new RegExp(`approval rules: ${fact}`)),
        fact
      )
    const withoutReview = { ...BASELINE }
    delete withoutReview.review
    assert.throws(attempt(withoutReview), refused(/approval rules/))
    // current-condition fails growth, and no key names it.
    assert.throws(
      attempt({
        ...BASELINE,
        staleKeys: STALE_KEYS.filter(
          (key) => !key.startsWith('cold:["current-condition"')
        ),
        review: { ...BASELINE.review, growthFailing: [] },
      }),
      refused(/growth fails outside baseline: current-condition/)
    )
  })

  // Antigravity r30 item 2: the run's failing growth probes equal the entry's growthFailing as a
  // sorted multiset, beside each failing probe being an id the keys name.
  test('an entry whose growthFailing differs from the run, extra or missing, approves nothing', () => {
    const growing = (growthFailing) => ({
      ...BASELINE,
      review: { ...BASELINE.review, growthFailing },
    })
    assert.doesNotThrow(attempt(growing(['current-condition'])))
    // The run fails current-condition and the entry lists no growth failure.
    assert.throws(
      attempt(growing([])),
      refused(
        /growth failing differs from baseline; failing in run only: current-condition$/
      )
    )
    // outfit-comfort-notes is a key id, so the review facts hold, and the run never fails it.
    assert.throws(
      attempt(growing(['current-condition', 'outfit-comfort-notes'])),
      refused(
        /growth failing differs from baseline; failing in baseline only: outfit-comfort-notes$/
      )
    )
    // A multiset: the same probe twice is one too many.
    assert.throws(
      attempt(growing(['current-condition', 'current-condition'])),
      refused(/failing in baseline only: current-condition$/)
    )
    assert.throws(
      attempt(growing(['outfit-comfort-notes'])),
      refused(
        /failing in run only: current-condition; failing in baseline only: outfit-comfort-notes$/
      )
    )
  })

  // Antigravity r30 item 2: a key keeps its stage, so the same text moving between the cold and
  // the updated parity is a new residual.
  test('a key moved from the cold to the updated stage with the same text approves nothing', () => {
    // The update re-used the 1.0 measurements too: every miss shows in both stages.
    const twoStage = () => ({
      ...bugChange(),
      updated: stage('settled'),
      coldUpdated: cold(),
    })
    const { checks } = evaluateLiveFontChange(twoStage())
    const proposal = proposedResidualEntry(checks, twoStage())
    const entry = { ...BASELINE, staleKeys: proposal.staleKeys }
    assert.equal(entry.staleKeys.length, 82)
    assert.equal(entry.staleKeys.filter((key) => key.startsWith('updated:')).length, 41)
    assert.doesNotThrow(attempt(entry, TZ, BANNER, twoStage()))
    const moved = entry.staleKeys.indexOf(STALE_KEYS[0])
    const staleKeys = entry.staleKeys.map((key, index) =>
      index === moved ? key.replace(/^cold:/, 'updated:') : key
    )
    // With the stages stripped the two lists are one multiset; with them they differ.
    const bare = (keys) => keys.map((key) => key.replace(/^(cold|updated):/, '')).sort()
    assert.deepEqual(bare(staleKeys), bare(entry.staleKeys))
    const escaped = STALE_KEYS[0].replace(/[[\]]/g, '\\$&')
    assert.throws(
      attempt({ ...entry, staleKeys }, TZ, BANNER, twoStage()),
      refused(
        new RegExp(
          `stale key outside baseline: ${escaped}; baseline key no miss hit: updated:.*; 1 extra, 1 missing`
        )
      )
    )
  })

  // TEA ruling on Antigravity r30 item 1: the out-of-date forecast notice is part of the
  // environment an entry is approved in, checked before its keys.
  test('an entry approves only with the run weather banner, as the captures show it', () => {
    assert.throws(
      attempt(BASELINE, TZ, 'none'),
      differs(/baseline weather banner out-of-date, run weather banner none/)
    )
    assert.throws(attempt(BASELINE, TZ, null), differs(/run weather banner missing/))
    const noBanner = { ...BASELINE }
    delete noBanner.weatherBanner
    assert.throws(attempt(noBanner), differs(/baseline weather banner missing/))
    // Checked before the keys: broken keys still fail on the banner.
    assert.throws(
      attempt({ ...BASELINE, staleKeys: 'all' }, TZ, 'none'),
      differs(/run weather banner none/)
    )
    // A screen that renders the banner must show the entry's state in its before and settled
    // captures, whatever state the run says it set up.
    const showing = (change) => {
      for (const capture of [
        change.before,
        change.immediate,
        change.settled,
        change.cold,
      ]) {
        capture.controls = [{ id: WEATHER_BANNER_MARKER, bounds: '[42,677][1038,851]' }]
        capture.nodes.push({
          id: '',
          text: WEATHER_STALE_TEXT,
          bounds: '[81,716][999,812]',
        })
      }
      return change
    }
    const banner = () => showing({ ...bugChange(), bannerMarker: WEATHER_BANNER_MARKER })
    assert.doesNotThrow(attempt(BASELINE, TZ, BANNER, banner()))
    const plain = { ...bugChange(), bannerMarker: WEATHER_BANNER_MARKER }
    assert.throws(
      attempt(BASELINE, TZ, BANNER, plain),
      differs(/baseline weather banner out-of-date, before capture shows none/)
    )
    // The settled screen lost the banner view: its text alone is another state.
    const lost = banner()
    lost.settled.controls = []
    assert.throws(
      attempt(BASELINE, TZ, BANNER, lost),
      differs(/baseline weather banner out-of-date, settled capture shows other/)
    )
    // The cold capture lost the banner (Antigravity r31): the cold launch is a stage too.
    const coldLost = banner()
    coldLost.cold.controls = []
    coldLost.cold.nodes = coldLost.cold.nodes.filter(
      (node) => node.text !== WEATHER_STALE_TEXT
    )
    assert.throws(
      attempt(BASELINE, TZ, BANNER, coldLost),
      differs(/baseline weather banner out-of-date, cold capture shows none/)
    )
    // The updated capture is not read: the Community update shows every band, which hides it.
    const updatedHides = {
      ...banner(),
      updated: stage('settled'),
      coldUpdated: cold(),
    }
    const twoStage = proposedResidualEntry(
      evaluateLiveFontChange(updatedHides).checks,
      updatedHides
    )
    assert.doesNotThrow(
      attempt({ ...BASELINE, staleKeys: twoStage.staleKeys }, TZ, BANNER, updatedHides)
    )
    const quiet = { ...BASELINE, weatherBanner: 'none' }
    assert.throws(
      attempt(quiet, TZ, 'none', banner()),
      differs(/baseline weather banner none, before capture shows out-of-date/)
    )
    // A screen without the banner (Home, Settings) is judged on the run's state alone.
    assert.doesNotThrow(attempt(quiet, TZ, 'none', bugChange()))
  })

  // TEA ruling on Antigravity r28: rule 6, keys exact. Every stale miss key, duplicates kept,
  // must be listed, and nothing else.
  test('an entry with an extra, missing, swapped or miscounted key approves nothing', () => {
    assert.doesNotThrow(attempt(BASELINE))
    assert.throws(
      attempt({ ...BASELINE, staleKeys: [...STALE_KEYS, 'cold:["","Language"]#0'] }),
      refused(/baseline key no miss hit: cold:\["","Language"\]#0; 0 extra, 1 missing/)
    )
    const dropped = unlabeled[3]
    assert.throws(
      attempt({ ...BASELINE, staleKeys: STALE_KEYS.filter((key) => key !== dropped) }),
      refused(
        new RegExp(
          `stale key outside baseline: ${dropped.replace(/[[\]]/g, '\\$&')}; 1 extra, 0 missing`
        )
      )
    )
    // A duplicate of a listed key is one key too many.
    assert.throws(
      attempt({ ...BASELINE, staleKeys: [...STALE_KEYS, STALE_KEYS[0]] }),
      refused(/baseline key no miss hit: .*; 0 extra, 1 missing/)
    )
    // Only the key for the failing growth probe: every other miss is outside the entry.
    assert.throws(
      attempt({
        ...BASELINE,
        staleKeys: ['cold:["current-condition","t-c63401aba20f"]#0'],
      }),
      refused(/40 extra, 0 missing/)
    )
  })

  // The case the old ids-plus-count entry let through: one unlabeled text traded for another
  // keeps the ids ('' and the two labeled ones) and the count (41), and must now fail.
  test('an equal-count swap between unlabeled texts approves nothing', () => {
    const swapped = STALE_KEYS.map((key) =>
      key === unlabeled[0] ? 'cold:["","Elsewhere"]#0' : key
    )
    assert.equal(swapped.length, STALE_KEYS.length)
    const ids = (keys) => [
      ...new Set(keys.map((key) => JSON.parse(key.slice(5, key.lastIndexOf('#')))[0])),
    ]
    assert.deepEqual(ids(swapped), ids(STALE_KEYS))
    assert.throws(
      attempt({ ...BASELINE, staleKeys: swapped }),
      refused(
        /stale key outside baseline: .*baseline key no miss hit: cold:\["","Elsewhere"\]#0/
      )
    )
  })

  test('an entry whose staleKeys is no list of miss keys approves nothing', () => {
    const shape = /baseline staleKeys must be a list of keys/
    for (const staleKeys of [undefined, 'all', 41, { 0: STALE_KEYS[0] }])
      assert.throws(
        attempt({ ...BASELINE, staleKeys }),
        refused(shape),
        String(staleKeys)
      )
    for (const member of [
      7,
      null,
      ['', 'Home'],
      'Home',
      '["","Home"]',
      'Home#0',
      '"x"#0',
      // A key needs its stage, and only cold: or updated: name one.
      '["","Home"]#0',
      'settled:["","Home"]#0',
      'Cold:["","Home"]#0',
      'cold:["","Home"]',
      'cold:Home#0',
      'cold:"x"#0',
      'updated:',
    ])
      assert.throws(
        attempt({ ...BASELINE, staleKeys: [...STALE_KEYS, member] }),
        refused(shape),
        JSON.stringify(member)
      )
    const noKeys = { ...BASELINE }
    delete noKeys.staleKeys
    assert.throws(attempt(noKeys), refused(shape))
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

// TEA ruling on Antigravity r30 item 1: the hourly ribbon labels follow the clock the run starts
// at, so a residual entry keys them as one token, indexed by place.
describe('hour labels in residual entry keys', () => {
  const NNBSP = '\u202f'
  test('HOUR_LABEL takes only the ribbon format: 1 to 12, a narrow no-break space, AM or PM', () => {
    for (const label of ['1', '9', '10', '12'].flatMap((hour) => [
      `${hour}${NNBSP}AM`,
      `${hour}${NNBSP}PM`,
    ]))
      assert.ok(HOUR_LABEL.test(label), label)
    for (const text of [
      '1 AM',
      `1${NNBSP}am`,
      'Expand (48h)',
      `10${NNBSP}AM meeting`,
      'AM',
      `${NNBSP}AM`,
      `13${NNBSP}PM`,
      `0${NNBSP}AM`,
      `01${NNBSP}AM`,
      `1:00${NNBSP}AM`,
      `10:30${NNBSP}PM`,
      `1${NNBSP}AM `,
      `1${NNBSP}${NNBSP}AM`,
      '68°F',
    ])
      assert.equal(HOUR_LABEL.test(text), false, JSON.stringify(text))
  })

  /** A ribbon of hour labels from `first`, one per 100 px, with a temperature under each. */
  const ribbon = (first, count = 3, { id = '', top = 900 } = {}) => ({
    nodes: Array.from({ length: count }, (_, index) => [
      {
        id,
        text: `${((first + index - 1) % 12) + 1}${NNBSP}AM`,
        bounds: `[${index * 100},${top}][${index * 100 + 80},${top + 40}]`,
      },
      {
        id: '',
        text: '68°F',
        bounds: `[${index * 100},${top + 50}][${index * 100 + 80},${top + 90}]`,
      },
    ]).flat(),
  })
  const keyOf = (id, text, n = 0) => `${JSON.stringify([id, text])}#${n}`
  const checksMissing = (keys) => ({
    coldParity: { misses: keys.map((key) => ({ key })) },
  })

  test('an hour label becomes <hour> with its place among the hour labels, other text stays', () => {
    const settled = ribbon(1)
    const keys = stageKeys(
      checksMissing([
        keyOf('', `1${NNBSP}AM`),
        keyOf('', `3${NNBSP}AM`),
        keyOf('', '68°F', 2),
      ]),
      { settled }
    )
    assert.deepEqual(keys, [
      'cold:["","68°F"]#2',
      'cold:["","<hour>"]#0',
      'cold:["","<hour>"]#2',
    ])
    // A stale hour label is still a stale key: the masked key keeps one entry per miss.
    assert.equal(keys.filter((key) => key.includes('<hour>')).length, 2)
  })

  test('the same misses an hour later give the same keys; a moved or extra miss does not', () => {
    const at1 = stageKeys(
      checksMissing([keyOf('', `1${NNBSP}AM`), keyOf('', `3${NNBSP}AM`)]),
      { settled: ribbon(1) }
    )
    const at2 = stageKeys(
      checksMissing([keyOf('', `2${NNBSP}AM`), keyOf('', `4${NNBSP}AM`)]),
      { settled: ribbon(2) }
    )
    assert.deepEqual(at2, at1)
    // The second label stale in place of the third is another position.
    const moved = stageKeys(
      checksMissing([keyOf('', `2${NNBSP}AM`), keyOf('', `3${NNBSP}AM`)]),
      { settled: ribbon(2) }
    )
    assert.deepEqual(moved, ['cold:["","<hour>"]#0', 'cold:["","<hour>"]#1'])
    assert.notDeepEqual(moved, at1)
    const more = stageKeys(
      checksMissing([
        keyOf('', `2${NNBSP}AM`),
        keyOf('', `3${NNBSP}AM`),
        keyOf('', `4${NNBSP}AM`),
      ]),
      { settled: ribbon(2) }
    )
    assert.equal(more.length, 3)
  })

  test('repeated hour texts get distinct indexes in screen order, whatever the node order', () => {
    // An expanded 48 h ribbon shows 1 AM twice: two rows, same text, #0 and #1 as parity keys.
    const twoRows = {
      nodes: [...ribbon(1, 2, { top: 1200 }).nodes, ...ribbon(1, 2, { top: 900 }).nodes],
    }
    const misses = checksMissing([
      keyOf('', `1${NNBSP}AM`, 1),
      keyOf('', `2${NNBSP}AM`, 0),
    ])
    const keys = stageKeys(misses, { settled: twoRows })
    // Row one (top 900) holds <hour>#0 and #1, row two #2 and #3; the second 1 AM is #2.
    assert.deepEqual(keys, ['cold:["","<hour>"]#1', 'cold:["","<hour>"]#2'])
    const shuffled = { nodes: [...twoRows.nodes].reverse() }
    assert.deepEqual(stageKeys(misses, { settled: shuffled }), keys)
    // Indexes count per testID.
    const labeled = {
      nodes: [...ribbon(1, 2).nodes, ...ribbon(5, 1, { id: 'x', top: 1500 }).nodes],
    }
    assert.deepEqual(
      stageKeys(checksMissing([keyOf('x', `5${NNBSP}AM`), keyOf('', `2${NNBSP}AM`)]), {
        settled: labeled,
      }),
      ['cold:["","<hour>"]#1', 'cold:["x","<hour>"]#0']
    )
  })

  test('each stage masks against its own capture and keeps its prefix', () => {
    const checks = {
      coldParity: { misses: [{ key: keyOf('', `1${NNBSP}AM`) }] },
      postUpdateParity: { misses: [{ key: keyOf('', `3${NNBSP}AM`) }] },
    }
    assert.deepEqual(stageKeys(checks, { settled: ribbon(1), updated: ribbon(2) }), [
      'cold:["","<hour>"]#0',
      'updated:["","<hour>"]#1',
    ])
  })

  test('a miss the capture does not hold fails loudly', () => {
    assert.throws(
      () => stageKeys(checksMissing([keyOf('', `9${NNBSP}AM`)]), { settled: ribbon(1) }),
      { code: 'live_font_miss_capture_required' }
    )
    assert.throws(() => stageKeys(checksMissing([keyOf('', 'Home')]), {}), {
      code: 'live_font_miss_capture_required',
    })
  })
})

describe('weatherBannerState', () => {
  const marker = { id: WEATHER_BANNER_MARKER, bounds: '[42,677][1038,851]' }
  const text = { id: '', text: WEATHER_STALE_TEXT, bounds: '[81,716][999,812]' }
  test('reads out-of-date, none or other from the banner view and its text', () => {
    assert.equal(weatherBannerState({ controls: [marker], nodes: [text] }), 'out-of-date')
    assert.equal(
      weatherBannerState({
        controls: [marker],
        nodes: [],
        fullText: [JSON.stringify(['', WEATHER_STALE_TEXT])],
      }),
      'out-of-date'
    )
    assert.equal(weatherBannerState({ controls: [], nodes: [] }), 'none')
    assert.equal(weatherBannerState(undefined), 'none')
    // The banner with another reason, or the text without the banner view.
    assert.equal(
      weatherBannerState({
        controls: [marker],
        nodes: [{ ...text, text: 'Add your location to see looks near you.' }],
      }),
      'other'
    )
    assert.equal(weatherBannerState({ controls: [], nodes: [text] }), 'other')
  })
})
