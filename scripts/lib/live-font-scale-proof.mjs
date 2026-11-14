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
// nothing else wrong) passes only when a reviewed baseline entry for that platform, build,
// screen, timezone and weather banner lists exactly those stale miss keys, each with its stage
// (scripts/lib/fixtures/live-font-residual-baselines.json); anything else fails. Required
// controls must stay on screen in every class.

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

/** A box's height and its overhang above and below its parent, in capture units. */
function overhangOf(node) {
  const [, top, , bottom] = parseBounds(node.bounds)
  const [, pt, , pb] = parseBounds(node.parent)
  return { height: bottom - top, above: pt - top, below: bottom - pb }
}

/** Centred over its parent and identical, box and overhang, to the cold base launch's. */
function unchangedCentredTarget(node, base, tolerance) {
  if (base?.parent === undefined) return false
  const [now, then] = [overhangOf(node), overhangOf(base)]
  return (
    now.above > tolerance &&
    now.above === now.below &&
    now.height === then.height &&
    now.above === then.above &&
    now.below === then.below
  )
}

/**
 * A text box that leaves its parent view is clipped, whatever its own height says. One box is
 * exempt: a touch target centred on a shorter row (a 44 pt icon button on iOS), which overflows
 * by the same amount above and below. It is exempt only when `reference`, the cold launch at
 * the platform's base scale, shows it with the same height and the same overhang: a fixed
 * target has one box at every scale. Grown text that a fixed row centres overflows the same way,
 * and stale text on a return leg keeps the scaled box, so any change in height or overhang from
 * the cold base launch, or a box that launch does not show, is clipping.
 */
