// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// IO-free helpers that turn Maestro hierarchies and adb output into the captures the live
// font-scale oracle (live-font-scale-proof.mjs) judges. scripts/run-live-font-proof.mjs does the
// device IO.

const MARKER = /^live-font-mount-([a-z]+)-([a-z0-9]+)$/
const SCALE = /^live-font-scale-([a-z]+)-(\d+(?:\.\d+)?)$/

function attributes(node) {
  return node?.attributes ?? {}
}

/** Sorts a test-build marker id into the reading it carries. */
function readMarker(id, { markers, jsScales, environments }) {
  if (MARKER.test(id)) markers.push(id)
  const reading = SCALE.exec(id)
  if (reading) jsScales.push(Number(reading[2]))
  if (id.startsWith('live-font-env-')) environments.push(id)
}

/**
 * Text nodes with their parent's bounds. Android puts a TextView's string in `text`; iOS puts a
 * static text's label in `accessibilityText` when `text` is empty, so it falls back to that.
 * A node whose id starts with a `volatile` prefix is dropped with its subtree and counted in
 * `volatileDropped`: a region whose presence the app decides on grounds unrelated to text size.
 * With `markVolatile` the region's text stays, flagged `volatile: true`, so scroll pages can
 * still be aligned on it (stitchPages leaves it out of the result).
 */
export function flattenHierarchy(
  tree,
  { platform, volatile = [], markVolatile = false }
) {
  const nodes = []
  let volatileDropped = 0
  const controls = []
  const markers = []
  const jsScales = []
  const environments = []
  const walk = (node, parentBounds, inVolatile) => {
    const attrs = attributes(node)
    const id = attrs['resource-id'] ?? ''
    const bounds = attrs.bounds
    readMarker(id, { markers, jsScales, environments })
    const isVolatile =
      inVolatile || volatile.some((prefix) => id && id.startsWith(prefix))
    if (isVolatile && !markVolatile) {
      volatileDropped += countText(node, platform)
      return
    }
    const entry = textEntry({
      attrs,
      id,
      bounds,
      parentBounds,
      isVolatile,
      platform,
    })
    if (entry) nodes.push(entry)
    if (id && bounds && !isVolatile) controls.push({ id, bounds })
    for (const child of node?.children ?? [])
      walk(child, bounds ?? parentBounds, isVolatile)
  }
  walk(tree, undefined, false)
  // Every marked window reads the same scale; disagreeing readings are no reading.
  const jsFontScale =
    jsScales.length && new Set(jsScales).size === 1 ? jsScales[0] : undefined
  const environment = new Set(environments.map((id) => id.slice(id.indexOf('~'))))
  return {
    nodes,
    controls,
    markers: markers.sort(),
    jsFontScale,
    environment: environment.size === 1 ? parseEnvironment(environments[0]) : undefined,
    volatileDropped,
  }
}

/** The flattened node for a view with text: the text with the parent's bounds. */
function textEntry({ attrs, id, bounds, parentBounds, isVolatile, platform }) {
  const text = nodeText(attrs, platform)
  if (!text || !bounds) return undefined
  return {
    text,
    id,
    bounds,
    ...(parentBounds ? { parent: parentBounds } : {}),
    ...(isVolatile ? { volatile: true } : {}),
  }
}

/** Android's `text`; on iOS a static text's `accessibilityText` when `text` is empty. */
function nodeText(attrs, platform) {
  return attrs.text || (platform === 'ios' ? (attrs.accessibilityText ?? '') : '')
}

function countText(node, platform) {
  const own = nodeText(attributes(node), platform) ? 1 : 0
  return (node?.children ?? []).reduce(
    (sum, child) => sum + countText(child, platform),
    own
  )
}

/** The mount markers joined in order: one string that changes when any marked mount changes. */
export function rootIdentity(markers) {
  return markers.length ? markers.join(',') : undefined
}

/**
 * The locales and layout direction the system last reported to MainActivity, read from its
 * ActivityRecord in `dumpsys activity activities`: the configuration the Activity itself
 * received, which a per-app locale change updates in place.
 */
