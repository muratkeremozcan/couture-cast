// A Gradle build on a fresh CI runner downloads its plugins and dependencies from Maven Central
// and the Gradle plugin portal. Maven Central answers a busy runner pool with HTTP 429, and a 5xx
// or a dropped connection happens too: PR 233's run 43719645437 failed the share-card merger proof
// on a 429 for gson and kotlin-stdlib, and PR 238's run 43767969866 failed the modal system bars
// module on a 429 for gson (the foojay toolchain resolver plugin's dependency). Those failures say
// nothing about the code under test, so the build is retried after a wait. So is an artifact the
// repository did not serve for a module that resolved (PR 256 dispatch 44523800625), with
// --refresh-dependencies. Any other failure (a compile error, a failing test, a merge conflict,
// an unresolvable version) fails at once.
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
 * A test task's own FAILED line (`> Task :app:testDebugUnitTest FAILED`, or
 * `connectedDebugAndroidTest`). It marks a run whose test task failed, whether its cases failed,
 * its test JVM crashed, or it could not resolve its inputs before any test ran.
 */
const GRADLE_TEST_TASK_FAILURE = /^> Task \S*[Tt]est\S* FAILED\s*$/m

/**
 * An artifact download that failed, as the tool that downloaded it prints it: a line that starts
 * with Gradle's `Could not GET` (or HEAD, resolve, download), bare or as a nested `>` cause, or
 * with the `java.io.IOException: Server returned HTTP response code: 429 for URL:` that
 * Robolectric's runtime fetch prints (bare or after `Caused by:`). The same words quoted inside an
 * assertion's message (`AssertionError: expected "Could not GET ..."`) do not start the line.
 */
const ARTIFACT_DOWNLOAD_FAILURE =
  /^\s*(?:> )?Could not (?:GET|HEAD|resolve|download)\b|^\s*(?:Caused by: )?java\.io\.IOException: Server returned HTTP response code: \d{3} for URL:/

/**
 * A Gradle download failure in a run whose tests failed counts only where Gradle itself prints
 * it: in a cause tree that starts at column 0 (`> Could not resolve ...` and the indented `>`
 * lines under it), which is how Gradle's failure report (`* What went wrong:`) and its plugin
 * resolution errors print every download failure. Gradle's console indents a test's own output
 * under its case line, so a multiline assertion message or fixture diff that prints
 * `    Could not GET ... 429`, or an indented `>` tree, is never one (Codex review 7 of PR 256).
 */
// A `> Task :...` line is a task header, not a cause: the task's output follows it.
const GRADLE_CAUSE_ROOT = /^> (?!Task :)/

/**
 * Robolectric fetches its Android runtime (`org.robolectric:android-all*`) inside the test JVM,
 * so its failure prints inside a test's output. Only that fetch's own exception counts there: the
 * IOException line naming a Robolectric artifact URL.
 */
const ROBOLECTRIC_RUNTIME_DOWNLOAD_FAILURE =
  /^\s*(?:Caused by: )?java\.io\.IOException: Server returned HTTP response code: \d{3} for URL: \S*\/org\/robolectric\//

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
 * An artifact file the repository did not serve for a module whose metadata already resolved, as
 * Gradle prints it in its cause tree: `> Could not find junit-4.13.2.jar (junit:junit:4.13.2).`
 * PR 256 dispatch 44523800625 failed this way on two jars Maven Central serves, with the same
 * restored Gradle cache that built green 22 minutes earlier. A missing module or version
 * (`> Could not find junit:junit:9.99.`) names no file and still fails at once.
 */
const MISSING_ARTIFACT =
  /^\s*> (Could not find [^\s()]+\.(?:jar|aar|pom|module|klib) \([^\s():]+:[^\s():]+:[^\s()]+\))\.?\s*$/

/** For each line, whether it sits in a Gradle cause tree rooted at column 0. */
function gradleOwnedLines(lines) {
  let inTree = false
  return lines.map((line) => {
    if (GRADLE_CAUSE_ROOT.test(line)) inTree = true
    else if (inTree && !/^\s+> /.test(line)) inTree = false
    return inTree
  })
}

/**
 * The transient error inside the first failed artifact download that has one: the download's own
 * line, or a cause nested under it. Undefined when no failed download names a transient error.
 * With `toolOwnedOnly`, a download counts only where the tool printed it (see above).
 */
