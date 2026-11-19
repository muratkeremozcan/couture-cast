// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
//
// Runs a parsed Maestro command list against a scripted screen on a virtual clock, so a guarded
// retry subflow can be exercised against faults a real device produces only by chance (a cancelled
// touch, a sheet that draws late, an opener that never answers). It interprets the real flow file:
// a change to the YAML changes what runs here.
//
// It implements the subset of the pinned Maestro (scripts/maestro-version.mjs, 2.8.0, commit
// b63727604c3f28fd97504d4f2d04371bad63e509) that tap-outfit-open.yaml uses, with the timing rules
// read from that commit:
// - Every lookup is MaestroTimer.withTimeout: a do-while loop of hierarchy reads, so a lookup with
//   a zero window still reads once. A read sees the screen as it is when the read completes.
// - Windows shrink with time: a lookup without its own timeout gets its default minus the time
//   since the last mutating command (Orchestra.adjustedToLatestInteraction, floored at 0). A tap
//   and a flow that ran one are mutating; a condition, a wait and a failed command are not.
// - `retry` runs its block; a failed command restarts the block from its first command.
//   `maxRetries` reads as an integer (a non-integer reads as 1), is capped at 3
//   (MAX_RETRIES_ALLOWED), and a negative value runs the block zero times.
// - `runFlow` with `when`: `visible` looks the element up for the adjusted 7 s optional lookup
//   window. `notVisible` loops for the adjusted 7 s window over a nested 500 ms lookup of the
//   element, and passes only on a nested lookup that does not find it.
// - `tapOn` looks its element up for the adjusted 17 s window (7 s when optional), then settles
//   the app, presses once (retryTapIfNoChange and waitUntilVisible default to false), and settles
//   again (Maestro.tap and hierarchyBasedTap).
// - `extendedWaitUntil` with `visible` looks the element up for its timeout, adjusted the same way.
// - `optional: true` on a command turns its failure into a pass.
// - A lookup that misses costs one more hierarchy read: Orchestra.findElement throws
//   ElementNotFound carrying maestro.viewHierarchy(). That holds for a missed `visible` condition,
//   for every nested `notVisible` search that misses (the read comes after the miss decided the
//   condition) and for a tapOn lookup. An `extendedWaitUntil` that misses reads twice: the
//   ElementNotFound read, then the AssertionFailure that assertConditionCommand throws with another
//   maestro.viewHierarchy(). These reads only spend time; nothing decides on what they see.
// Any other command, key, condition or retry value throws, so the model never skips a step it does
// not know. Timing (one read, one settle, one press) is a parameter: the tests run both sides of a
// boundary that moves with it.
//
// What this does not prove: that the device delivers a press, how long real hierarchy reads and
// settles take on a loaded simulator, what a press that lands on an open sheet does, or that a
// later Maestro release keeps these rules. The pinned version and the device lanes cover those.

/**
 * The Maestro release these rules were read from. maestro-flow-model.test.mjs fails when the
 * repository pin (scripts/maestro-version.mjs) moves, so a bump re-reads the rules first.
 */
export const MAESTRO_MODEL_VERSION = '2.8.0'

/** Orchestra.lookupTimeoutMs: a tapOn element lookup. */
export const MAESTRO_LOOKUP_MS = 17_000
/** Orchestra.optionalLookupTimeoutMs: an optional lookup and every `when` condition. */
export const MAESTRO_OPTIONAL_LOOKUP_MS = 7_000
/** The nested element lookup inside a `notVisible` condition. */
export const MAESTRO_NOT_VISIBLE_SEARCH_MS = 500

/** A command of the flow failed; `elapsedMs` is the virtual time the flow had run. */
export class MaestroModelStepFailed extends Error {
  constructor(message, elapsedMs) {
    super(message)
    this.elapsedMs = elapsedMs
  }
}

const unsupported = (what) => {
  throw new Error(`maestro_model_unsupported: ${what}`)
}
const onlyKeys = (name, body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) unsupported(name)
  for (const key of Object.keys(body))
    if (!allowed.includes(key)) unsupported(`${name}.${key}`)
}
const elementId = (selector) => {
  onlyKeys('selector', selector, ['id'])
  if (typeof selector.id !== 'string') unsupported('selector.id')
  return selector.id
}
const positive = (name, value) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`maestro_model_${name}`)
}

/**
 * Runs `commands` against `screen`: `{ isVisible(id, atMs), press(id, atMs) }`. `timing` gives
 * one hierarchy read (`readMs`), one app settle (`settleMs`) and one driver press (`pressMs`).
 * Returns the virtual time the flow took, or throws `MaestroModelStepFailed` naming the command
 * that failed.
 */
