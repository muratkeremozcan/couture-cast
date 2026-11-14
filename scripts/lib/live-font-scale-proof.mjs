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
//
// F-00i (TD-01): each capture also carries the text layout probe's answer (`textProbe`, see
// live-font-text-probe.mjs), so clipping is judged by the laid-out text as well as by the box:
// a text whose content runs past its clip bounds, or that is ellipsized more than at the cold
// launch at the same scale, is `clipped_by_layout`. Below 0.87 a residual entry may list such a
// clip exactly (`clippedKeys`, TD-05 as amended 2026-11-14) when it is the stale box's own.

import { INPUT_KINDS, matchTextProbe } from './live-font-text-probe.mjs'

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

const rectHeight = (rect) => rect[3] - rect[1]
/** A text input of more than one line (maxLines other than 1): it scrolls its own content. */
const multilineInput = (record) => INPUT_KINDS.has(record.kind) && record.maxLines !== 1
/** The one masking residual entry keys and the hidden-text count share: hour labels to HOUR_TOKEN. */
const maskText = (text) => (HOUR_LABEL.test(text) ? HOUR_TOKEN : text)

/**
 * The probe's records of one capture paired with the capture's text keys (matchTextProbe).
 * Each judged record is a fact: `key` is its entry key (entryKeys: hour labels masked), or for
 * a record an iOS accessibility group took, the group's entry key, `>`, then the record's own
 * `["",text]#n` (n counting that text among the group's records in screen order); `parityKey`
 * is the hierarchy node's parity key. Volatile records and hidden records no node took are
 * judged with no key. Scrolled-away, covered and empty records are never judged. A capture with
 * no probe answer fails as live_font_text_probe_missing.
 */
export function textLayout(capture, platform) {
  const tolerance = HEIGHT_TOLERANCE[platform]
  if (tolerance === undefined) fail('live_font_platform_required', String(platform))
  const answer = capture?.textProbe
  if (!Array.isArray(answer?.records) || !Array.isArray(answer?.windows))
    return { pass: false, code: 'live_font_text_probe_missing', facts: [], match: null }
  const nodes = [...keyed(capture)].map(([key, node]) => ({ ...node, key }))
  const masked = entryKeys(capture)
  const match = matchTextProbe({
    platform,
    nodes,
    answer,
    window: capture.window ? parseBounds(capture.window) : undefined,
    volatileRegions: (capture.volatileRegions ?? []).map(parseBounds),
    tolerance,
  })
  const facts = []
  const groupOf = new Map(match.groups.map((group) => [group.node, group.records]))
  for (const pair of match.pairs) {
    const record = answer.records[pair.record]
    if (record.scrolledAway) continue
    const node = nodes[pair.node]
    let key = masked.get(node.key)
    if (pair.via === 'group') {
      const text = maskText(record.text)
      const members = groupOf.get(pair.node)
      const before = members
        .slice(0, members.indexOf(pair.record))
        .filter((index) => maskText(answer.records[index].text) === text).length
      key = `${key}>${JSON.stringify(['', text])}#${before}`
    }
    facts.push({ key, parityKey: node.key, via: pair.via, id: node.id ?? '', record })
  }
  const paired = new Set(match.pairs.map((pair) => pair.record))
  for (const { record } of match.volatile)
    facts.push({ key: null, via: 'volatile', id: '', record: answer.records[record] })
  for (const index of match.hiddenRecords)
    if (!paired.has(index))
      facts.push({ key: null, via: 'hidden', id: '', record: answer.records[index] })
  // Behind a focused dialog: shown around it, so judged, unless scrolled away.
  for (const index of match.behind)
    if (!answer.records[index].scrolledAway)
      facts.push({ key: null, via: 'behind', id: '', record: answer.records[index] })
  return { pass: match.pass, code: match.code, facts, match }
}

/**
 * The records the probe saw ellipsized, keyed: at a cold launch the list TEA reviews with each
 * entry (an intentional truncation, a `numberOfLines` chip, is ellipsized at the cold launch
 * too, so it is no clip).
 */
export function ellipsizedRecords(capture, platform) {
  return textLayout(capture, platform)
    .facts.filter((fact) => fact.record.ellipsized > 0)
    .map((fact) => ({
      key: fact.key,
      via: fact.via,
      text: fact.record.text,
      ellipsized: fact.record.ellipsized,
    }))
}

/**
 * What the report shows of one capture's probe answer for review: the iOS accessibility groups
 * with the record texts each took, the volatile records per region, the covered windows with
 * their record counts, the paired multi-line inputs (reported, never judged), and the records
 * left out as scrolled away, hidden or empty.
 */
