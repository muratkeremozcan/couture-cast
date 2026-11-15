// A Gradle build on a fresh CI runner downloads its plugins and dependencies from Maven Central
// and the Gradle plugin portal. Maven Central answers a busy runner pool with HTTP 429, and a 5xx
// or a dropped connection happens too: PR 233's run 43719645437 failed the share-card merger proof
// on a 429 for gson and kotlin-stdlib, and PR 238's run 43767969866 failed the modal system bars
// module on a 429 for gson (the foojay toolchain resolver plugin's dependency). Those failures say
// nothing about the code under test, so the build is retried after a wait. Any other failure (a
// compile error, a failing test, a merge conflict, an unresolvable version) fails at once.
//
// CommonJS, so the share-card merger proof (apps/mobile/plugins, CommonJS) and the Gradle retry
// command (scripts/ci/gradle-resolution-retry.mjs) share one signature and one retry loop.
'use strict'

/**
 * Gradle's dependency resolution words a rate limit or a server error as "status code 429";
 * the wrapper's own distribution download (HttpURLConnection) words it as "HTTP response
 * code: 504", so both spellings are matched. A 404 or a missing version never matches.
 */
const TRANSIENT_RESOLUTION_FAILURE =
  /Too Many Requests|status code 429|status code 5\d\d|HTTP response code: (?:429|5\d\d)|Connection reset|Connection timed out|Read timed out|Connect timed out|SocketTimeoutException|ConnectTimeoutException|Remote host terminated the handshake/i

/** Waits before the second and third attempts. */
const RESOLUTION_RETRY_DELAYS_MS = [20000, 40000]

/** The transient download error a failed run printed, or undefined when it printed none. */
function transientResolutionFailure(result) {
  if (result.status === 0) return undefined
  const match = TRANSIENT_RESOLUTION_FAILURE.exec(
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  )
  return match ? match[0] : undefined
}

function isTransientResolutionFailure(result) {
  return transientResolutionFailure(result) !== undefined
}

/**
 * Runs `run` until it succeeds, fails for a real reason, or the waits run out, and logs each
 * retry with the attempt number and the error that caused it. `run` returns a spawnSync-like
 * result ({ status, stdout, stderr }).
 */
function runWithResolutionRetry(
  run,
  {
    delaysMs = RESOLUTION_RETRY_DELAYS_MS,
    wait = sleepSync,
    log = (message) => console.warn(message),
  } = {}
) {
  const attempts = delaysMs.length + 1
  let result = run()
  for (const [index, delay] of delaysMs.entries()) {
    const failure = transientResolutionFailure(result)
    if (failure === undefined) return result
    log(
      `Attempt ${index + 1}/${attempts} hit a transient download error (${failure}); ` +
        `retrying in ${delay / 1000} s.`
    )
    wait(delay)
    result = run()
  }
  const failure = transientResolutionFailure(result)
  if (failure !== undefined)
    log(
      `Attempt ${attempts}/${attempts} hit a transient download error (${failure}); giving up.`
    )
  return result
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

module.exports = {
  RESOLUTION_RETRY_DELAYS_MS,
  TRANSIENT_RESOLUTION_FAILURE,
  isTransientResolutionFailure,
  runWithResolutionRetry,
  transientResolutionFailure,
}
