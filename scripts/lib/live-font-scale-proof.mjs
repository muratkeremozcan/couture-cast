// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Oracle for the Story 6.15 live font-scale proof (AC3; TEA-01 to TEA-03; Codex review 1, 2, 7,
// 12). A capture is one screen at one moment:
//   { stage, fontScale, pid, identity: { activity?, root }, nodes: [node], fullText?, controls? }
//   node: { text, id, bounds, parent? }   bounds and parent as "[l,t][r,b]" or [l, t, r, b]
// `nodes` is the visible text in screen coordinates (Android px, iOS pt) with the bounds of each
// node's parent view. `fullText` is the screen's text gathered by scrolling through it; it falls
// back to `nodes` for a screen that does not scroll. `identity.activity` is the Android Activity
// token; `identity.root` is the mount marker the app renders in test builds. Stages: `before`
// (live, base scale), `immediate` and `settled` (live, target scale), `cold` (fresh launch at the
// target scale), and optionally `updated` and `coldUpdated`: the same React state change made
// after the live change and after the cold launch.
//
// A surviving text tree is what the proof tests, so a recreated Activity or a remounted root
// gets its own verdict, `restored`, which never counts as a fix. React Native 0.87.0 is the first
// stable release with commit 45904c8 (text keeping a stale font scale across later commits).
// From 0.87 the screen must be `fixed`. Below it the oracle records what it sees: `fixed` passes
// and flags the baseline for review; `known-residual` (heights stale against the cold reference,
// nothing else wrong) passes only when a reviewed baseline entry for that platform, build and
// screen allows exactly those stale nodes (scripts/lib/fixtures/live-font-residual-baselines.json);
// anything else fails. Required controls must stay on screen in every class.

const FIX_VERSION = [0, 87, 0]

/** Height tolerance between two layouts: 2 px on Android, 1 pt on iOS. */
export const HEIGHT_TOLERANCE = { android: 2, ios: 1 }
/** Below this the expected scale counts as unchanged (large Android text, for one). */
const UNCHANGED_RATIO = 0.03
/** How far a cold control's measured ratio may sit from the platform's expected ratio. */
const CONTROL_RATIO_TOLERANCE = 0.08
const SYSTEM_UI = /^com\.android\.systemui:/

/**
 * AOSP FontScaleConverterFactory lookup tables (Android 14 and later scale text nonlinearly).
 * Sizes in sp map to dp; between table points the platform interpolates linearly, below the
 * first it interpolates from zero, and past the last it keeps the last point's ratio. A scale
 * between two tables blends them; a scale outside the tables (below 1.05, above 2) is linear.
 */
const ANDROID_FROM_SP = [8, 10, 12, 14, 18, 20, 24, 30, 100]
const ANDROID_TABLES = {
  1.05: [8.4, 10.5, 12.6, 14.8, 18.6, 20.6, 24.4, 30, 100],
  1.1: [8.8, 11, 13.2, 15.6, 19.2, 21.2, 24.8, 30, 100],
  1.15: [9.2, 11.5, 13.8, 16.4, 19.8, 21.8, 25.2, 30, 100],
  1.2: [9.6, 12, 14.4, 17.2, 20.4, 22.4, 25.6, 30, 100],
  1.3: [10.4, 13, 15.6, 18.8, 21.6, 23.6, 26.4, 30, 100],
  1.5: [12, 15, 18, 22, 24, 26, 28, 30, 100],
  1.8: [14.4, 18, 21.6, 24.4, 27.6, 30.8, 32.8, 34.8, 100],
  2: [16, 20, 24, 26, 30, 34, 36, 38, 100],
}

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

function interpolate(fromValues, toValues, value) {
  const last = fromValues.length - 1
  if (value >= fromValues[last]) return (value * toValues[last]) / fromValues[last]
  if (value <= fromValues[0]) return (value * toValues[0]) / fromValues[0]
  const index = fromValues.findIndex((point) => value <= point)
  const [x0, x1] = [fromValues[index - 1], fromValues[index]]
  const [y0, y1] = [toValues[index - 1], toValues[index]]
  return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0)
}

