// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Oracle for the Story 6.15 live font-scale proof (AC3, TEA-01 to TEA-03). A capture is one
// screen at one moment:
//   { stage, fontScale, pid, nodes: [{ text, id, bounds }], fullText?: [identity] }
// `nodes` is the visible text in screen coordinates (Android px, iOS pt). `fullText` is the
// screen's text multiset gathered by scrolling through it; it falls back to `nodes` for a screen
// that does not scroll. Stages: `before` (live, base scale), `immediate` and `settled` (live,
// target scale), `cold` (a fresh launch at the target scale).
//
// React Native 0.87.0 is the first stable release with commit 45904c8, the Fabric fix for text
// keeping the font scale it was first measured at. Below it the oracle expects the Story 6.8 bug
// signature and passes on it, so any other outcome, an early fix included, is red. Step 4 of the
// story deletes that branch.

const FIX_VERSION = [0, 87, 0]

/** Height tolerance between live and cold layout: 2 px on Android, 1 pt on iOS. */
export const HEIGHT_TOLERANCE = { android: 2, ios: 1 }
/** A grown single line must reach this share of the scale ratio. */
export const GROWTH_FLOOR = 0.9
/** Heights within this ratio of 1 count as unchanged when matching the 6.8 bug signature. */
const UNCHANGED_RATIO = 0.02

const SYSTEM_UI = /^com\.android\.systemui:/

function fail(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code)
  error.code = code
  throw error
}

/** True when the bundled React Native carries the font-scale layout fix (0.87.0 or above). */
export function fixExpectedFor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(String(version ?? ''))
  if (!match) fail('live_font_rn_version_required', String(version))
  const parts = match.slice(1, 4).map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (parts[index] !== FIX_VERSION[index]) return parts[index] > FIX_VERSION[index]
  }
  // A prerelease of 0.87.0 sorts below the stable release the story names.
  return match[4] === undefined
}

export function parseBounds(bounds) {
  if (Array.isArray(bounds) && bounds.length === 4) return bounds.map(Number)
  const match =
    /^\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]$/.exec(
      String(bounds ?? '')
    )
  if (!match) fail('live_font_bounds_required', String(bounds))
  const [left, top, right, bottom] = match.slice(1).map(Number)
  if (right < left || bottom < top) fail('live_font_bounds_required', String(bounds))
  return [left, top, right, bottom]
}

function appNodes(capture) {
  return (capture.nodes ?? []).filter(
    (node) =>
      typeof node.text === 'string' && node.text !== '' && !SYSTEM_UI.test(node.id ?? '')
  )
}

function identity(node) {
  return JSON.stringify([node.id ?? '', node.text])
}

/**
 * Visible app text keyed by identity plus occurrence, ordered top to bottom then left to right,
 * so the same label repeated (an hourly "57°F") pairs with its own counterpart.
 */
function keyed(capture) {
  const ordered = appNodes(capture)
    .map((node) => ({ ...node, box: parseBounds(node.bounds) }))
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
  const seen = new Map()
  const result = new Map()
  for (const node of ordered) {
    const base = identity(node)
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    result.set(`${base}#${occurrence}`, node)
  }
  return result
}

function multiset(capture) {
  return [...(capture.fullText ?? appNodes(capture).map(identity))].sort()
}

function height(node) {
  return node.box[3] - node.box[1]
}