function clipping(capture, tolerance, reference) {
  const referenceNodes = reference ? keyed(reference) : new Map()
  const clipped = []
  for (const [key, node] of keyed(capture)) {
    if (node.parent === undefined) continue
    const [left, top, right, bottom] = parseBounds(node.bounds)
    const [pl, pt, pr, pb] = parseBounds(node.parent)
    const centred = unchangedCentredTarget(node, referenceNodes.get(key), tolerance)
    if (
      left < pl - tolerance ||
      right > pr + tolerance ||
      (!centred && (top < pt - tolerance || bottom > pb + tolerance))
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
/**
 * The mount ids a capture's markers carry, by scope (`live-font-mount-<scope>-<id>`), every id
 * kept: two mounts of one scope in one capture are two mounts. A root identity that is not
 * marker-shaped (a fixture) is a root mount.
 */
function mountsOf(root) {
  if (typeof root !== 'string' || root === '') return undefined
  const scopes = new Map()
  for (const item of root.split(',')) {
    const match = /^live-font-mount-([a-z]+)-([a-z0-9]+)$/.exec(item)
    const [scope, id] = match ? [match[1], match[2]] : ['root', item]
    scopes.set(scope, (scopes.get(scope) ?? new Set()).add(id))
  }
  return scopes
}

/**
 * The marker scopes every capture of a screen with marker scope `mount` must carry, as the
 * identity check below requires them and the runner rereads for them: the modal alone for the
 * composer, the root and the screen's own scope for every other screen.
 */
export function requiredMounts(mount) {
  return mount === 'modal' ? ['modal'] : ['root', ...(mount ? [mount] : [])]
}

/**
 * Whether the stages carry enough mount evidence to judge identity: the root marker and the
 * screen's own scope (`mount`: home, community, settings, or modal for the composer) in every
 * stage, and every other scope any stage shows in every stage too. A marker left out of one
 * capture could hide a remount whose fresh render passes every height check; the runner rereads
 * a dump that drops one (iOS drops a 1x1 view now and then) before it records the capture.
 * The modal scope stands alone: Android dumps only the modal's window while it is up, so the
 * root marker never shows there, and the modal is mounted inside the root tree, so a root
 * remount gives the modal a new mount id too. Where a modal capture does show root (iOS), the
 * every-scope-in-every-stage rule still holds it.
 */
function mountsKnown(mounts, mount) {
  const required = requiredMounts(mount)
  if (!mounts.every((scopes) => scopes && required.every((scope) => scopes.has(scope))))
    return false
  const scopes = new Set(mounts.flatMap((stage) => [...stage.keys()]))
  return [...scopes].every((scope) => mounts.every((stage) => stage.has(scope)))
}

/**
 * Kept when every scope shows exactly one mount id across every capture that shows it,
 * including the captures of the launch's earlier legs, so a remount during one leg or its
 * revert is caught by the next.
 */
function sameMounts(mounts) {
  const ids = new Map()
  for (const scopes of mounts)
    for (const [scope, set] of scopes ?? [])
      ids.set(scope, new Set([...(ids.get(scope) ?? []), ...set]))
  return [...ids.values()].every((set) => set.size === 1)
}

function identityCheck(platform, stages, earlier = [], mount) {
  const pids = new Set(stages.map((capture) => String(capture.pid)))
  const roots = stages.map((capture) => capture.identity?.root)
  const activities = stages.map((capture) => capture.identity?.activity)
  const onCreate = stages.map((capture) => capture.identity?.onCreate)
  const processKept = pids.size === 1 && !pids.has('undefined')
  const mounts = roots.map(mountsOf)
  const rootKnown = mountsKnown(mounts, mount)
  const earlierMounts = earlier.map((capture) => mountsOf(capture?.identity?.root))
  const rootKept = rootKnown && sameMounts([...earlierMounts, ...mounts])
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
 * the heights a measurement cache could hand back, and the mounts every leg of the launch must
 * share. `mount` is the screen's own marker scope, required in every capture. `coldBefore`, the cold launch at the leg's
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
  coldBase,
  earlier = [],
  mount,
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
    identity: identityCheck(
      platform,
      [before, immediate, settled, ...(updated ? [updated] : [])],
      earlier,
      mount
    ),
    coldParity: parity(settled, cold, before, tolerance, earlier),
    growth: { pass: growth.every((probe) => probe.pass), probes: growth },
    clipping: clipping(settled, tolerance, coldBase),
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
    checks.postUpdateClipping = clipping(updated, tolerance, coldBase)
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

/**
 * An hour-of-day label as the hourly ribbon renders it in English (formatHour in
 * apps/mobile/components/hero/hourly-forecast-ribbon.tsx): an hour from 1 to 12, a narrow no-break
 * space (U+202F), then AM or PM. The labels follow the clock the run starts at, so a residual entry
 * keys them as one token, HOUR_TOKEN, whatever hour they show.
 */
export const HOUR_LABEL = /^(?:[1-9]|1[0-2])\u202f(?:AM|PM)$/
export const HOUR_TOKEN = '<hour>'

/**
 * The key each text of a capture has in a residual entry, by its parity key. Hour labels become
 * HOUR_TOKEN, indexed by their place among that testID's hour labels in screen order (top to
 * bottom, then left to right, the order the parity keys count in), so several labels stay
 * distinct and a label that moves along the ribbon gets another index. Every other key is its
 * parity key. The parity measurement itself keeps the full text.
 */
function entryKeys(capture) {
  const masked = new Map()
  const hours = new Map()
  for (const [key, node] of keyed(capture)) {
    if (!HOUR_LABEL.test(node.text)) {
      masked.set(key, key)
      continue
    }
    const id = node.id ?? ''
    const index = hours.get(id) ?? 0
    hours.set(id, index + 1)
    masked.set(key, `${JSON.stringify([id, HOUR_TOKEN])}#${index}`)
  }
  return masked
}

/** Each entry key stage: the parity check whose misses it records and the capture they sit on. */
const STAGES = {
  cold: { check: 'coldParity', capture: 'settled' },
  updated: { check: 'postUpdateParity', capture: 'updated' },
}
const STAGED_KEY = /^(cold|updated):(.*)$/s

/**
 * Every stale miss of a leg as a residual entry keys it: `cold:` for a cold parity miss (measured
 * on the settled screen), `updated:` for a post-update parity miss (on the updated screen), then
 * the miss key with hour labels masked (entryKeys); sorted, duplicates kept. `captures` holds the
 * leg's `settled` and `updated` captures.
 */
export function stageKeys(checks, captures) {
  const keys = []
  for (const [stage, { check, capture }] of Object.entries(STAGES)) {
    const misses = checks[check]?.misses ?? []
    if (!misses.length) continue
    const masked = entryKeys(captures?.[capture])
    for (const miss of misses) {
      const key = masked.get(miss.key)
      if (key === undefined)
        fail('live_font_miss_capture_required', `${stage} ${miss.key}`)
      keys.push(`${stage}:${key}`)
    }
  }
  return keys.sort()
}

/** The testID an entry key names (`''` for text without one): `cold:["id","text"]#n` gives `id`. */
const keyId = (key) => {
  const bare = STAGED_KEY.exec(key)?.[2] ?? key
  return JSON.parse(bare.slice(0, bare.lastIndexOf('#')))[0]
}

/** Every stale miss of a leg, cold parity first, duplicates kept. */
const staleMisses = (checks) => [
  ...checks.coldParity.misses,
  ...(checks.postUpdateParity?.misses ?? []),
]

/** The failing growth probe ids of a leg, sorted, duplicates kept. */
const failingGrowth = (checks) =>
  checks.growth.probes
    .filter((probe) => !probe.pass)
    .map((probe) => probe.probe)
    .sort()

/** What `run` holds beyond `listed`, and `listed` beyond `run`, as multisets. */
function multisetDifference(run, listed) {
  const missing = [...listed].sort()
  const extra = []
  // Each run item uses up one listed copy.
  for (const item of [...run].sort()) {
    const at = missing.indexOf(item)
    if (at < 0) extra.push(item)
    else missing.splice(at, 1)
  }
  return { extra, missing }
}

/** The review facts of an entry that break the six approval rules (TEA, 2026-11-13). */
function brokenReviewFacts(baseline) {
  const review = baseline.review ?? {}
  const staleIds = new Set(baseline.staleKeys.map(keyId))
  const growthOutside = Array.isArray(review.growthFailing)
    ? review.growthFailing.filter((id) => !staleIds.has(id))
    : null
  return [
    review.verdict !== 'known-residual' && 'verdict',
    review.structuralPass !== true && 'structuralPass',
    review.everyMissStale !== true && 'everyMissStale',
    review.controlPass !== true && 'controlPass',
    growthOutside === null && 'growthFailing',
    growthOutside?.length > 0 && `growthFailing(${growthOutside.join(',')})`,
  ].filter(Boolean)
}

/**
 * Rule 6, keys exact: every failing growth probe is an id `staleKeys` names, the run's failing
 * growth probes equal the entry's `review.growthFailing` (sorted, duplicates kept), and the run's
 * entry keys (stageKeys) equal `staleKeys` exactly. A hand edit carries no headroom, a swap
 * between two unlabeled texts is a new residual, and a key that moves between the cold and the
 * updated stage is one key extra and one missing.
 */
function exactnessProblem(checks, baseline, captures) {
  const staleIds = new Set(baseline.staleKeys.map(keyId))
  const failingProbes = failingGrowth(checks)
  const growthOutside = failingProbes.filter((id) => !staleIds.has(id))
  if (growthOutside.length)
    return `growth fails outside baseline: ${growthOutside.join(',')}`
  const growth = multisetDifference(failingProbes, baseline.review.growthFailing)
  if (growth.extra.length || growth.missing.length)
    return [
      'growth failing differs from baseline',
      growth.extra.length && `failing in run only: ${growth.extra.join(',')}`,
      growth.missing.length && `failing in baseline only: ${growth.missing.join(',')}`,
    ]
      .filter(Boolean)
      .join('; ')
  const { extra, missing } = multisetDifference(
    stageKeys(checks, captures),
    baseline.staleKeys
  )
  if (extra.length || missing.length)
    return [
      extra.length && `stale key outside baseline: ${extra[0]}`,
      missing.length && `baseline key no miss hit: ${missing[0]}`,
      `${extra.length} extra, ${missing.length} missing`,
    ]
      .filter(Boolean)
      .join('; ')
  return null
}

/**
 * Why `keys` is no list of entry keys (`cold:` or `updated:`, then `["id","text"]#n`), or null
 * when it is one.
 */
function staleKeysProblem(keys) {
  if (!Array.isArray(keys)) return 'baseline staleKeys must be a list of keys'
  const bad = keys.find((key) => {
    const staged = typeof key === 'string' ? STAGED_KEY.exec(key) : null
    if (!staged || !/#\d+$/.test(staged[2])) return true
    try {
      const named = JSON.parse(staged[2].slice(0, staged[2].lastIndexOf('#')))
      return !Array.isArray(named) || typeof named[0] !== 'string'
    } catch {
      return true
    }
  })
  return bad === undefined
    ? null
    : `baseline staleKeys must be a list of keys: ${JSON.stringify(bad)}`
}

/**
 * The Community screen's notice while the local forecast is out of date: the view with this
 * testID, holding community.band.unresolved.weather_stale (the proof runs in en-US).
 */
export const WEATHER_BANNER_MARKER = 'community-band-unresolved'
export const WEATHER_STALE_TEXT =
  'Your local forecast is out of date, so you are seeing looks from every climate band.'

/**
 * The weather banner a capture shows: `out-of-date` when the banner view (`marker`) is on screen
 * with the out-of-date text, `none` when neither is, and `other` for anything else (the banner
 * with another reason, or the text without the view).
 */
export function weatherBannerState(capture, marker = WEATHER_BANNER_MARKER) {
  const shown = (capture?.controls ?? []).some((control) => control.id === marker)
  const texts = [
    ...appNodes(capture).map((node) => node.text),
    ...(capture?.fullText ?? []).map((key) => JSON.parse(key)[1]),
  ]
  const stale = texts.includes(WEATHER_STALE_TEXT)
  if (!shown && !stale) return 'none'
  return shown && stale ? 'out-of-date' : 'other'
}

/**
 * Why the run's environment differs from the one the entry was approved in, or null. The
 * timezone and the weather banner are part of it: an entry without either, or a run without
 * either, approves nothing. `weatherBanner` is the banner state the run set up; on a screen that
 * renders the banner (`captures.bannerMarker`), the leg's before and settled captures must show
 * the entry's state too. The updated capture is left out: the Community update shows every band,
 * and the notice belongs to the viewer's own band only, so it hides the banner by design.
 */
function environmentProblem(baseline, { timezone, weatherBanner, captures }) {
  const known = (value) => typeof value === 'string' && value !== ''
  const same = (a, b) => known(a) && known(b) && a === b
  if (!same(baseline.timezone, timezone))
    return `baseline timezone ${baseline.timezone ?? 'missing'}, run timezone ${timezone ?? 'missing'}`
  if (!same(baseline.weatherBanner, weatherBanner))
    return `baseline weather banner ${baseline.weatherBanner ?? 'missing'}, run weather banner ${weatherBanner ?? 'missing'}`
  if (captures?.bannerMarker)
    for (const stage of ['before', 'settled']) {
      if (!captures[stage]) continue
      const shown = weatherBannerState(captures[stage], captures.bannerMarker)
      if (shown !== baseline.weatherBanner)
        return `baseline weather banner ${baseline.weatherBanner}, ${stage} capture shows ${shown}`
    }
  return null
}

/**
 * A residual passes only as a reviewed baseline entry describes it: approved in the run's
 * timezone and weather banner, with `staleKeys` listing exactly the run's entry keys (stageKeys).
 * Anything else is a new regression until it is reviewed.
 */
function residualApproved(checks, baseline, environment) {
  const unapproved = (reason) => ({
    pass: false,
    code: 'live_font_residual_unapproved',
    reason,
  })
  if (!baseline) return unapproved('no reviewed baseline')
  const differs = environmentProblem(baseline, environment)
  if (differs)
    return {
      pass: false,
      code: 'live_font_residual_environment_differs',
      reason: differs,
    }
  const shape = staleKeysProblem(baseline.staleKeys)
  if (shape) return unapproved(shape)
  // An entry approves only with review facts that meet the six approval rules, so a proposal
  // committed verbatim with a failing fact approves nothing.
  const broken = brokenReviewFacts(baseline)
  if (broken.length)
    return unapproved(
      `baseline review facts break the approval rules: ${broken.join(',')}`
    )
  const problem = exactnessProblem(checks, baseline, environment.captures)
  return problem ? unapproved(problem) : { pass: true }
}

/**
 * TEA, 2026-11-13: what a reviewer needs to approve a known-residual leg, in the baseline entry's
 * own shape. `staleKeys` is exact (stageKeys: every stale miss key with its stage and hour labels
 * masked, sorted, duplicates kept, no headroom), and the facts the six approval rules read ride
 * beside it under `review`; the runner adds the leg's identity, timezone, weather banner and
 * evidence. Approval is then a reviewed diff of the baselines file. `captures` holds the leg's
 * `settled` and `updated` captures.
 */
export function proposedResidualEntry(checks, captures) {
  const misses = staleMisses(checks)
  return {
    staleKeys: stageKeys(checks, captures),
    review: {
      verdict: classify(checks),
      structuralPass: !structural(checks),
      everyMissStale: misses.length > 0 && misses.every((miss) => miss.stale),
      growthFailing: failingGrowth(checks),
    },
  }
}

/**
 * The proof's pass rule. With the fix bundled the screen must relayout in place. Without it an
 * early correct relayout passes with `baselineReview` set, and a residual passes only within its
 * reviewed baseline, approved in the run's `timezone` and `weatherBanner` (the banner state the
 * run set up); a restored screen or any other failure is red. `change.bannerMarker` names the
 * banner view on a screen that renders it.
 */
export function assertLiveFontProof({
  reactNativeVersion,
  residualBaseline,
  timezone,
  weatherBanner,
  ...change
}) {
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
    const approved = residualApproved(result.checks, residualBaseline, {
      timezone,
      weatherBanner,
      captures: change,
    })
    if (!approved.pass) fail(approved.code, approved.reason)
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
  const clipped = clipping(target, HEIGHT_TOLERANCE[platform], base)
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
