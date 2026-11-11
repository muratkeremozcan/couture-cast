#!/usr/bin/env node
// Bounded retries for every apt install in CI. On 2026-11-11 the hosted runners could not resolve
// security.ubuntu.com from about 15:40 to 15:45 UTC; three PR jobs failed in `playwright install
// --with-deps`, one of them after its single 45 s retry. Two layers ride out a blip that long:
//
// - apt's own retries: each failed fetch is retried up to 5 times with a doubling delay capped at
//   30 s (`Acquire::Retries`), written to the runner's apt configuration before the first install;
// - this wrapper: a failed update or install runs again after 15, 30, 60 and 120 s, never starting
//   an attempt the step's deadline cannot finish.
//
//   node scripts/ci/apt-retry.mjs [--deadline-seconds N] -- <command> [args...]
//
// scripts/ci/apt-retry.test.mjs fails when a workflow or action under .github runs apt, directly
// or through `playwright install --with-deps` / `install-deps`, without this wrapper.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Pauses between attempts, in seconds: about four minutes of waiting in all. */
export const APT_RETRY_PAUSES_S = [15, 30, 60, 120]
/** An attempt is not started unless at least this much of the deadline is left. */
export const APT_MIN_ATTEMPT_S = 60
export const APT_RETRIES_FILE = '/etc/apt/apt.conf.d/80-couture-ci-retries'
export const APT_RETRIES_CONFIG =
  'Acquire::Retries "5";\nAcquire::Retries::Delay::Maximum "30";\n'

/** Writes apt's own retry settings to the runner's configuration. */
export function configureAptRetries({ run = spawnSync } = {}) {
  const result = run('sudo', ['-n', 'tee', APT_RETRIES_FILE], {
    input: APT_RETRIES_CONFIG,
    stdio: ['pipe', 'ignore', 'pipe'],
    timeout: 10_000,
  })
  if (result.error || result.status !== 0) throw new Error('apt_retry_config_failed')
}

const sleepSeconds = (seconds) => {
  spawnSync('sleep', [String(seconds)], { stdio: 'inherit' })
}

/**
 * Runs `attempt` until it returns, pausing between tries. An error `retryable` rejects, the last
 * pause used up, or a deadline too close for one more attempt ends it with the last error. Each
 * attempt is told how many whole seconds of the deadline remain.
 */
export function withAptRetries(
  attempt,
  {
    retryable = () => true,
    pauses = APT_RETRY_PAUSES_S,
    deadlineSeconds = Infinity,
    minAttemptSeconds = APT_MIN_ATTEMPT_S,
    now = Date.now,
    sleep = sleepSeconds,
    log = console.log,
  } = {}
) {
  const started = now()
  const remaining = () => deadlineSeconds - (now() - started) / 1000
  for (let index = 0; ; index += 1) {
    try {
      return attempt({ number: index + 1, remainingSeconds: Math.floor(remaining()) })
    } catch (error) {
      const pause = pauses[index]
      if (pause === undefined || !retryable(error)) throw error
      if (remaining() - pause < minAttemptSeconds) throw error
      log(
        `apt-backed install failed (attempt ${index + 1}); retrying in ${pause}s in case an Ubuntu mirror or the runner's resolver is briefly unavailable.`
      )
      sleep(pause)
    }
  }
}

/** The CLI's arguments: an optional deadline, then the command after `--`. */
export function parseAptRetryArgs(args) {
  const split = args.indexOf('--')
  if (split < 0 || split === args.length - 1)
    throw new Error('apt_retry_command_required')
  const options = args.slice(0, split)
  let deadlineSeconds = Infinity
  if (options.length) {
    if (options.length !== 2 || options[0] !== '--deadline-seconds')
      throw new Error('apt_retry_options_invalid')
    deadlineSeconds = Number(options[1])
    if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < APT_MIN_ATTEMPT_S)
      throw new Error('apt_retry_options_invalid')
  }
  const [command, ...commandArgs] = args.slice(split + 1)
  return { deadlineSeconds, command, commandArgs }
}

export function runAptCommand(
  args,
  { run = spawnSync, configure = configureAptRetries, ...retry } = {}
) {
  const { deadlineSeconds, command, commandArgs } = parseAptRetryArgs(args)
  configure({ run })
  withAptRetries(
    ({ remainingSeconds }) => {
      const result = run(command, commandArgs, {
        stdio: 'inherit',
        ...(Number.isFinite(remainingSeconds)
          ? { timeout: remainingSeconds * 1000, killSignal: 'SIGTERM' }
          : {}),
      })
      if (result.error || result.status !== 0)
        throw Object.assign(new Error('apt_backed_command_failed'), {
          status: result.status ?? 1,
        })
    },
    { deadlineSeconds, ...retry }
  )
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  try {
    runAptCommand(process.argv.slice(2))
  } catch (error) {
    console.error(`apt-retry: ${error.message}`)
    process.exit(typeof error.status === 'number' && error.status > 0 ? error.status : 1)
  }
}