/** Rendered size in dp for `sp` at an Android font scale, as the platform converts it. */
export function androidScaledSize(sp, fontScale) {
  const scale = Number(fontScale)
  if (!(sp > 0) || !(scale > 0))
    fail('live_font_text_size_required', `${sp}@${fontScale}`)
  const known = Object.keys(ANDROID_TABLES)
    .map(Number)
    .sort((a, b) => a - b)
  const at = (value) => interpolate(ANDROID_FROM_SP, ANDROID_TABLES[value], sp)
  if (known.includes(scale)) return at(scale)
  const upper = known.find((value) => value > scale)
  const lower = [...known].reverse().find((value) => value < scale)
  // Outside the tables the platform falls back to a linear table.
  if (upper === undefined || lower === undefined) return sp * scale
  return at(lower) + ((scale - lower) * (at(upper) - at(lower))) / (upper - lower)
}

/**
 * The ratio a text box should change by. Android converts each size through its nonlinear
 * curve, so a probe declares the size that sets its line box (`lineHeight` when the style sets
 * one, else `fontSize`); before Android 14 the scale is linear. React Native on iOS multiplies every size by the content-size
 * category's multiplier, so the ratio is the multiplier ratio whatever the text style.
 */
export function expectedTextRatio({ platform, sizeSp, from, to, androidApi = 34 }) {
  if (platform === 'ios') return Number(to) / Number(from)
  if (platform !== 'android') fail('live_font_platform_required', String(platform))
  // Nonlinear scaling arrived in Android 14 (API 34); earlier releases scale linearly.
  if (Number(androidApi) < 34) return Number(to) / Number(from)
  return androidScaledSize(sizeSp, to) / androidScaledSize(sizeSp, from)
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
  return (capture?.nodes ?? []).filter(
    (node) =>
      typeof node.text === 'string' && node.text !== '' && !SYSTEM_UI.test(node.id ?? '')
  )
}

function identityOf(node) {
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
    const base = identityOf(node)
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    result.set(`${base}#${occurrence}`, node)
  }
  return result
}

function multiset(capture) {
  const keys = capture.fullText ?? appNodes(capture).map(identityOf)
  return keys.filter((key) => !SYSTEM_UI.test(JSON.parse(key)[0])).sort()
}

const height = (node) => node.box[3] - node.box[1]

function sameMultiset(a, b) {
  return a.length > 0 && JSON.stringify(a) === JSON.stringify(b)
}

function findProbe(map, probe) {
  return [...map.values()].find((node) => node.id === probe.id)
}

/**
 * Live against cold heights for every node both show. A miss is stale when live kept `base`'s
 * height, or a height an `earlier` capture of the same launch measured for that text: the
 * measurement cache hands back a box it made at another scale.
 */
function parity(live, cold, base, tolerance, earlier = []) {
  const liveNodes = keyed(live)
  const coldNodes = keyed(cold)
  const baseNodes = keyed(base)
  const earlierNodes = earlier.map(keyed)
  const misses = []
  let compared = 0
  for (const [key, node] of liveNodes) {
    const counterpart = coldNodes.get(key)
    if (!counterpart) continue
    compared += 1
    if (Math.abs(height(node) - height(counterpart)) <= tolerance) continue
    const kept = (other) =>
      other !== undefined && Math.abs(height(node) - height(other)) <= tolerance
    const staleFrom = kept(baseNodes.get(key))
      ? 'before'
      : earlierNodes.some((nodes) => kept(nodes.get(key)))
        ? 'earlier'
        : undefined
    misses.push({
      key,
      live: height(node),
      cold: height(counterpart),
      stale: staleFrom !== undefined,
      ...(staleFrom ? { staleFrom } : {}),
    })
  }
  return { pass: compared > 0 && misses.length === 0, compared, misses }
}

