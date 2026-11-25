import type { Page } from '@playwright/test'
import { recurse } from '@seontechnologies/playwright-utils/recurse'

/**
 * Story CC-7.7 (AC5, spec D7): the layout-shift meter behind
 * playwright/tests/signed-in-shell-layout-shift.spec.ts. Test design:
 * _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
 * (7.7-UNIT-001..004 in layout-shift-meter.spec.ts, 7.7-E2E-001..009).
 *
 * The browser's cumulative layout shift drops entries that land within 500 ms of input
 * (`hadRecentInput`). A tab switch is input, so that score would hide every shift a tap causes.
 * This meter sums every entry over the whole transition instead, and samples the header and tab
 * bar position and the visibility of named elements on every animation frame.
 */

export type MeterRect = { x: number; y: number; width: number; height: number }

export type ShiftEntry = {
  value: number
  startTime: number
  hadRecentInput: boolean
  /** The nodes the browser says moved, as `tag[data-testid]` of the nearest named ancestor. */
  sources: string[]
}

export type ShellFrame = {
  t: number
  header: MeterRect | null
  nav: MeterRect | null
  /** Watched test IDs that were visible in this frame. */
  visible: string[]
  /** `data-screen` of every gate that carried `data-ready="true"` in this frame. */
  ready: string[]
  /** `data-screen` of every gate in the document in this frame, ready or not. */
  present: string[]
  scrollY: number
  /** Watched strings found in the rendered text (`innerText`, so hidden text is not seen). */
  texts: string[]
}

export type MeterSnapshot = {
  now: number
  shifts: ShiftEntry[]
  frames: ShellFrame[]
}

export type MeterConfig = {
  headerSelector: string
  navSelector: string
  gateSelector: string
  watchTestIds: string[]
  /** Strings to look for in the rendered text every frame; costs a layout read, so opt in. */
  watchText?: string[]
}

export const SHELL_METER_CONFIG: MeterConfig = {
  headerSelector: '[data-testid="app-header"]',
  navSelector: '[data-testid="sticky-bottom-nav"]',
  gateSelector: '[data-testid="screen-gate"]',
  watchTestIds: [
    'screen-placeholder',
    'home-demo-outfit',
    'guest-preview-entry',
    'landing-sign-in',
    'landing-sign-up',
    'member-sample-outfit',
    'home-live-outfit',
  ],
}

const METER_GLOBAL = '__ccShellMeter'

/**
 * Runs in the page before any app script (page.addInitScript). Self-contained: Playwright
 * serializes its source, so it may not close over anything in this module.
 */
