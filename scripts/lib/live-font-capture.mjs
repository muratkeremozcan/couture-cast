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

/**
 * Text nodes with their parent's bounds. Android puts a TextView's string in `text`; iOS puts a
 * static text's label in `accessibilityText` when `text` is empty, so it falls back to that.
 */
export function flattenHierarchy(tree, { platform }) {
  const nodes = []
  const controls = []
  const markers = []
  const jsScales = []
  const walk = (node, parentBounds) => {
    const attrs = attributes(node)
    const id = attrs['resource-id'] ?? ''
    const bounds = attrs.bounds
    const marker = MARKER.exec(id)
    if (marker) markers.push(id)
    const reading = SCALE.exec(id)
    if (reading) jsScales.push(Number(reading[2]))
    const text = attrs.text || (platform === 'ios' ? (attrs.accessibilityText ?? '') : '')
    if (text && bounds)
      nodes.push({ text, id, bounds, ...(parentBounds ? { parent: parentBounds } : {}) })
    if (id && bounds) controls.push({ id, bounds })
    for (const child of node?.children ?? []) walk(child, bounds ?? parentBounds)
  }
  walk(tree, undefined)
  // Every marked window reads the same scale; disagreeing readings are no reading.
  const jsFontScale =
    jsScales.length && new Set(jsScales).size === 1 ? jsScales[0] : undefined
  return { nodes, controls, markers: markers.sort(), jsFontScale }
}

/** The mount markers joined in order: one string that changes when any marked mount changes. */
export function rootIdentity(markers) {
  return markers.length ? markers.join(',') : undefined
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

/** MainActivity onCreate calls in the Android event log (`wm_on_create_called`). */
export function countOnCreate(eventLog, component) {
  return String(eventLog)
    .split('\n')
    .filter((line) => line.includes('wm_on_create_called') && line.includes(component))
    .length
}

function top(node) {
  const match = /^\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/.exec(String(node.bounds))
  return match ? Number(match[2]) : 0
}

const identityOf = (node) => JSON.stringify([node.id ?? '', node.text])

/**
 * Joins scrolled pages into one text multiset. Each page is offset from the previous one by the
 * median shift of the identities that appear exactly once on both pages; a node whose identity
 * and shifted position match one already taken is the same node seen again.
 */
export function stitchPages(pages, { tolerance = 4 } = {}) {
  if (!pages.length) return []
  const taken = pages[0].map((node) => ({ key: identityOf(node), y: top(node) }))
  let offset = 0
  for (let index = 1; index < pages.length; index += 1) {
    const previous = pages[index - 1]
    const current = pages[index]
    const once = (page) => {
      const counts = new Map()
      for (const node of page)
        counts.set(identityOf(node), (counts.get(identityOf(node)) ?? 0) + 1)
      return new Map(
        page
          .filter((node) => counts.get(identityOf(node)) === 1)
          .map((node) => [identityOf(node), node])
      )
    }
    const [a, b] = [once(previous), once(current)]
    const shifts = [...a.keys()]
      .filter((key) => b.has(key))
      .map((key) => top(a.get(key)) - top(b.get(key)))
    if (!shifts.length) throw new Error('live_font_scroll_pages_disjoint')
    shifts.sort((x, y) => x - y)
    offset += shifts[Math.floor(shifts.length / 2)]
    for (const node of current) {
      const key = identityOf(node)
      const y = top(node) + offset
      if (!taken.some((seen) => seen.key === key && Math.abs(seen.y - y) <= tolerance))
        taken.push({ key, y })
    }
  }
  return taken.map(({ key }) => key)
}

/** Two hierarchies show the same layout when their text nodes and bounds are identical. */
export function sameLayout(a, b) {
  const shape = (nodes) =>
    JSON.stringify(nodes.map((node) => [node.id, node.text, node.bounds]))
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