/** A text box that leaves its parent view is clipped, whatever its own height says. */
function clipping(capture, tolerance) {
  const clipped = []
  for (const node of appNodes(capture)) {
    if (node.parent === undefined) continue
    const [left, top, right, bottom] = parseBounds(node.bounds)
    const [pl, pt, pr, pb] = parseBounds(node.parent)
    if (
      left < pl - tolerance ||
      top < pt - tolerance ||
      right > pr + tolerance ||
      bottom > pb + tolerance
    )
      clipped.push({ id: node.id ?? '', text: node.text })
  }
  return { pass: clipped.length === 0, clipped }
}

/** Every required control is present and inside the window. */
function controlsOnScreen(capture, ids) {
  if (!ids.length) return { pass: true, missing: [] }
  const frame = capture.window ? parseBounds(capture.window) : undefined
  const missing = ids.filter((id) => {
    const control = (capture.controls ?? []).find((entry) => entry.id === id)
    if (!control) return true
    if (!frame) return false
    const box = parseBounds(control.bounds)
    return (
      box[0] < frame[0] || box[1] < frame[1] || box[2] > frame[2] || box[3] > frame[3]
    )
  })
  return { pass: missing.length === 0, missing }
}

/**
 * The same process, React root and (on Android) Activity across every live stage. Android must
 * supply its native evidence: an Activity token and an onCreate count at every stage, where an
 * unavailable count is `undefined` and never read as zero (Codex R4-05). iOS has no native
 * window identity in the hierarchy; a new scene or window mounts a new React root, so the mount
 * marker stands for it.
 */
function identityCheck(platform, stages) {
  const pids = new Set(stages.map((capture) => String(capture.pid)))
  const roots = stages.map((capture) => capture.identity?.root)
  const activities = stages.map((capture) => capture.identity?.activity)
  const onCreate = stages.map((capture) => capture.identity?.onCreate)
  const processKept = pids.size === 1 && !pids.has('undefined')
  const rootKnown = roots.every((root) => typeof root === 'string' && root !== '')
  const rootKept = rootKnown && new Set(roots).size === 1
  const nativeKnown =
    platform !== 'android' ||
    (activities.every((value) => typeof value === 'string' && value !== '') &&
      onCreate.every((value) => Number.isInteger(value)))
  const activityKept = new Set(activities).size === 1
  // A rise in MainActivity onCreate calls is a recreation even if a token read raced it.
  const created =
    nativeKnown && platform === 'android' ? onCreate.at(-1) - onCreate[0] : null
  return {
    pass: processKept && rootKept && nativeKnown && activityKept && !(created > 0),
    processKept,
    rootKnown,
    rootKept,
    nativeKnown,
    activityKept,
    activityChanged: !activityKept,
    onCreateDelta: created,
    pids: [...pids],
    roots,
    activities,
    onCreate,
  }
}

function assertChangeInputs({
  before,
  settled,
  cold,
  coldBefore,
  updated,
  coldUpdated,
  anchors,
  probes,
}) {
  if (!anchors?.length) fail('live_font_anchors_required')
  if (!probes?.length) fail('live_font_probes_required')
  if (Number(settled.fontScale) === Number(before.fontScale))
    fail('live_font_scale_change_required')
  if (Number(cold.fontScale) !== Number(settled.fontScale))
    fail('live_font_cold_scale_mismatch')
  if (coldBefore && Number(coldBefore.fontScale) !== Number(before.fontScale))
    fail('live_font_cold_before_scale_mismatch')
  if ((updated === undefined) !== (coldUpdated === undefined))
    fail('live_font_update_pair_required')
}