export function textProbeSummary(capture, platform) {
  const { pass, code, match } = textLayout(capture, platform)
  if (!match) return { pass, code }
  const records = capture.textProbe.records
  const nodes = [...keyed(capture).values()]
  const keys = [...keyed(capture).keys()]
  const masked = entryKeys(capture)
  const regions = capture.volatileRegions ?? []
  return {
    pass,
    ...(code ? { code } : {}),
    records: records.length,
    pairs: match.pairs.length,
    groups: match.groups.map((group) => ({
      node: identityOf(nodes[group.node]),
      records: group.records.map((index) => records[index].text),
    })),
    volatile: regions
      .map((region, at) => ({
        region,
        records: match.volatile
          .filter((entry) => entry.region === at)
          .map((entry) => records[entry.record].text),
      }))
      .filter((entry) => entry.records.length),
    covered: match.covered,
    offscreen: match.offscreen.map((index) => records[index].text),
    hidden: match.hiddenRecords.map((index) => records[index].text),
    multilineInputs: match.pairs
      .filter((pair) => multilineInput(records[pair.record]))
      .map((pair) => records[pair.record].text),
    // TEA ruling 2026-11-14: records at opacity 0, with the key of the node each would pair
    // with (null when the hierarchy shows none), for review with each entry.
    invisible: match.invisible.map(({ record, node, comparable }) => ({
      key: node === null ? null : masked.get(keys[node]),
      text: records[record].text,
      comparable,
    })),
    empty: match.empty.length,
    windowNodes: match.windowNodes.map((index) => identityOf(nodes[index])),
    unmatchedRecords: match.unmatchedRecords.map((index) => records[index].text),
    unmatchedNodes: match.unmatchedNodes.map((index) => identityOf(nodes[index])),
    ambiguous: match.ambiguous.map((entry) => ({
      record: records[entry.record].text,
      nodes: entry.nodes.map((index) => identityOf(nodes[index])),
    })),
  }
}

/** Content past its clipRect by more than `tolerance` on any side, or no clipRect at all. */
function contentClipped(record, tolerance) {
  const clip = record.clipRect
  if (clip === null) return true
  const [left, top, right, bottom] = record.contentRect
  return (
    left < clip[0] - tolerance ||
    top < clip[1] - tolerance ||
    right > clip[2] + tolerance ||
    bottom > clip[3] + tolerance
  )
}

/** The keyed records of a capture by key, or none when there is no capture. */
function recordsByKey(capture, platform) {
  if (!capture) return new Map()
  return new Map(
    textLayout(capture, platform)
      .facts.filter((fact) => fact.key !== null)
      .map((fact) => [fact.key, fact.record])
  )
}

/** Lines the layout dropped: the unlimited line count past the drawn one (0 when unknown). */
const truncatedLines = (record) =>
  record?.unlimitedLineCount == null
    ? 0
    : Math.max(0, record.unlimitedLineCount - record.lineCount)

/**
 * What a keyed record cuts that its counterpart at the cold launch at the same scale does not
 * (a missing counterpart cuts nothing): more ellipsized characters, or more dropped lines (an
 * `ellipsizeMode="clip"` text drops lines with no ellipsis; Antigravity r41 P3-1).
 */
function newlyCut(record, coldRecord) {
  const coldEllipsized = coldRecord?.ellipsized ?? 0
  const coldTruncated = truncatedLines(coldRecord)
  return {
    ...(record.ellipsized > coldEllipsized
      ? { ellipsized: record.ellipsized, coldEllipsized }
      : {}),
    ...(truncatedLines(record) > coldTruncated
      ? { truncatedLines: truncatedLines(record), coldTruncatedLines: coldTruncated }
      : {}),
  }
}

/**
 * Layout clips of one capture (F-00i). A judged record is `clipped_by_layout` when its content
 * runs past its clipRect by more than the platform tolerance at the top, bottom, left or right
 * (clipRect is the view cut by every clipping ancestor but scroll views and the window, so a
 * text a scroll viewport cuts is no clip, and a hidden record with no clipRect is a full clip),
 * or, given `cold` (the cold launch at the same scale), when a keyed record cuts more there
 * (newlyCut: ellipsis or dropped lines). A multi-line text input scrolls its own content, so it
 * is paired and reported but never judged; a single-line one is judged like text. Given `base`
 * (the cold launch at the leg's starting scale, TEA ruling 2026-11-14), each clip records
 * whether its box kept that launch's height (`staleBox`, TEA change 6).
 */