function sameMultiset(a, b) {
  return a.length > 0 && JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The five AC3 checks for one screen and one scale change. `anchors` are testIDs that sit above
 * the fold at every scale; `probes` are testIDs of single-line text used to measure growth.
 */
export function evaluateLiveFontChange({
  platform,
  before,
  immediate,
  settled,
  cold,
  anchors,
  probes,
}) {
  const tolerance = HEIGHT_TOLERANCE[platform]
  if (tolerance === undefined) fail('live_font_platform_required', String(platform))
  if (!anchors?.length) fail('live_font_anchors_required')
  if (!probes?.length) fail('live_font_probes_required')
  const scaleRatio = Number(settled.fontScale) / Number(before.fontScale)
  if (!(scaleRatio > 0) || scaleRatio === 1) fail('live_font_scale_change_required')
  if (Number(cold.fontScale) !== Number(settled.fontScale))
    fail('live_font_cold_scale_mismatch')

  const stages = { before, immediate, settled }
  const missingAnchors = []
  for (const [stage, capture] of Object.entries(stages)) {
    const ids = new Set(appNodes(capture).map((node) => node.id))
    for (const anchor of anchors)
      if (!ids.has(anchor)) missingAnchors.push(`${stage}:${anchor}`)
  }

  const live = keyed(settled)
  const coldNodes = keyed(cold)
  const parityMisses = []
  let parityCompared = 0
  for (const [key, node] of live) {
    const counterpart = coldNodes.get(key)
    if (!counterpart) continue
    parityCompared += 1
    const delta = Math.abs(height(node) - height(counterpart))
    if (delta > tolerance)
      parityMisses.push({ key, live: height(node), cold: height(counterpart) })
  }

  const base = keyed(before)
  const growth = probes.map((probe) => {
    const find = (map) => [...map.values()].find((node) => node.id === probe)
    const from = find(base)
    const to = find(live)
    if (!from || !to) return { probe, ratio: null }
    return { probe, ratio: height(to) / height(from) }
  })
  const pids = new Set([before.pid, immediate.pid, settled.pid].map(String))

  const checks = {
    anchors: { pass: missingAnchors.length === 0, missing: missingAnchors },
    fullText: {
      pass: sameMultiset(multiset(before), multiset(settled)),
      before: multiset(before).length,
      settled: multiset(settled).length,
    },
    coldParity: {
      pass: parityCompared > 0 && parityMisses.length === 0,
      compared: parityCompared,
      misses: parityMisses,
    },
    growth: {
      pass: growth.every(
        ({ ratio }) => ratio !== null && ratio >= GROWTH_FLOOR * scaleRatio
      ),
      scaleRatio,
      probes: growth,
    },
    process: { pass: pids.size === 1 && !pids.has('undefined'), pids: [...pids] },
  }
  return { checks, verdict: classify(checks) }
}

function classify(checks) {
  const all = Object.values(checks).every((check) => check.pass)
  if (all) return 'fixed'
  const unchanged = checks.growth.probes.every(
    ({ ratio }) => ratio !== null && Math.abs(ratio - 1) <= UNCHANGED_RATIO
  )
  if (
    checks.anchors.pass &&
    checks.fullText.pass &&
    checks.process.pass &&
    !checks.growth.pass &&
    unchanged &&
    !checks.coldParity.pass
  )
    return 'bug-signature'
  return 'unexpected'
}

/**
 * The proof's pass rule. With the fix bundled the screen must relayout; without it the screen
 * must show the Story 6.8 signature (text kept, heights frozen, cold launch differs).
 */
export function assertLiveFontProof({ reactNativeVersion, ...change }) {
  const fixExpected = fixExpectedFor(reactNativeVersion)
  const result = evaluateLiveFontChange(change)
  const expected = fixExpected ? 'fixed' : 'bug-signature'
  if (result.verdict !== expected) {
    const failing = Object.entries(result.checks)
      .filter(([, check]) => !check.pass)
      .map(([name]) => name)
    fail(
      fixExpected ? 'live_font_fix_missing' : 'live_font_bug_signature_missing',
      `verdict ${result.verdict}; failing ${failing.join(',') || 'none'}`
    )
  }
  return { ...result, fixExpected }
}

/**
 * F-01 positive control: two cold launches, base and target scale, must keep the full text and
 * grow every probe. A pass here shows the oracle can see growth before it judges a live change.
 */
export function assertColdControl({ platform, base, target, probes }) {
  if (HEIGHT_TOLERANCE[platform] === undefined)
    fail('live_font_platform_required', String(platform))
  const scaleRatio = Number(target.fontScale) / Number(base.fontScale)
  if (!(scaleRatio > 1)) fail('live_font_scale_change_required')
  if (!sameMultiset(multiset(base), multiset(target)))
    fail('live_font_control_text_changed')
  const from = keyed(base)
  const to = keyed(target)
  const ratios = probes.map((probe) => {
    const a = [...from.values()].find((node) => node.id === probe)
    const b = [...to.values()].find((node) => node.id === probe)
    if (!a || !b) fail('live_font_control_probe_missing', probe)
    return { probe, ratio: height(b) / height(a) }
  })
  if (ratios.some(({ ratio }) => ratio < GROWTH_FLOOR * scaleRatio))
    fail('live_font_control_no_growth', JSON.stringify(ratios))
  return { scaleRatio, ratios }
}
