/**
 * Finds `scrollUntilVisible` steps that asked Maestro to center an element it could never
 * center.
 *
 * With `centerElement: true`, Maestro 2.8 accepts a fully visible element only once it is
 * near the middle of the screen; until then it swipes again, up to five times, before it
 * settles for plain 100% visibility. An element pinned to a scroll edge (the last child of a
 * screen, or a row at the end of a list) never moves, so every one of those swipes is wasted:
 * about 1.6 s each on a CI emulator. In CI run 44068684535 (job 133989193086) the
 * `guest-preview-exit` step of guest-preview.yaml spent about 8 s of its 20 s timeout this
 * way and failed on a slow emulator. Without `centerElement`, Maestro already requires 100%
 * visibility (ScrollUntilVisibleCommand.DEFAULT_ELEMENT_VISIBILITY_PERCENTAGE = 100), so the
 * option buys nothing on such an element.
 *
 * Maestro logs every try of the centering loop in its debug `maestro.log`:
 *
 *   ... scrollUntilVisible: Scrolling try count: 0, DeviceWidth: 1080, DeviceWidth: 2400
 *   ... scrollUntilVisible: Element bounds: Bounds(x=42, y=2096, width=996, height=115)
 *   ... scrollUntilVisible: Visibility Percent: 1.0
 *
 * A step whose element was fully visible at the same bounds on two or more tries swiped
 * without moving it, which is the pinned-element signature reported here.
 */
import fs from 'node:fs'

import { newestFlowDebugLog } from './maestro-flow-outcome.mjs'

// Maestro names a step's start and end through CliConsoleListener (with a JUnit report) or
// MaestroCommandRunner.runCommands lambdas (without one).
const COMMAND_START = /maestro\.cli\.runner\.\S+: (.+) RUNNING\s*$/
const COMMAND_FINISH =
  /maestro\.cli\.runner\.\S+: (.+) (?:COMPLETED|FAILED|SKIPPED|WARNED)\s*$/
const TRY_COUNT = /scrollUntilVisible: Scrolling try count: \d+/
const ELEMENT_BOUNDS = /scrollUntilVisible: Element bounds: (Bounds\(.*\))\s*$/
const VISIBILITY = /scrollUntilVisible: Visibility Percent: ([\d.]+)\s*$/
const COMMAND_SELECTOR =
  /scrollUntilVisible: Command centerElement: ScrollUntilVisibleCommand\(selector=ElementSelector\(textRegex=(.*?), idRegex=(.*?), size=/
const STEP_SELECTOR = / until (.+?) is visible\b/

/**
 * @typedef {{
 *   step: string
 *   selector: string | undefined
 *   bounds: string
 *   tries: number
 * }} PinnedCenterScroll
 */

/**
 * @param {string} textRegex
 * @param {string} idRegex
 * @returns {string | undefined}
 */
const describeSelector = (textRegex, idRegex) => {
  const parts = []
  if (textRegex !== 'null') parts.push(`text: ${textRegex}`)
  if (idRegex !== 'null') parts.push(`id: ${idRegex}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

/**
 * Every step in a debug `maestro.log` whose element was fully visible at identical bounds
 * on two or more `scrollUntilVisible` tries.
 *
 * @param {string | undefined} logText
 * @returns {PinnedCenterScroll[]}
 */
export function findPinnedCenterScrolls(logText) {
  if (!logText) return []
  /**
   * @typedef {{
   *   step: string
   *   selector: string | undefined
   *   bounds: string | undefined
   *   fullyVisible: Map<string, number>
   * }} RunningStep
   */
  /** @type {RunningStep[]} */
  const running = []
  /** @type {RunningStep[]} */
  const steps = []

  for (const line of logText.split('\n')) {
    const started = COMMAND_START.exec(line)
    if (started) {
      const step = {
        step: started[1],
        selector: STEP_SELECTOR.exec(started[1])?.[1],
        bounds: undefined,
        fullyVisible: new Map(),
      }
      running.push(step)
      steps.push(step)
      continue
    }
    const finished = COMMAND_FINISH.exec(line)
    if (finished) {
      const index = running.findLastIndex(({ step }) => step === finished[1])
      if (index !== -1) running.splice(index, 1)
      continue
    }
    // Scroll lines belong to the innermost step still running.
    const current = running.at(-1)
    if (!current) continue
    if (TRY_COUNT.test(line)) {
      current.bounds = undefined
      continue
    }
    const bounds = ELEMENT_BOUNDS.exec(line)
    if (bounds) {
      current.bounds = bounds[1]
      continue
    }
    const visibility = VISIBILITY.exec(line)
    if (visibility && current.bounds !== undefined && Number(visibility[1]) >= 1) {
      current.fullyVisible.set(
        current.bounds,
        (current.fullyVisible.get(current.bounds) ?? 0) + 1
      )
      continue
    }
    const selector = COMMAND_SELECTOR.exec(line)
    if (selector)
      current.selector = describeSelector(selector[1], selector[2]) ?? current.selector
  }

  return steps.flatMap(({ step, selector, fullyVisible }) =>
    [...fullyVisible]
      .filter(([, tries]) => tries >= 2)
      .map(([bounds, tries]) => ({ step, selector, bounds, tries }))
  )
}

/**
 * The failure cause for one pinned-element step.
 *
 * @param {PinnedCenterScroll} finding
 * @returns {string}
 */
export function describePinnedCenterScroll({ step, selector, bounds, tries }) {
  const element = selector ? ` (${selector})` : ''
  return `scrollUntilVisible step "${step}"${element} stayed at ${bounds} with 100% visibility for ${tries} tries: centerElement was set on an element pinned to a scroll edge, so it can never be centered and every swipe is wasted; remove centerElement from this step`
}

/**
 * The failure cause for a flow Maestro finished without a debug log the guard could find.
 *
 * @param {string} debugRoot
 * @param {string} flowTitle
 * @returns {string}
 */
export function describeMissingDebugLog(debugRoot, flowTitle) {
  return `pinned-center check: Maestro finished the flow but left no debug log for "${flowTitle}" under ${debugRoot}, so its scrollUntilVisible steps went unchecked`
}

/**
 * Every failure cause the pinned-element guard finds for one flow run: one per pinned
 * step in the flow's newest debug log written since `startedAtMs`, or, when Maestro
 * `finished` the flow (it wrote a report or exited cleanly) and left no such log, the
 * missing log itself, since a guard that cannot read the log would otherwise pass every
 * flow unread. A flow Maestro never finished already failed with its own cause.
 *
 * @param {{
 *   debugRoot: string
 *   flowTitle: string
 *   startedAtMs: number
 *   finished: boolean
 * }} options `debugRoot` holds one folder per Maestro run (`--debug-output`), or one per
 *   flow with `--flatten-debug-output`; `flowTitle` is maestroFlowTitle's
 * @returns {string[]}
 */
export function pinnedCenterScrollCauses({
  debugRoot,
  flowTitle,
  startedAtMs,
  finished,
}) {
  const logFile = newestFlowDebugLog(debugRoot, flowTitle, { sinceMs: startedAtMs })
  if (!logFile) return finished ? [describeMissingDebugLog(debugRoot, flowTitle)] : []
  return findPinnedCenterScrolls(fs.readFileSync(logFile, 'utf8')).map(
    describePinnedCenterScroll
  )
}