export function installShellMeter(config: MeterConfig) {
  type Rect = { x: number; y: number; width: number; height: number }
  const state = {
    shifts: [] as {
      value: number
      startTime: number
      hadRecentInput: boolean
      sources: string[]
    }[],
    frames: [] as {
      t: number
      header: Rect | null
      nav: Rect | null
      visible: string[]
      ready: string[]
      present: string[]
      scrollY: number
      texts: string[]
    }[],
  }
  // Literal key: this function's source runs in the page, where METER_GLOBAL does not exist.
  ;(window as unknown as Record<string, unknown>)['__ccShellMeter'] = state

  const describe = (node: Node | null | undefined): string => {
    let element: Element | null =
      node instanceof Element ? node : (node?.parentElement ?? null)
    const tag = element ? element.tagName.toLowerCase() : 'unknown'
    while (element && !element.getAttribute('data-testid'))
      element = element.parentElement
    return element
      ? `${tag} in [data-testid="${element.getAttribute('data-testid')}"]`
      : tag
  }

  try {
    new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as PerformanceEntry & {
          value: number
          hadRecentInput: boolean
          sources?: { node?: Node | null }[]
        }
        state.shifts.push({
          value: entry.value,
          startTime: entry.startTime,
          hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources ?? []).map((source) => describe(source.node)),
        })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {
    // A browser without layout-shift entries leaves `shifts` empty; the spec runs in Chromium,
    // and the positive control (7.7-E2E-007) fails if entries never arrive.
  }

  const rectOf = (selector: string): Rect | null => {
    const element = document.querySelector(selector)
    if (!element || !element.checkVisibility()) return null
    const box = element.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  const sample = () => {
    const visible: string[] = []
    for (const testId of config.watchTestIds) {
      for (const element of Array.from(
        document.querySelectorAll(`[data-testid="${testId}"]`)
      )) {
        if (element.checkVisibility()) {
          visible.push(testId)
          break
        }
      }
    }
    const gates = Array.from(document.querySelectorAll(config.gateSelector))
    const ready = gates
      .filter((gate) => gate.getAttribute('data-ready') === 'true')
      .map((gate) => gate.getAttribute('data-screen') ?? '')
    state.frames.push({
      t: performance.now(),
      header: rectOf(config.headerSelector),
      nav: rectOf(config.navSelector),
      visible,
      ready,
      present: gates.map((gate) => gate.getAttribute('data-screen') ?? ''),
      scrollY: window.scrollY,
      texts: (config.watchText ?? []).filter((text) =>
        (document.body?.innerText ?? '').includes(text)
      ),
    })
    requestAnimationFrame(sample)
  }
  // The first frame is the first paint the document gets: rAF callbacks run before paint.
  const start = () => requestAnimationFrame(sample)
  if (document.documentElement) start()
  else document.addEventListener('readystatechange', start, { once: true })
}

/** 7.7-UNIT-001/002: every entry in the window counts, input or not. */
export function shiftScore(shifts: ShiftEntry[], fromMs: number, toMs = Infinity) {
  return shifts
    .filter((entry) => entry.startTime >= fromMs && entry.startTime <= toMs)
    .reduce((sum, entry) => sum + entry.value, 0)
}

/** The entries in the window, largest first, for a failure message that names what moved. */
export function describeShifts(shifts: ShiftEntry[], fromMs: number, toMs = Infinity) {
  return shifts
    .filter((entry) => entry.startTime >= fromMs && entry.startTime <= toMs)
    .sort((a, b) => b.value - a.value)
    .map(
      (entry) =>
        `${entry.value.toFixed(4)} at ${Math.round(entry.startTime - fromMs)} ms` +
        `${entry.hadRecentInput ? ' (after input)' : ''}: ${entry.sources.join(', ') || 'no source'}`
    )
}

/**
 * 7.7-UNIT-003: a transition has settled when the screen's gate is ready, no stubbed request is
 * in flight, and no shift landed for `quietMs` since the later of the window start and the
 * last shift.
 */
export function isSettled(input: {
  snapshot: MeterSnapshot
  fromMs: number
  screen: string
  inflight: number
  quietMs: number
}) {
  const { snapshot, fromMs, screen, inflight, quietMs } = input
  const lastFrame = snapshot.frames.at(-1)
  if (!lastFrame || lastFrame.t < fromMs || !lastFrame.ready.includes(screen))
    return false
  if (inflight > 0) return false
  const lastShift = snapshot.shifts
    .filter((entry) => entry.startTime >= fromMs)
    .reduce((latest, entry) => Math.max(latest, entry.startTime), fromMs)
  const readySince =
    snapshot.frames.find((frame) => frame.t >= fromMs && frame.ready.includes(screen))
      ?.t ?? snapshot.now
  return snapshot.now - Math.max(lastShift, readySince) >= quietMs
}

const moved = (a: MeterRect | null, b: MeterRect | null, tolerancePx: number) => {
  if (a === null || b === null) return a !== b
  return (
    Math.abs(a.x - b.x) > tolerancePx ||
    Math.abs(a.y - b.y) > tolerancePx ||
    Math.abs(a.width - b.width) > tolerancePx ||
    Math.abs(a.height - b.height) > tolerancePx
  )
}

/**
 * 7.7-UNIT-004 (AC2): the first frame in the window whose rect differs from the window's first
 * rendered rect. Frames before the element first renders are skipped; once it has rendered,
 * disappearing counts as a move.
 */
export function firstRectMove(
  frames: ShellFrame[],
  key: 'header' | 'nav',
  fromMs: number,
  toMs = Infinity,
  tolerancePx = 0.5
) {
  const inWindow = frames.filter((frame) => frame.t >= fromMs && frame.t <= toMs)
  const baseline = inWindow.find((frame) => frame[key] !== null)
  if (!baseline) return null
  for (const frame of inWindow.slice(inWindow.indexOf(baseline) + 1)) {
    if (moved(baseline[key], frame[key], tolerancePx)) {
      return { t: frame.t - fromMs, from: baseline[key], to: frame[key] }
    }
  }
  return null
}

/** Watched strings rendered in any frame of the window, with the first time each was seen. */
export function textSightings(
  frames: ShellFrame[],
  texts: string[],
  fromMs: number,
  toMs = Infinity
) {
  const seen = new Map<string, number>()
  for (const frame of frames) {
    if (frame.t < fromMs || frame.t > toMs) continue
    for (const text of frame.texts) {
      if (texts.includes(text) && !seen.has(text)) seen.set(text, frame.t - fromMs)
    }
  }
  return Object.fromEntries(seen)
}

/** Watched test IDs seen in any frame of the window, with the first time each was seen. */
export function sightings(
  frames: ShellFrame[],
  testIds: string[],
  fromMs: number,
  toMs = Infinity
) {
  const seen = new Map<string, number>()
  for (const frame of frames) {
    if (frame.t < fromMs || frame.t > toMs) continue
    for (const testId of frame.visible) {
      if (testIds.includes(testId) && !seen.has(testId))
        seen.set(testId, frame.t - fromMs)
    }
  }
  return Object.fromEntries(seen)
}

/** Watched test IDs seen in a frame where `screen`'s gate was not ready yet. */
export function sightingsBeforeReady(
  frames: ShellFrame[],
  testIds: string[],
  screen: string,
  fromMs: number,
  toMs = Infinity
) {
  const readyAt =
    frames.find((frame) => frame.t >= fromMs && frame.ready.includes(screen))?.t ?? toMs
  return sightings(frames, testIds, fromMs, Math.min(readyAt, toMs) - 0.001)
}

/**
 * The init script source. esbuild-based transforms (tsx, vite) wrap named functions in a
 * `__name` helper that exists only in Node, so the serialized function threw `__name is not
 * defined` in the page and recorded nothing; the shim keeps it working under any transform.
 */
export function shellMeterScript(config: MeterConfig = SHELL_METER_CONFIG) {
  return `(function(){var __name=function(f){return f};(${installShellMeter.toString()})(${JSON.stringify(config)})})()`
}

export async function installMeter(page: Page, config: MeterConfig = SHELL_METER_CONFIG) {
  await page.addInitScript({ content: shellMeterScript(config) })
}

/**
 * The meter's records from `sinceMs` on (page clock). A soft navigation keeps the document and
 * its records; a full navigation starts a new document with a new clock, which the spec rules
 * out for tab switches by checking a window marker survives the tap.
 */
export async function readMeter(page: Page, sinceMs = 0): Promise<MeterSnapshot> {
  return page.evaluate(
    ({ key, since }) => {
      const state = (
        window as unknown as Record<
          string,
          { shifts: ShiftEntry[]; frames: ShellFrame[] } | undefined
        >
      )[key]
      return {
        now: performance.now(),
        shifts: state ? state.shifts.filter((entry) => entry.startTime >= since) : [],
        frames: state ? state.frames.filter((frame) => frame.t >= since) : [],
      }
    },
    { key: METER_GLOBAL, since: sinceMs }
  )
}

/** The page clock now, the start of a tab-switch window. */
export async function meterNow(page: Page) {
  return page.evaluate(() => performance.now())
}

/**
 * Requests in flight on `page` whose URL matches, for the settle rule. Counting is all it does:
 * stubs and spies stay on interceptNetworkCall.
 */
export function trackInflight(page: Page, matches: (url: string) => boolean) {
  const open = new Set<unknown>()
  const done = (request: { url(): string }) => open.delete(request)
  page.on('request', (request) => {
    if (matches(request.url())) open.add(request)
  })
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return () => open.size
}

/**
 * Waits for the transition that started at `fromMs` to settle (isSettled) and returns the
 * meter's records for it. The quiet period makes a late shift land inside the window.
 */
export async function settleTransition(
  page: Page,
  options: {
    screen: string
    fromMs: number
    inflight: () => number
    quietMs?: number
    timeoutMs?: number
  }
) {
  const { screen, fromMs, inflight, quietMs = 1000, timeoutMs = 25_000 } = options
  const { snapshot } = await recurse(
    async () => ({ snapshot: await readMeter(page, fromMs), inflight: inflight() }),
    ({ snapshot, inflight: open }) =>
      isSettled({ snapshot, fromMs, screen, inflight: open, quietMs }),
    { timeout: timeoutMs, interval: 100, log: false }
  )
  return snapshot
}