function layoutClips(capture, platform, { cold, base } = {}) {
  const tolerance = HEIGHT_TOLERANCE[platform]
  const [coldRecords, baseRecords] = [
    recordsByKey(cold, platform),
    recordsByKey(base, platform),
  ]
  const clips = []
  for (const fact of textLayout(capture, platform).facts) {
    const { record } = fact
    if (multilineInput(record)) continue
    const content = contentClipped(record, tolerance)
    const keyed = fact.key !== null
    const cut =
      cold !== undefined && keyed ? newlyCut(record, coldRecords.get(fact.key)) : {}
    if (!content && !Object.keys(cut).length) continue
    const baseRecord = keyed ? baseRecords.get(fact.key) : undefined
    clips.push({
      reason: 'clipped_by_layout',
      key: fact.key,
      parityKey: fact.parityKey ?? null,
      via: fact.via,
      id: fact.id,
      text: record.text,
      content,
      ...cut,
      height: rectHeight(record.viewRect),
      baseHeight: baseRecord ? rectHeight(baseRecord.viewRect) : null,
      staleBox:
        baseRecord !== undefined &&
        Math.abs(rectHeight(record.viewRect) - rectHeight(baseRecord.viewRect)) <=
          tolerance,
    })
  }
  return clips
}

/**
 * The box-in-parent check (clipping) with the layout clips beside it, each reason kept apart:
 * `outside_parent` for a box that leaves its parent, `clipped_by_layout` for the probe's.
 */
function clippingWithLayout(capture, platform, reference, layout) {
  const boxes = clipping(capture, HEIGHT_TOLERANCE[platform], reference)
  const clipped = [
    ...boxes.clipped.map((entry) => ({ ...entry, reason: 'outside_parent' })),
    ...layoutClips(capture, platform, layout),
  ]
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
  coldBeforeUpdated,
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
    // TEA ruling 2026-11-14: a stale box keeps the height of the cold launch at the leg's
    // starting scale (the cold base launch only on a leg that starts at the base scale).
    clipping: clippingWithLayout(settled, platform, coldBase, { cold, base: coldBefore }),
    controls: controlsOnScreen(settled, requiredControls),
    // The settled captures only: `immediate` is read while the screen relays out, so its probe
    // answer, a moment after its hierarchy, may show another layout; it is judged for nothing.
    textProbe: textProbeCheck(platform, { before, settled, updated }),
    textHidden: hiddenText(platform, [
      ['settled', settled, cold],
      ['updated', updated, coldUpdated],
    ]),
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
    checks.postUpdateClipping = clippingWithLayout(updated, platform, coldBase, {
      cold: coldUpdated,
      base: coldBeforeUpdated,
    })
  }
  markStaleClips(checks)
  return { checks, verdict: classify(checks) }
}

/**
 * Per text, masked by maskText as residual entry keys are: the keys its paired records have, and
 * how many of its records are invisible and comparable across launches (not covered, volatile or
 * scrolled away; the paired keys already leave those out).
 */
function textPresence(capture, platform) {
  const presence = new Map()
  const entry = (text) => {
    if (!presence.has(text)) presence.set(text, { keys: [], invisible: 0 })
    return presence.get(text)
  }
  const layout = textLayout(capture, platform)
  for (const fact of layout.facts)
    if (fact.key !== null) entry(maskText(fact.record.text)).keys.push(fact.key)
  for (const { record, comparable } of layout.match?.invisible ?? [])
    if (comparable) entry(maskText(capture.textProbe.records[record].text)).invisible += 1
  return presence
}

/**
 * TEA ruling 2026-11-14: an invisible record must not hide lost text. A text the cold launch at
 * the same scale shows on more paired records than the live capture does, while the live
 * capture draws it at opacity 0, failed to show: live_font_text_hidden. `stages` holds
 * [stage, live capture, cold capture] triples; a missing capture is skipped.
 */
function hiddenText(platform, stages) {
  const hidden = []
  for (const [stage, live, cold] of stages) {
    if (!live || !cold) continue
    const [now, then] = [textPresence(live, platform), textPresence(cold, platform)]
    for (const [text, { keys }] of then) {
      const shown = now.get(text)
      if (shown?.invisible && shown.keys.length < keys.length)
        hidden.push({ stage, text, coldKeys: keys, invisible: shown.invisible })
    }
  }
  return { pass: hidden.length === 0, hidden }
}