function transientDownloadFailure(output, { toolOwnedOnly = false } = {}) {
  const lines = output.split('\n')
  const owned = toolOwnedOnly ? gradleOwnedLines(lines) : undefined
  for (const [at, line] of lines.entries()) {
    if (!ARTIFACT_DOWNLOAD_FAILURE.test(line)) continue
    if (owned && !owned[at] && !ROBOLECTRIC_RUNTIME_DOWNLOAD_FAILURE.test(line)) continue
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

/** The first artifact miss Gradle's own cause tree prints, or undefined. */
function missingArtifact(output) {
  const lines = output.split('\n')
  const owned = gradleOwnedLines(lines)
  for (const [at, line] of lines.entries()) {
    const match = owned[at] ? MISSING_ARTIFACT.exec(line) : null
    if (match) return match[1]
  }
  return undefined
}

/**
 * Whether a failed run's cause is an artifact miss (MISSING_ARTIFACT). Gradle 8.14.3 keeps a
 * missing-artifact result for 24 hours (DefaultCachePolicy), so a plain rerun in the same Gradle
 * home fails on its own cached miss; the retry has Gradle re-check with --refresh-dependencies.
 */
function missingArtifactFailure(result) {
  if (result.status === 0 || result.signal) return false
  return missingArtifact(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) !== undefined
}

/** Waits before the second and third attempts. */
const RESOLUTION_RETRY_DELAYS_MS = Object.freeze([20000, 40000])

/**
 * The transient download error a failed run printed, or undefined when it printed none.
 *
 * - A run killed by a signal (a timeout) is never retried.
 * - A run whose Gradle cause tree names an artifact miss for a resolved module
 *   (MISSING_ARTIFACT) is retried, with --refresh-dependencies (see runWithResolutionRetry).
 * - A run whose test cases failed (GRADLE_TEST_FAILURE: a failed case, the failing-tests
 *   summary or a connected run's per-device summary) is retried only when it also printed a
 *   failed artifact download whose own line or nested cause is transient, and only where the
 *   tool printed it: a Gradle download in Gradle's failure report or a column-0 cause tree, or
 *   Robolectric's own runtime fetch exception (it fails the cases that way). A timeout, a 429 or
 *   a whole `Could not GET ... 429` line that a test's own output mentions, quotes or prints in a
 *   multiline message never retries it. So an assertion failure runs once unless the same run
 *   also failed a transient artifact download.
 * - A run whose test task failed (GRADLE_TEST_TASK_FAILURE) with no failed cases follows the
 *   same rule: a test task that could not resolve its inputs before any test ran (the connected
 *   task's UTP dependencies) prints a failed download and retries; a crashed test JVM whose
 *   output only mentions a timeout prints none and fails at once.
 * - Any other failed run is retried on a transient failed download (multiline causes included)
 *   or any other transient error it printed (the wrapper's distribution download, a reset
 *   connection).
 */
function transientResolutionFailure(result) {
  if (result.status === 0 || result.signal) return undefined
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const miss = missingArtifact(output)
  if (miss !== undefined) return miss
  if (GRADLE_TEST_FAILURE.test(output) || GRADLE_TEST_TASK_FAILURE.test(output))
    return transientDownloadFailure(output, { toolOwnedOnly: true })
  const download = transientDownloadFailure(output)
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
 * result ({ status, stdout, stderr }) and receives `{ refreshDependencies }`: true on every
 * attempt after one that failed on an artifact miss, so a Gradle caller re-checks the cached
 * miss. A caller that runs no Gradle launcher may ignore it.
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
  let refreshDependencies = false
  let result = run({ refreshDependencies })
  for (const [index, delay] of delaysMs.entries()) {
    const failure = transientResolutionFailure(result)
    if (failure === undefined) return result
    refreshDependencies ||= missingArtifactFailure(result)
    log(
      `Attempt ${index + 1}/${attempts} hit a transient download error (${failure}); ` +
        `retrying in ${delay / 1000} s${refreshDependencies ? ' with --refresh-dependencies' : ''}.`
    )
    wait(delay)
    result = run({ refreshDependencies })
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
  GRADLE_TEST_TASK_FAILURE,
  RESOLUTION_RETRY_DELAYS_MS,
  MISSING_ARTIFACT,
  TRANSIENT_RESOLUTION_FAILURE,
  isTransientResolutionFailure,
  missingArtifactFailure,
  runWithResolutionRetry,
  transientResolutionFailure,
}