export function runMaestroModel(commands, screen, { readMs, settleMs, pressMs } = {}) {
  positive('read_ms', readMs)
  positive('settle_ms', settleMs)
  positive('press_ms', pressMs)
  let now = 0
  // Orchestra.runFlow stamps the flow's start as the last interaction.
  let lastInteraction = 0
  const fail = (message) => {
    throw new MaestroModelStepFailed(message, now)
  }
  const adjusted = (windowMs) => Math.max(0, windowMs - (now - lastInteraction))

  /** MaestroTimer.withTimeout: runs `block` until it answers non-null, at least once. */
  const withTimeout = (windowMs, block) => {
    const end = now + windowMs
    do {
      const answer = block()
      if (answer !== null) return answer
    } while (now < end)
    return null
  }
  /** Hierarchy read for an exception's report (ElementNotFound, AssertionFailure). */
  const failureRead = () => {
    now += readMs
  }
  /**
   * Orchestra.findElement over Maestro.findElementWithTimeout: one hierarchy read per try, and on a
   * miss the ElementNotFound read.
   */
  const found = (id, windowMs) => {
    const hit =
      withTimeout(windowMs, () => {
        now += readMs
        return screen.isVisible(id, now) ? true : null
      }) === true
    if (!hit) failureRead()
    return hit
  }

  const condition = (when) => {
    onlyKeys('when', when, ['visible', 'notVisible'])
    if (
      when.visible &&
      !found(elementId(when.visible), adjusted(MAESTRO_OPTIONAL_LOOKUP_MS))
    )
      return false
    if (when.notVisible) {
      const id = elementId(when.notVisible)
      const gone = withTimeout(adjusted(MAESTRO_OPTIONAL_LOOKUP_MS), () =>
        found(id, MAESTRO_NOT_VISIBLE_SEARCH_MS) ? null : true
      )
      if (gone !== true) return false
    }
    return true
  }

  /** Each command returns whether it mutated the app, as Orchestra's executeCommand does. */
  const commandsByName = {
    retry(body) {
      onlyKeys('retry', body, ['maxRetries', 'commands'])
      // RetryCommand: maxRetries?.toIntOrNull() ?: 1, then coerceAtMost(3); a negative value
      // runs the block zero times.
      const text = body.maxRetries === undefined ? '' : String(body.maxRetries)
      const asked = /^[+-]?\d+$/.test(text) ? Number(text) : 1
      const attempts = Math.min(asked, 3) + 1
      if (attempts <= 0) return false
      for (let attempt = 1; ; attempt++) {
        try {
          return run(body.commands)
        } catch (error) {
          if (!(error instanceof MaestroModelStepFailed) || attempt >= attempts)
            throw error
        }
      }
    },
    runFlow(body) {
      onlyKeys('runFlow', body, ['when', 'commands', 'optional'])
      if (body.when && !condition(body.when)) return false
      return run(body.commands)
    },
    tapOn(body) {
      onlyKeys('tapOn', body, ['id', 'optional'])
      const id = elementId({ id: body.id })
      const window = adjusted(
        body.optional === true ? MAESTRO_OPTIONAL_LOOKUP_MS : MAESTRO_LOOKUP_MS
      )
      if (!found(id, window)) fail(`tapOn ${id}: not visible`)
      now += settleMs
      now += pressMs
      screen.press(id, now)
      now += settleMs
      return true
    },
    extendedWaitUntil(body) {
      onlyKeys('extendedWaitUntil', body, ['visible', 'timeout', 'optional'])
      positive('extended_wait_timeout', body.timeout)
      const id = elementId(body.visible)
      if (!found(id, adjusted(body.timeout))) {
        // assertConditionCommand: AssertionFailure carries its own maestro.viewHierarchy().
        failureRead()
        fail(`extendedWaitUntil ${id}: not visible after ${body.timeout} ms`)
      }
      return false
    },
  }
  const execute = (name, body) =>
    Object.hasOwn(commandsByName, name) ? commandsByName[name](body) : unsupported(name)

  function run(list) {
    if (!Array.isArray(list)) unsupported('command list')
    let mutated = false
    for (const step of list) {
      if (!step || typeof step !== 'object' || Object.keys(step).length !== 1)
        unsupported(`step ${JSON.stringify(step)}`)
      const [name] = Object.keys(step)
      try {
        if (execute(name, step[name])) {
          mutated = true
          lastInteraction = now
        }
      } catch (error) {
        if (!(error instanceof MaestroModelStepFailed) || step[name]?.optional !== true)
          throw error
      }
    }
    return mutated
  }

  run(commands)
  return now
}
