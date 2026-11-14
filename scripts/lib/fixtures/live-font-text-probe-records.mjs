// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Test double for the F-00i text layout probe: the answer a healthy screen gives, one record per
// hierarchy text node with its content inside its own box, built from a capture's nodes. Specs
// start from it and change single records to make each judging rule's red case.

const SYSTEM_UI = /^com\.android\.systemui:/

export function rectOf(bounds) {
  if (Array.isArray(bounds)) return bounds.map(Number)
  const match = /^\[(-?[\d.]+),(-?[\d.]+)\]\[(-?[\d.]+),(-?[\d.]+)\]$/.exec(
    String(bounds)
  )
  if (!match) throw new Error(`fixture bounds: ${bounds}`)
  return match.slice(1).map(Number)
}

/** One healthy record: content, visible part and clip bounds all equal to the view's rect. */
export function probeRecord(platform, text, rect, overrides = {}) {
  const box = rectOf(rect)
  return {
    kind: platform === 'ios' ? 'RCTParagraphComponentView' : 'ReactTextView',
    text,
    window: 1,
    viewRect: box,
    visibleRect: box,
    clipRect: box,
    contentRect: box,
    scrolledAway: false,
    lineCount: 1,
    maxLines: null,
    ellipsized: 0,
    unlimitedLineCount: null,
    ...overrides,
  }
}

/** A healthy answer for `capture`: one record per app text node, one focused window. */
export function healthyAnswer(capture, platform, { token = 'fixture' } = {}) {
  const window = capture.window ? rectOf(capture.window) : [0, 0, 100000, 100000]
  return {
    version: 1,
    token,
    platform,
    windows: [{ id: 1, rect: window, z: 0, focused: true }],
    records: (capture.nodes ?? [])
      .filter((node) => node.text && !SYSTEM_UI.test(node.id ?? '') && !node.volatile)
      .map((node) => probeRecord(platform, node.text, node.bounds)),
  }
}

/** `capture` with a healthy probe answer, unless it carries one already. */
export function withTextProbe(capture, platform) {
  if (!capture || capture.textProbe) return capture
  return { ...capture, textProbe: healthyAnswer(capture, platform) }
}

const CAPTURES = [
  'before',
  'immediate',
  'settled',
  'cold',
  'coldBefore',
  'coldBase',
  'coldBaseUpdated',
  'updated',
  'coldUpdated',
]

/** A live change whose captures each carry a probe answer (healthy unless already given). */
export function withTextProbes(change) {
  const platform = change.platform
  const result = { ...change }
  for (const name of CAPTURES)
    if (result[name]) result[name] = withTextProbe(result[name], platform)
  if (result.earlier)
    result.earlier = result.earlier.map((c) => withTextProbe(c, platform))
  return result
}
