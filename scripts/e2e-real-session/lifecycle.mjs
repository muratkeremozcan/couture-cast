/**
 * The order a real-session run starts and stops in, apart from what it starts.
 *
 * `run.mjs` wires the steps; this module decides when each may happen, so the unit
 * tests can drive the same orchestration with stand-in steps and real child
 * processes (`playwright/support/helpers/real-session-lifecycle.spec.ts`).
 *
 * `run` is the whole startup sequence plus the test run, and returns the exit code.
 * It calls `owner.assertRunning()` after every await, so once teardown begins the
 * next step it reaches throws `TeardownStarted` instead of creating anything.
 * `release` frees what the run holds that is not a process: the Auth proxy, the
 * Auth users, the database, the artifact set.
 *
 * Teardown, once per run, whether `run` finished, threw, or a signal arrived:
 * 1. `owner.close()`: refuses new processes, then stops every process group the
 *    run started (the web build, the API stack, the web server, Playwright and
 *    their workers) and waits until each group is empty. No test worker can
 *    record another user after this point.
 * 2. Waits for `run` to settle, at most `settleMs`. A step that was mid-await
 *    (creating the database, starting the proxy) finishes and records what it
 *    made before its next `assertRunning()` rejects, so `release` sees it.
 * 3. `release`.
 */
import { TeardownStarted } from './process-owner.mjs'

/**
 * @param {{
 *   owner: { close(): Promise<void>; readonly closing: boolean }
 *   run: () => Promise<number>
 *   release: () => Promise<number>
 *   settleMs?: number
 *   log?: (message: string) => void
 *   reportError?: (error: unknown) => void
 * }} options
 */
export function startRunLifecycle({
  owner,
  run,
  release,
  settleMs = 15_000,
  log = () => undefined,
  reportError = () => undefined,
}) {
  /** @type {{ status: 'fulfilled'; value: number } | { status: 'rejected'; reason: unknown } | undefined} */
  let outcome
  const work = Promise.resolve()
    .then(run)
    .then(
      (value) => (outcome = { status: 'fulfilled', value }),
      (reason) => (outcome = { status: 'rejected', reason })
    )

  /** @type {(code: number) => void} */
  let resolveDone = () => undefined
  /** Resolves with the run's exit code once teardown has finished. */
  const done = new Promise((resolve) => (resolveDone = resolve))

  /** @type {Promise<number> | undefined} */
  let tearingDown
  /** @param {'completed' | 'signal'} reason */
  const teardown = (reason) =>
    (tearingDown ??= (async () => {
      let code = 0
      try {
        await owner.close()
      } catch (error) {
        log(`Stopping the run's processes failed: ${errorMessage(error)}`)
        code = 1
      }
      const settled = await Promise.race([
        work.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), settleMs).unref()),
      ])
      if (!settled) {
        log(`The startup sequence did not settle within ${settleMs / 1000}s.`)
        code = 1
      }
      if (reason === 'signal') code = 1
      else if (outcome?.status === 'fulfilled') code ||= outcome.value === 0 ? 0 : 1
      else {
        code = 1
        // A step stopped by teardown says so through TeardownStarted; anything else
        // is the run's real failure.
        if (outcome && !(outcome.reason instanceof TeardownStarted))
          reportError(outcome.reason)
      }
      try {
        if ((await release()) !== 0) code = 1
      } catch (error) {
        log(`Releasing the run's resources failed: ${errorMessage(error)}`)
        code = 1
      }
      resolveDone(code)
      return code
    })())

  void work.then(() => teardown('completed'))
  return { done, teardown, work }
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