/**
 * The AC3 checks for one screen and one scale change. `anchors` are testIDs that sit above the
 * fold at every scale; `probes` ({ id, sizeSp }) are single-line text whose box should follow
 * the platform's text scaling. `earlier` holds the captures of the same launch's previous legs,
 * the heights a measurement cache could hand back. `coldBefore`, the cold launch at the leg's
 * starting scale, is where growth is measured from when given: a leg that starts on a stale screen (the return
 * after a residual) would otherwise read correct text as text that failed to change.
 */
export function evaluateLiveFontChange({
  platform,
  androidApi,
  before,
  immediate,
  settled,
  cold,
  coldBefore,
  earlier = [],
  updated,
  coldUpdated,
  anchors,
  probes,
  requiredControls = [],
}) {
  const tolerance = HEIGHT_TOLERANCE[platform]
  if (tolerance === undefined) fail('live_font_platform_required', String(platform))
  assertChangeInputs({
    before,
    settled,
    cold,
    coldBefore,
    updated,
    coldUpdated,
    anchors,
    probes,
  })

  const missingAnchors = []
  for (const [stage, capture] of Object.entries({ before, immediate, settled })) {
    const ids = new Set(appNodes(capture).map((node) => node.id))
    for (const anchor of anchors)
      if (!ids.has(anchor)) missingAnchors.push(`${stage}:${anchor}`)
  }

  const base = keyed(coldBefore ?? before)
  const live = keyed(settled)
  const coldNodes = keyed(cold)
  const growth = probes.map((probe) => {
    const expected = expectedTextRatio({
      platform,
      androidApi,
      sizeSp: probe.sizeSp,
      from: before.fontScale,
      to: settled.fontScale,
    })
    const [from, to, reference] = [base, live, coldNodes].map((map) =>
      findProbe(map, probe)
    )
    if (!from || !to || !reference)
      return { probe: probe.id, expected, ratio: null, pass: false }
    const ratio = height(to) / height(from)
    const matchesCold = Math.abs(height(to) - height(reference)) <= tolerance
    const direction =
      Math.abs(expected - 1) <= UNCHANGED_RATIO
        ? true
        : Math.sign(ratio - 1) === Math.sign(expected - 1) &&
          Math.abs(ratio - 1) > UNCHANGED_RATIO
    return {
      probe: probe.id,
      expected,
      ratio,
      coldRatio: height(reference) / height(from),
      pass: matchesCold && direction,
    }
  })

  const checks = {
    anchors: { pass: missingAnchors.length === 0, missing: missingAnchors },
    fullText: {
      pass: sameMultiset(multiset(before), multiset(settled)),
      before: multiset(before).length,
      settled: multiset(settled).length,
    },
    identity: identityCheck(platform, [
      before,
      immediate,
      settled,
      ...(updated ? [updated] : []),
    ]),
    coldParity: parity(settled, cold, before, tolerance, earlier),
    growth: { pass: growth.every((probe) => probe.pass), probes: growth },
    clipping: clipping(settled, tolerance),
    controls: controlsOnScreen(settled, requiredControls),
  }
  if (updated) {
    // Codex R4-04: the update must keep the screen whole, so it gets the structural checks and a
    // full comparison with the cold launch that made the same update.
    const coldKeys = [...keyed(coldUpdated).keys()].sort()
    const liveKeys = [...keyed(updated).keys()].sort()
    const postParity = parity(updated, coldUpdated, before, tolerance, earlier)
    checks.postUpdateParity = {
      ...postParity,
      pass: postParity.pass && JSON.stringify(coldKeys) === JSON.stringify(liveKeys),
      onlyLive: liveKeys.filter((key) => !coldKeys.includes(key)).length,
      onlyCold: coldKeys.filter((key) => !liveKeys.includes(key)).length,
    }
    checks.postUpdateFullText = {
      pass: sameMultiset(multiset(updated), multiset(coldUpdated)),
      updated: multiset(updated).length,
      cold: multiset(coldUpdated).length,
    }
    checks.postUpdateAnchors = {
      pass: anchors.every((anchor) =>
        appNodes(updated).some((node) => node.id === anchor)
      ),
    }
    checks.postUpdateControls = controlsOnScreen(updated, requiredControls)
    checks.postUpdateClipping = clipping(updated, tolerance)
  }
  return { checks, verdict: classify(checks) }
}