/** Every live capture of the leg carries a probe answer that pairs with its text nodes. */
function textProbeCheck(platform, captures) {
  const stages = {}
  let code = null
  for (const [stage, capture] of Object.entries(captures)) {
    if (!capture) continue
    const summary = textProbeSummary(capture, platform)
    stages[stage] = summary
    code ??= summary.pass ? null : summary.code
  }
  return { pass: code === null, ...(code ? { code } : {}), stages }
}

/**
 * Marks each layout clip `stale` when its node is a stale miss of the same stage: a settled clip
 * against the cold parity misses, an updated clip against the post-update ones. A record a group
 * took counts by its group's node.
 */
function markStaleClips(checks) {
  for (const [clippingCheck, parityCheck] of [
    ['clipping', 'coldParity'],
    ['postUpdateClipping', 'postUpdateParity'],
  ]) {
    const stale = new Set(
      (checks[parityCheck]?.misses ?? [])
        .filter((miss) => miss.stale)
        .map((miss) => miss.key)
    )
    for (const entry of checks[clippingCheck]?.clipped ?? [])
      if (entry.reason === 'clipped_by_layout')
        entry.stale = entry.parityKey !== null && stale.has(entry.parityKey)
  }
}

/**
 * A layout clip a residual entry may list (TD-05 as amended 2026-11-14): on a node that is a
 * stale miss of its stage, whose box kept the height of the cold launch at the leg's starting
 * scale. Any other clip is structural: a box that leaves its parent, and a volatile record's or
 * an unpaired hidden record's, which pair with no node, so none is ever stale (markStaleClips).
 */
const residualClip = (entry) =>
  entry.reason === 'clipped_by_layout' && entry.stale && entry.staleBox

/** Every keyed layout clip of a leg as an entry key, `cold:` (settled) or `updated:`, sorted. */
export function clipKeys(checks) {
  return [
    ...(checks.clipping?.clipped ?? []).map((entry) => [entry, 'cold']),
    ...(checks.postUpdateClipping?.clipped ?? []).map((entry) => [entry, 'updated']),
  ]
    .filter(([entry]) => entry.reason === 'clipped_by_layout' && entry.key !== null)
    .map(([entry, stage]) => `${stage}:${entry.key}`)
    .sort()
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
  const clipsStructural = ['clipping', 'postUpdateClipping'].some((name) =>
    (checks[name]?.clipped ?? []).some((entry) => !residualClip(entry))
  )
  return (
    clipsStructural ||
    [
      'anchors',
      'fullText',
      'identity',
      'controls',
      'textProbe',
      'textHidden',
      'postUpdateFullText',
      'postUpdateAnchors',
      'postUpdateControls',
    ].some((name) => checks[name] && !checks[name].pass)
  )
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
    const text = maskText(node.text)
    if (text === node.text) {
      masked.set(key, key)
      continue
    }
    const id = node.id ?? ''
    const index = hours.get(id) ?? 0
    hours.set(id, index + 1)
    masked.set(key, `${JSON.stringify([id, text])}#${index}`)
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
    // TD-05 as amended 2026-11-14: the seventh fact.
    review.clipsStale !== true && 'clipsStale',
  ].filter(Boolean)
}

/** An entry from before the TD-05 amendment: it names no clips, not even none, nor clipsStale. */
const predatesClipAmendment = (baseline) =>
  baseline.clippedKeys === undefined && baseline.review?.clipsStale === undefined

/**
 * A layout clip key split into its stage, node key and, for a record an iOS group took, the
 * record's own `["",text]#n`; null when it is no clip key. Text may hold `>`, so each `]#n>`
 * is tried until both halves read as keys.
 */
function splitClipKey(key) {
  const staged = typeof key === 'string' ? STAGED_KEY.exec(key) : null
  if (!staged) return null
  const nodeKey = (text) => {
    const at = text.lastIndexOf('#')
    if (at < 0 || !/^\d+$/.test(text.slice(at + 1))) return false
    try {
      const named = JSON.parse(text.slice(0, at))
      return (
        Array.isArray(named) &&
        named.length === 2 &&
        named.every((part) => typeof part === 'string')
      )
    } catch {
      return false
    }
  }
  const rest = staged[2]
  if (nodeKey(rest)) return { stage: staged[1], node: rest, record: null }
  for (const cut of rest.matchAll(/\]#\d+>/g)) {
    const end = cut.index + cut[0].length - 1
    const [node, record] = [rest.slice(0, end), rest.slice(end + 1)]
    if (
      nodeKey(node) &&
      nodeKey(record) &&
      JSON.parse(record.slice(0, record.lastIndexOf('#')))[0] === ''
    )
      return { stage: staged[1], node, record }
  }
  return null
}