export function activityConfiguration(dumpsys, component) {
  // A record starts on a `* ... ActivityRecord{... <component> ...}` line and runs to the
  // next `* ` line; other lines (topResumedActivity=, Resumed:) only mention the component.
  const lines = String(dumpsys).split('\n')
  const start = lines.findIndex(
    (line) => /^\s*\* .*ActivityRecord\{/.test(line) && line.includes(` ${component} `)
  )
  if (start < 0) return undefined
  const end = lines.findIndex((line, index) => index > start && /^\s*\* /.test(line))
  const record = lines.slice(start, end < 0 ? undefined : end).join('\n')
  const match = /CurrentConfiguration=\{[^[]*\[([^\]]*)\]\s+(ld(?:rtl|ltr))/.exec(record)
  if (!match) return undefined
  return { locales: match[1].split(','), rtl: match[2] === 'ldrtl' }
}

/** The resumed MainActivity's token from `dumpsys activity top -a`. */
export function activityToken(dumpsys, component) {
  const pattern = new RegExp(
    `ACTIVITY ${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ([0-9a-f]+) pid=(\\d+)`,
    'g'
  )
  const matches = [...String(dumpsys).matchAll(pattern)]
  if (matches.length !== 1) return undefined
  return matches[0][1]
}

/**
 * MainActivity onCreate calls in the Android event log. The platform logs
 * `wm_on_create_called: [token,<fully qualified class>,<reason>,<ms>]`, the class from
 * getComponentName().getClassName(), so a match is on that field, never on the flattened
 * `package/.Activity` component (Codex R4-05). The count is `undefined` when the log is
 * unavailable or its ring buffer is full enough to have dropped entries, which the caller must
 * not read as zero. `bufferStats` is `adb logcat -b events -g` output.
 */
export function countOnCreate(eventLog, className, bufferStats) {
  if (typeof eventLog !== 'string' || typeof bufferStats !== 'string') return undefined
  const ring =
    /ring buffer is (\d+(?:\.\d+)?) ?([KMG]i?B)? .*?\((\d+(?:\.\d+)?) ?([KMG]i?B)? consumed/.exec(
      bufferStats
    )
  if (!ring) return undefined
  const bytes = (value, unit) =>
    Number(value) * ({ KiB: 1024, KB: 1024, MiB: 1048576, MB: 1048576 }[unit] ?? 1)
  if (bytes(ring[3], ring[4]) >= 0.9 * bytes(ring[1], ring[2])) return undefined
  let count = 0
  for (const line of eventLog.split('\n')) {
    const match = /wm_on_create_called: \[([^\]]*)\]/.exec(line)
    if (match && match[1].split(',').map((field) => field.trim())[1] === className)
      count += 1
  }
  return count
}

function edges(node) {
  const match =
    /^\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/.exec(
      String(node.bounds)
    )
  return match ? [Number(match[2]), Number(match[4])] : [0, 0]
}
const top = (node) => edges(node)[0]

const identityOf = (node) => JSON.stringify([node.id ?? '', node.text])

const median = (values) =>
  [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]

/**
 * The step for two pages that share no moving text (a page of only a tall image): the median
 * step measured so far in this stitch, since every drag is the same length, or the drag's own
 * length before any was measured.
 */
function fallbackStep(steps, expectedShift) {
  if (steps.length) return median(steps)
  if (expectedShift > 0) return expectedShift
  throw new Error('live_font_scroll_pages_disjoint')
}

/**
 * Joins scrolled pages into one text multiset. A node at the same identity and position on
 * every page is fixed chrome (tab bar, sticky header) and counts once. Each page is offset from
 * the previous one by the median shift of the moving identities that appear exactly once on
 * both pages; a node whose identity and shifted top or bottom match one already taken is the
 * same node seen again. Either edge counts because the hierarchy clips a node cut by the
 * viewport, so a node half off screen keeps only its visible edge. Pages that share no moving
 * text take the step from fallbackStep.
 */
export function stitchPages(pages, { tolerance = 4, expectedShift } = {}) {
  if (!pages.length) return []
  const at = (page, node) =>
    page.some(
      (other) =>
        identityOf(other) === identityOf(node) &&
        Math.abs(top(other) - top(node)) <= tolerance
    )
  const chrome = (node) => pages.length > 1 && pages.every((page) => at(page, node))
  const taken = pages[0]
    .filter((node) => !node.volatile)
    .map((node) => {
      const [y, bottom] = edges(node)
      return { key: identityOf(node), y, bottom }
    })
  let offset = 0
  const steps = []
  for (let index = 1; index < pages.length; index += 1) {
    const once = (page) => {
      const counts = new Map()
      for (const node of page)
        counts.set(identityOf(node), (counts.get(identityOf(node)) ?? 0) + 1)
      return new Map(
        page
          .filter((node) => counts.get(identityOf(node)) === 1 && !chrome(node))
          .map((node) => [identityOf(node), node])
      )
    }
    const [a, b] = [once(pages[index - 1]), once(pages[index])]
    const shifts = [...a.keys()]
      .filter((key) => b.has(key))
      .map((key) => top(a.get(key)) - top(b.get(key)))
    const step = shifts.length ? median(shifts) : fallbackStep(steps, expectedShift)
    steps.push(step)
    offset += step
    for (const node of pages[index]) {
      if (chrome(node) || node.volatile) continue
      const key = identityOf(node)
      const [y, bottom] = edges(node).map((edge) => edge + offset)
      // The same text whose box shares an edge with, or overlaps, one already taken is that node
      // again: a viewport edge or a sticky header clips a tall text differently on each page,
      // so the taken box grows to everything any page has shown of it.
      const seen = taken.find(
        (entry) =>
          entry.key === key &&
          (Math.abs(entry.y - y) <= tolerance ||
            Math.abs(entry.bottom - bottom) <= tolerance ||
            (y < entry.bottom - tolerance && bottom > entry.y + tolerance))
      )
      if (seen) {
        seen.y = Math.min(seen.y, y)
        seen.bottom = Math.max(seen.bottom, bottom)
      } else taken.push({ key, y, bottom })
    }
  }
  return taken.map(({ key }) => key)
}

/**
 * Two hierarchies show the same layout when their app text nodes and bounds are identical.
 * System UI (the status-bar clock) is ignored, since it changes on its own.
 */
export function sameLayout(a, b) {
  const shape = (nodes) =>
    JSON.stringify(
      nodes
        .filter((node) => !/^com\.android\.systemui:/.test(node.id ?? ''))
        .map((node) => [node.id, node.text, node.bounds])
    )
  return shape(a) === shape(b)
}

/** iOS content-size categories and the multiplier React Native applies to text for each. */
export const IOS_CONTENT_SIZES = {
  'extra-small': 0.823,
  small: 0.882,
  medium: 0.941,
  large: 1,
  'extra-large': 1.118,
  'extra-extra-large': 1.235,
  'extra-extra-extra-large': 1.353,
  'accessibility-medium': 1.786,
  'accessibility-large': 2.143,
  'accessibility-extra-large': 2.643,
  'accessibility-extra-extra-large': 3.143,
  'accessibility-extra-extra-extra-large': 3.571,
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01

/**
 * The continuity and provenance of a live change, checked before the oracle judges it (R2-05,
 * R2-03). `before`, `immediate` and `settled` must come from one launch and `cold` from
 * another, so a cold capture relabeled as a live stage is refused. The OS setting and the
 * scale JavaScript reports must both match the declared scale at each end, so a scale change
 * the app never received cannot pass.
 */
export function assertLiveProvenance({ before, immediate, settled, cold, platform }) {
  const expected = {
    before: 'before',
    immediate: 'immediate',
    settled: 'settled',
    cold: 'cold',
  }
  for (const [name, capture] of Object.entries({ before, immediate, settled, cold }))
    if (capture?.stage !== expected[name])
      throw new Error(`live_font_provenance_stage:${name}`)
  const launches = [before, immediate, settled].map((capture) => capture.launch)
  if (launches.some((launch) => launch === undefined) || new Set(launches).size !== 1)
    throw new Error('live_font_provenance_launch_changed')
  if (cold.launch === before.launch) throw new Error('live_font_provenance_cold_is_live')
  for (const capture of [before, settled]) {
    const os =
      platform === 'ios' ? IOS_CONTENT_SIZES[capture.osScale] : Number(capture.osScale)
    if (!near(os, capture.fontScale))
      throw new Error(`live_font_provenance_os_scale:${capture.stage}`)
    if (!near(capture.jsFontScale, capture.fontScale))
      throw new Error(`live_font_provenance_js_scale:${capture.stage}`)
  }
  return { launch: before.launch, coldLaunch: cold.launch }
}

/**
 * The configuration the app reports through its test-build marker:
 * `live-font-env-<scope>~<react native>~<scheme>~<ltr|rtl>~<density>~<language>`.
 */
export function parseEnvironment(id) {
  const [, reactNativeVersion, scheme, direction, density, language] =
    String(id).split('~')
  if (!language) return undefined
  return { reactNativeVersion, scheme, direction, density: Number(density), language }
}

/** The installed app's configuration from a flattened hierarchy, or an empty reading. */
export function readEnvironment(flat) {
  return flat.environment ?? {}
}

/**
 * The window's bounds. Maestro's root node carries none, so this is the union of every bounded
 * node, which the full-screen root view spans.
 */
export function windowBounds(tree) {
  let box
  const walk = (node) => {
    const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(
      node?.attributes?.bounds ?? ''
    )
    if (match) {
      const [l, t, r, b] = match.slice(1).map(Number)
      box = box
        ? [
            Math.min(box[0], l),
            Math.min(box[1], t),
            Math.max(box[2], r),
            Math.max(box[3], b),
          ]
        : [l, t, r, b]
    }
    for (const child of node?.children ?? []) walk(child)
  }
  walk(tree)
  return box ? `[${box[0]},${box[1]}][${box[2]},${box[3]}]` : undefined
}

/**
 * The same layout up to one vertical shift of at most `maxShift` for the scrolled app nodes,
 * with fixed chrome unmoved. Returning
 * to the top of a scroll view on Android can leave the content a few pixels off after the
 * stretch overscroll, with nothing else changed.
 */
export function sameLayoutShifted(a, b, maxShift = 12) {
  const app = (nodes) =>
    nodes.filter((node) => !/^com\.android\.systemui:/.test(node.id ?? ''))
  const [left, right] = [app(a), app(b)]
  if (left.length !== right.length || !left.length) return false
  const box = (node) =>
    /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.bounds)?.slice(1).map(Number)
  let shift
  for (let index = 0; index < left.length; index += 1) {
    const [x, y] = [left[index], right[index]]
    if (x.id !== y.id || x.text !== y.text) return false
    const [p, q] = [box(x), box(y)]
    if (!p || !q || p[0] !== q[0] || p[2] !== q[2]) return false
    // Fixed chrome (header, chips, tab bar) does not move; scrolled content moves together.
    const top = q[1] - p[1]
    if (top === 0) continue
    shift ??= top
    if (top !== shift) return false
  }
  return shift === undefined || Math.abs(shift) <= maxShift
}

/**
 * Why the screen did not come back to the capture after the scroll-through. When a text the
 * capture shows changed height, the scroll made the screen measure its text again: the settled
 * capture was stale until an interaction (a relayout on scroll). Otherwise the content only
 * moved: the scroll position was lost.
 */
export function restoreFailure(captured, after, tolerance = 2) {
  const heights = new Map()
  for (const node of captured) {
    const [y, bottom] = edges(node)
    heights.set(identityOf(node), bottom - y)
  }
  const relaid = after.some((node) => {
    const before = heights.get(identityOf(node))
    const [y, bottom] = edges(node)
    return before !== undefined && Math.abs(bottom - y - before) > tolerance
  })
  return relaid ? 'live_font_relayout_on_scroll' : 'live_font_scroll_not_restored'
}