function recreated(identity) {
  return (
    identity.processKept &&
    identity.rootKnown &&
    (!identity.rootKept || !identity.activityKept || identity.onCreateDelta > 0)
  )
}

/** Failures that no residual explains: lost text or identity, off-screen controls, clipping. */
function structural(checks) {
  return [
    'anchors',
    'fullText',
    'identity',
    'controls',
    'clipping',
    'postUpdateClipping',
    'postUpdateFullText',
    'postUpdateAnchors',
    'postUpdateControls',
  ].some((name) => checks[name] && !checks[name].pass)
}

function classify(checks) {
  if (Object.values(checks).every((check) => check.pass)) return 'fixed'
  if (recreated(checks.identity)) return 'restored'
  if (structural(checks)) return 'unexpected'
  // What remains must be stale text: heights the live screen kept from the base scale while the
  // cold launch measured different ones.
  const misses = [...checks.coldParity.misses, ...(checks.postUpdateParity?.misses ?? [])]
  return misses.length > 0 && misses.every((miss) => miss.stale)
    ? 'known-residual'
    : 'unexpected'
}

const missId = (miss) => JSON.parse(miss.key.slice(0, miss.key.lastIndexOf('#')))[0]

/**
 * A residual passes only as a reviewed baseline entry describes it: `staleIds` lists the ids
 * (`''` for text without one) allowed to keep their base-scale height, and `maxStaleMisses`
 * bounds how many nodes may. Anything outside it is a new regression until it is reviewed.
 */
function residualApproved(checks, baseline) {
  if (!baseline) return { pass: false, reason: 'no reviewed baseline' }
  const misses = [...checks.coldParity.misses, ...(checks.postUpdateParity?.misses ?? [])]
  const outside = misses.filter((miss) => !baseline.staleIds.includes(missId(miss)))
  if (outside.length)
    return {
      pass: false,
      reason: `stale outside baseline: ${outside.map(missId).join(',')}`,
    }
  if (misses.length > baseline.maxStaleMisses)
    return {
      pass: false,
      reason: `${misses.length} stale nodes, baseline allows ${baseline.maxStaleMisses}`,
    }
  return { pass: true }
}

/**
 * The proof's pass rule. With the fix bundled the screen must relayout in place. Without it an
 * early correct relayout passes with `baselineReview` set, and a residual passes only within its
 * reviewed baseline; a restored screen or any other failure is red.
 */
export function assertLiveFontProof({ reactNativeVersion, residualBaseline, ...change }) {
  const fixExpected = fixExpectedFor(reactNativeVersion)
  const result = evaluateLiveFontChange(change)
  const failing = () =>
    Object.entries(result.checks)
      .filter(([, check]) => !check.pass)
      .map(([name]) => name)
      .join(',') || 'none'
  if (fixExpected && result.verdict !== 'fixed')
    fail('live_font_fix_missing', `verdict ${result.verdict}; failing ${failing()}`)
  if (!fixExpected && !['fixed', 'known-residual'].includes(result.verdict))
    fail(
      'live_font_baseline_unexpected',
      `verdict ${result.verdict}; failing ${failing()}`
    )
  if (!fixExpected && result.verdict === 'known-residual') {
    const approved = residualApproved(result.checks, residualBaseline)
    if (!approved.pass) fail('live_font_residual_unapproved', approved.reason)
  }
  return {
    ...result,
    fixExpected,
    baselineReview: !fixExpected && result.verdict === 'fixed',
  }
}