/**
 * TD-05 as amended 2026-11-14: why the run's layout clips are not the entry's, or null. The entry
 * must carry `clippedKeys` (even empty); each listed key, by its node, must be in `staleKeys`;
 * and the run's clip keys must equal `clippedKeys` exactly, as a multiset. The run's clips reach
 * this point only when each is stale and kept the height of the cold launch at the leg's starting
 * scale (classify makes any other clip structural).
 */
function clipProblem(checks, baseline) {
  const run = clipKeys(checks)
  if (!Array.isArray(baseline.clippedKeys))
    return 'baseline clippedKeys must be a list of clip keys'
  const bad = baseline.clippedKeys.find((key) => splitClipKey(key) === null)
  if (bad !== undefined)
    return `baseline clippedKeys must be a list of clip keys: ${JSON.stringify(bad)}`
  const stale = new Set(baseline.staleKeys)
  const notStale = baseline.clippedKeys.find((key) => {
    const { stage, node } = splitClipKey(key)
    return !stale.has(`${stage}:${node}`)
  })
  if (notStale !== undefined) return `clipped key not in staleKeys: ${notStale}`
  const { extra, missing } = multisetDifference(run, baseline.clippedKeys)
  if (extra.length || missing.length)
    return [
      extra.length && `clip outside clippedKeys: ${extra[0]}`,
      missing.length && `clipped key does not clip: ${missing[0]}`,
      `${extra.length} extra, ${missing.length} missing`,
    ]
      .filter(Boolean)
      .join('; ')
  return null
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
 * renders the banner (`captures.bannerMarker`), the leg's before, settled and cold captures must show
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
    for (const stage of ['before', 'settled', 'cold']) {
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
  // TEA ruling 2026-11-14: an entry from before the clip amendment approves nothing, whether or
  // not the run clips; every such entry is proposed again from a run on the F-00i harness.
  if (predatesClipAmendment(baseline))
    return unapproved(
      'entry predates the TD-05 clip amendment (no clippedKeys, no clipsStale) and approves nothing; propose it again from this run'
    )
  const shape = staleKeysProblem(baseline.staleKeys)
  if (shape) return unapproved(shape)
  // An entry approves only with review facts that meet the six approval rules, so a proposal
  // committed verbatim with a failing fact approves nothing.
  const broken = brokenReviewFacts(baseline)
  if (broken.length)
    return unapproved(
      `baseline review facts break the approval rules: ${broken.join(',')}`
    )
  const problem =
    exactnessProblem(checks, baseline, environment.captures) ??
    clipProblem(checks, baseline)
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
  const clips = ['clipping', 'postUpdateClipping'].flatMap((name) =>
    (checks[name]?.clipped ?? []).filter((entry) => entry.reason === 'clipped_by_layout')
  )
  return {
    staleKeys: stageKeys(checks, captures),
    // TD-05 as amended 2026-11-14: the run's exact layout clips, none included, and whether
    // every one is a stale key's own clip with its box at the starting-scale cold height.
    clippedKeys: clipKeys(checks),
    review: {
      verdict: classify(checks),
      structuralPass: !structural(checks),
      everyMissStale: misses.length > 0 && misses.every((miss) => miss.stale),
      growthFailing: failingGrowth(checks),
      clipsStale: clips.every(residualClip),
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
  // A probe answer that does not pair with the hierarchy judges nothing, at every version.
  if (!result.checks.textProbe.pass)
    fail(
      result.checks.textProbe.code,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(result.checks.textProbe.stages).filter(
            ([, stage]) => !stage.pass
          )
        )
      )
    )
  // Text the cold launch shows that the live screen only draws at opacity 0 is lost text.
  if (!result.checks.textHidden.pass)
    fail('live_font_text_hidden', JSON.stringify(result.checks.textHidden.hidden))
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
export function assertColdControl({
  platform,
  androidApi,
  base,
  target,
  probes,
  updated = [],
}) {
  if (HEIGHT_TOLERANCE[platform] === undefined)
    fail('live_font_platform_required', String(platform))
  // F-00i: every cold capture of the control, its updates included, pairs with its probe answer
  // and shows no layout clip; ellipsis there is the reference, so only content is judged.
  for (const capture of [base, target, ...updated]) {
    const layout = textLayout(capture, platform)
    if (!layout.pass)
      fail(layout.code, JSON.stringify(textProbeSummary(capture, platform)))
    const clips = layoutClips(capture, platform)
    if (clips.length)
      fail(
        'live_font_control_clipped_by_layout',
        JSON.stringify(clips.map(({ key, via, text }) => ({ key, via, text })))
      )
  }
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
