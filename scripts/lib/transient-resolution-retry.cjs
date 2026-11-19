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

/**
 * Gradle's marks of test cases that ran and failed: a failed case
 * (`ModalSystemBarsTest > appliesLightBarsOnApi33 FAILED`), the closing summary, or a connected
 * run's per-device summary. A test task's own `> Task ... FAILED` line is not one: the task also
 * fails that way when it cannot resolve its inputs before any test runs (the connected task's
 * UTP dependencies, for one).
 */
const GRADLE_TEST_FAILURE =
  /^\S+ > .+ FAILED\s*$|There were failing tests|^Tests on .+ failed: \d+/m

/**
 * An artifact download that failed: Gradle's `Could not GET` (or HEAD, resolve, download) and the
 * `Server returned HTTP response code: 429 for URL:` that Robolectric's runtime fetch prints.
 */
const ARTIFACT_DOWNLOAD_FAILURE =
  /Could not (?:GET|HEAD|resolve|download)\b|Server returned HTTP response code: \d{3} for URL:/

/**
 * Gradle nests a failure's causes as indented `>` lines under the line they explain:
 *
 *   > Could not resolve com.android.tools.utp:android-device-provider-ddmlib:31.11.0.
 *      > Could not GET 'https://dl.google.com/...'.
 *         > Read timed out
 *
 * so a download failure's transient cause can sit on a later line than the download.
 */
const NESTED_CAUSE = /^(\s*)> /

/**
 * The transient error inside the first failed artifact download that has one: the download's own
 * line, or a cause nested under it. Undefined when no failed download names a transient error.
 */
function transientDownloadFailure(output) {
  const lines = output.split('\n')
  for (const [at, line] of lines.entries()) {
    if (!ARTIFACT_DOWNLOAD_FAILURE.test(line)) continue
    const depth = (NESTED_CAUSE.exec(line)?.[1] ?? '').length
    for (let next = at; next < lines.length; next += 1) {
      const cause = lines[next]
      if (next > at) {
        const nested = NESTED_CAUSE.exec(cause)
        if (!nested || nested[1].length <= depth) break
      }
      const match = TRANSIENT_RESOLUTION_FAILURE.exec(cause)
      if (match) return match[0]
    }
  }
  return undefined
}

/** Waits before the second and third attempts. */
const RESOLUTION_RETRY_DELAYS_MS = Object.freeze([20000, 40000])

/**
 * The transient download error a failed run printed, or undefined when it printed none.
 *
 * - A run killed by a signal (a timeout) is never retried.
 * - A run whose test cases failed (GRADLE_TEST_FAILURE) is retried only when it also printed a
 *   failed artifact download whose own line or nested cause is transient: Robolectric fetching
 *   its Android runtime fails the cases that way. A timeout or a 429 that a test's own output
 *   merely mentions, with no failed download, never retries it. So an assertion failure runs
 *   once unless the same run also failed a transient artifact download.
 * - Any other failed run, a test task that failed before its tests ran included, is retried on a
 *   transient failed download (multiline causes included) or any other transient error it
 *   printed (the wrapper's distribution download, a reset connection).
 */
function transientResolutionFailure(result) {
  if (result.status === 0 || result.signal) return undefined
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const download = transientDownloadFailure(output)
  if (GRADLE_TEST_FAILURE.test(output)) return download
  if (download !== undefined) return download
  const match = TRANSIENT_RESOLUTION_FAILURE.exec(output)
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
  ARTIFACT_DOWNLOAD_FAILURE,
  GRADLE_TEST_FAILURE,
  RESOLUTION_RETRY_DELAYS_MS,
  TRANSIENT_RESOLUTION_FAILURE,
  isTransientResolutionFailure,
  runWithResolutionRetry,
  transientResolutionFailure,
}