/**
 * F-01 positive control: two cold launches, base and target scale, must keep the full text and
 * move every probe by the platform's expected ratio, and at least one probe must be expected to
 * grow. A pass shows the oracle can see scaling, and that each probe's declared size is right,
 * before it judges a live change.
 */
export function assertColdControl({ platform, androidApi, base, target, probes }) {
  if (HEIGHT_TOLERANCE[platform] === undefined)
    fail('live_font_platform_required', String(platform))
  if (!(Number(target.fontScale) > Number(base.fontScale)))
    fail('live_font_scale_change_required')
  if (!sameMultiset(multiset(base), multiset(target)))
    fail('live_font_control_text_changed')
  const from = keyed(base)
  const to = keyed(target)
  const ratios = probes.map((probe) => {
    const a = findProbe(from, probe)
    const b = findProbe(to, probe)
    if (!a || !b) fail('live_font_control_probe_missing', probe.id)
    const expected = expectedTextRatio({
      platform,
      androidApi,
      sizeSp: probe.sizeSp,
      from: base.fontScale,
      to: target.fontScale,
    })
    const ratio = height(b) / height(a)
    const slack = CONTROL_RATIO_TOLERANCE + HEIGHT_TOLERANCE[platform] / height(a)
    return { probe: probe.id, ratio, expected, pass: Math.abs(ratio - expected) <= slack }
  })
  if (!ratios.some(({ expected }) => expected - 1 > UNCHANGED_RATIO))
    fail('live_font_control_growth_probe_required')
  if (ratios.some(({ pass }) => !pass))
    fail('live_font_control_ratio_mismatch', JSON.stringify(ratios))
  const clipped = clipping(target, HEIGHT_TOLERANCE[platform])
  if (!clipped.pass) fail('live_font_control_clipped', JSON.stringify(clipped.clipped))
  return { ratios }
}

function overlaps(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

function controlBox(capture, id) {
  const node = (capture.controls ?? []).find((control) => control.id === id)
  if (!node) fail('live_font_composer_control_missing', id)
  return parseBounds(node.bounds)
}

/**
 * F-05 across scales: Save and Share sit inside the window, are at least a touch target in
 * size (48 dp or 44 pt, given in capture units) and do not overlap. Their bounds may move:
 * larger text reflows the action row by design.
 */
export function assertComposerControls({
  capture,
  window,
  minTarget,
  ids = ['share-card-save', 'share-card-share'],
}) {
  const frame = parseBounds(window)
  const boxes = ids.map((id) => ({ id, box: controlBox(capture, id) }))
  for (const { id, box } of boxes) {
    if (box[0] < frame[0] || box[1] < frame[1] || box[2] > frame[2] || box[3] > frame[3])
      fail('live_font_composer_control_off_screen', id)
    if (box[2] - box[0] < minTarget || box[3] - box[1] < minTarget)
      fail('live_font_composer_control_too_small', id)
  }
  for (let i = 0; i < boxes.length; i += 1)
    for (let j = i + 1; j < boxes.length; j += 1)
      if (overlaps(boxes[i].box, boxes[j].box))
        fail('live_font_composer_controls_overlap', `${boxes[i].id},${boxes[j].id}`)
  return { tier: boxes[0].box[1] === boxes[1]?.box[1] ? 'row' : 'stacked' }
}

/** F-05 at one scale: showing feedback copy must not move Save or Share. */
export function assertComposerFeedbackStable({
  withoutFeedback,
  withFeedback,
  ids = ['share-card-save', 'share-card-share'],
}) {
  for (const id of ids) {
    const [a, b] = [withoutFeedback, withFeedback].map((capture) =>
      controlBox(capture, id)
    )
    if (JSON.stringify(a) !== JSON.stringify(b))
      fail(
        'live_font_composer_feedback_moved_control',
        `${id} ${JSON.stringify(a)} ${JSON.stringify(b)}`
      )
  }
  return { stable: true }
}
