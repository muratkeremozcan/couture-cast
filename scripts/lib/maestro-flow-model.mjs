// Learning path Step 58: Production status and nightly health.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-status-and-nightly-health
//
// Runs a parsed Maestro command list against a scripted screen on a virtual clock, so a guarded
// retry subflow can be exercised against faults a real device produces only by chance (a cancelled
// touch, a sheet that draws late, an opener that never answers). It interprets the real flow file:
// a change to the YAML changes what runs here.
//
// The semantics are the pinned Maestro's (scripts/maestro-version.mjs, 2.8.0), read from
// maestro.orchestra.Orchestra in that release:
// - `retry` runs its block; any failed command restarts the block from its first command.
//   `maxRetries` defaults to 1 and is capped at 3, so a block runs at most four times.
// - `runFlow` with `when` checks `visible`, then `notVisible`, and runs its commands only when
//   both hold. `visible` waits up to the lookup window for the element to appear. `notVisible`
//   waits up to the window for the element to disappear: an element already absent passes at once.
// - `tapOn` waits up to the lookup window for its element, then presses it once (retryTapIfNoChange
//   defaults to false in 2.8.0).
// - `extendedWaitUntil` with `visible` polls until the element shows or its timeout passes.
// - `optional: true` on a command turns its failure into a pass.
// Any other command, key or condition throws, so the model never skips a step it does not know.
//
// What this does not prove: that the device delivers a press, how long a real hierarchy read
// takes, or that a later Maestro release keeps these rules. The pinned version and the device
// lanes cover those.

/** One hierarchy read, and the poll interval of every wait. */
export const MODEL_READ_MS = 1_000
/** A tap after its element is found. */
export const MODEL_TAP_MS = 500

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

/**
 * Runs `commands` against `screen`: `{ isVisible(id, atMs), press(id, atMs) }`, with `lookupMs`
 * as the window of a condition check and a tap's element lookup. Returns the virtual time the flow
 * took, or throws `MaestroModelStepFailed` naming the command that failed.
 */
export function runMaestroModel(commands, screen, { lookupMs } = {}) {
  if (!Number.isSafeInteger(lookupMs) || lookupMs < MODEL_READ_MS)
    throw new Error('maestro_model_lookup_ms')
  let now = 0
  const fail = (message) => {
    throw new MaestroModelStepFailed(message, now)
  }

  /** Reads the screen once per MODEL_READ_MS until `holds` is true or `windowMs` has passed. */
  const waitFor = (holds, windowMs) => {
    const until = now + windowMs
    for (;;) {
      now += MODEL_READ_MS
      if (holds(now)) return true
      if (now >= until) return false
    }
  }
  const shows = (id) => (at) => screen.isVisible(id, at)

  const condition = (when) => {
    onlyKeys('when', when, ['visible', 'notVisible'])
    if (when.visible && !waitFor(shows(elementId(when.visible)), lookupMs)) return false
    if (when.notVisible) {
      const isShown = shows(elementId(when.notVisible))
      if (!waitFor((at) => !isShown(at), lookupMs)) return false
    }
    return true
  }

  const commandsByName = {
    retry(body) {
      onlyKeys('retry', body, ['maxRetries', 'commands'])
      const asked = body.maxRetries === undefined ? 1 : Number(body.maxRetries)
      if (!Number.isSafeInteger(asked) || asked < 0) unsupported('retry.maxRetries')
      const attempts = Math.min(asked, 3) + 1
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
      if (body.when && !condition(body.when)) return
      run(body.commands)
    },
    tapOn(body) {
      onlyKeys('tapOn', body, ['id', 'optional'])
      const id = elementId({ id: body.id })
      if (!waitFor(shows(id), lookupMs)) fail(`tapOn ${id}: not visible`)
      now += MODEL_TAP_MS
      screen.press(id, now)
    },
    extendedWaitUntil(body) {
      onlyKeys('extendedWaitUntil', body, ['visible', 'timeout', 'optional'])
      if (!Number.isSafeInteger(body.timeout)) unsupported('extendedWaitUntil.timeout')
      const id = elementId(body.visible)
      if (!waitFor(shows(id), body.timeout))
        fail(`extendedWaitUntil ${id}: not visible after ${body.timeout} ms`)
    },
  }
  const execute = (name, body) =>
    Object.hasOwn(commandsByName, name) ? commandsByName[name](body) : unsupported(name)

  function run(list) {
    if (!Array.isArray(list)) unsupported('command list')
    for (const step of list) {
      if (!step || typeof step !== 'object' || Object.keys(step).length !== 1)
        unsupported(`step ${JSON.stringify(step)}`)
      const [name] = Object.keys(step)
      try {
        execute(name, step[name])
      } catch (error) {
        if (!(error instanceof MaestroModelStepFailed) || step[name]?.optional !== true)
          throw error
      }
    }
  }

  run(commands)
  return now
}
