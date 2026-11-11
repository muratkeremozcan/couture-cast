#!/usr/bin/env node
// Bounded retries for every apt install in CI. On 2026-11-11 the hosted runners could not resolve
// security.ubuntu.com from about 15:40 to 15:45 UTC; three PR jobs failed in `playwright install
// --with-deps`, one of them after its single 45 s retry. Two layers ride out a blip that long:
//
// - apt's own retries: each failed fetch is retried up to 5 times with a doubling delay capped at
//   30 s (`Acquire::Retries`), written to the runner's apt configuration before the first install;
// - this wrapper: a failed update or install runs again after 15, 30, 60 and 120 s, never starting
//   an attempt the deadline cannot finish.
//
//   node scripts/ci/apt-retry.mjs --deadline-seconds N -- <command> [args...]
//
// The deadline is a hard bound on the whole run, configuration included. This process supervises
// each attempt itself (`superviseCommand`): the command starts as the leader of its own process
// group, and when its share of the deadline is spent every process in that group and every
// descendant seen then gets TERM, and 15 s later KILL, whether or not the leader has exited by
// then. An installer whose parent exits on TERM while a package hook ignores it is still killed.
// The signals go through `sudo -n kill` first, because `sudo apt-get` leaves root-owned processes
// that an unprivileged kill cannot reach, and the hosted runners have passwordless sudo. The 15 s
// grace and 5 s of teardown are reserved out of the deadline before the attempt starts, and the
// time left is read again right before every attempt, so a pause that returns late cannot start
// one the deadline no longer covers.
//
// scripts/ci/apt-retry.test.mjs fails when any tracked file under .github or scripts, or any
// package.json script, calls apt outside this wrapper and is not in its reviewed inventory.
import { spawn, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

/** Pauses between attempts, in seconds: about four minutes of waiting in all. */
export const APT_RETRY_PAUSES_S = [15, 30, 60, 120]
/** An attempt is not started unless at least this much of the deadline is left. */
export const APT_MIN_ATTEMPT_S = 60
/** How long an attempt's processes have after TERM before KILL. */
export const APT_TERMINATION_GRACE_S = 15
/** Seconds of the deadline an attempt leaves unused: the KILL grace and 5 s of teardown. */
export const APT_TERMINATION_RESERVE_S = APT_TERMINATION_GRACE_S + 5
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

/**
 * Every live process in process group `group` and every descendant of one, from `ps`. A process
 * that moved to a group of its own (sudo with `use_pty` does) is still found through its parent.
 */
export function processTree(group, { run = spawnSync } = {}) {
  const listing = run('ps', ['-A', '-o', 'pid=,ppid=,pgid='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (listing.error || listing.status !== 0) return []
  const rows = String(listing.stdout)
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 3 && row.every(Number.isInteger))
  const found = new Set(rows.filter(([, , pgid]) => pgid === group).map(([pid]) => pid))
  for (let grew = true; grew; ) {
    grew = false
    for (const [pid, ppid] of rows)
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid)
        grew = true
      }
  }
  return [...found]
}

/**
 * Sends `signal` to process group `group` and to `pids`: through `sudo -n kill`, which reaches
 * root-owned processes, and then directly, which covers a machine without passwordless sudo.
 */
export function signalTree(
  signal,
  group,
  pids,
  { run = spawnSync, kill = process.kill } = {}
) {
  run('sudo', ['-n', 'kill', '-s', signal, '--', `-${group}`, ...pids.map(String)], {
    stdio: 'ignore',
    timeout: 5000,
  })
  for (const target of [-group, ...pids]) {
    try {
      kill(target, signal)
    } catch {
      // Gone already, or not ours to signal: sudo covered what it could.
    }
  }
}

/**
 * Runs `command` as the leader of a new process group and resolves with its exit status. After
 * `seconds` the group and every descendant get TERM, after `graceSeconds` more KILL, whatever the
 * leader did meanwhile, and the status is then 124 (`timedOut`).
 */
export async function superviseCommand(
  command,
  args,
  {
    seconds,
    graceSeconds = APT_TERMINATION_GRACE_S,
    start = spawn,
    tree = processTree,
    signal = signalTree,
  }
) {
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error('apt_retry_deadline_spent')
  const child = start(command, args, { stdio: 'inherit', detached: true })
  const exited = new Promise((resolve) => {
    child.once('error', (error) => resolve({ status: null, error }))
    child.once('exit', (code, exitSignal) =>
      resolve({ status: code, signal: exitSignal })
    )
  })
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('deadline'), seconds * 1000)
  })
  const first = await Promise.race([exited, deadline])
  clearTimeout(timer)
  if (first !== 'deadline') return first
  const group = child.pid
  const seen = new Set(tree(group))
  signal('SIGTERM', group, [...seen])
  await delay(graceSeconds * 1000)
  for (const pid of tree(group)) seen.add(pid)
  signal('SIGKILL', group, [...seen])
  // The leader's exit is reported once KILL lands; bounded, in case it never is.
  await Promise.race([exited, delay(5000)])
  return { status: 124, timedOut: true }
}

const sleepSeconds = (seconds) => delay(seconds * 1000)

/**
 * Runs `attempt` until it resolves, pausing between tries. An error `retryable` rejects, the last
 * pause used up, or a deadline too close for one more attempt ends it with the last error. The
 * deadline is checked before each pause and again right before each attempt after it, and each
 * attempt is told how many whole seconds of the deadline remain.
 */
export async function withAptRetries(
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
  let lastError
  for (let index = 0; ; index += 1) {
    // A pause can return late (a loaded runner, a suspended process): what it left is read again.
    if (index > 0 && remaining() < minAttemptSeconds) throw lastError
    try {
      return await attempt({
        number: index + 1,
        remainingSeconds: Math.floor(remaining()),
      })
    } catch (error) {
      lastError = error
      const pause = pauses[index]
      if (pause === undefined || !retryable(error)) throw error
      if (remaining() - pause < minAttemptSeconds) throw error
      log(
        `apt-backed install failed (attempt ${index + 1}); retrying in ${pause}s in case an Ubuntu mirror or the runner's resolver is briefly unavailable.`
      )
      await sleep(pause)
    }
  }
}

/** The CLI's arguments: the deadline, then the command after `--`. */
export function parseAptRetryArgs(args) {
  const split = args.indexOf('--')
  if (split < 0 || split === args.length - 1)
    throw new Error('apt_retry_command_required')
  const options = args.slice(0, split)
  if (options.length !== 2 || options[0] !== '--deadline-seconds')
    throw new Error('apt_retry_options_invalid')
  const deadlineSeconds = Number(options[1])
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds < APT_MIN_ATTEMPT_S)
    throw new Error('apt_retry_options_invalid')
  const [command, ...commandArgs] = args.slice(split + 1)
  return { deadlineSeconds, command, commandArgs }
}

export async function runAptCommand(
  args,
  {
    run = spawnSync,
    configure = configureAptRetries,
    supervise = superviseCommand,
    now = Date.now,
    graceSeconds = APT_TERMINATION_GRACE_S,
    reserveSeconds = APT_TERMINATION_RESERVE_S,
    parse = parseAptRetryArgs,
    ...retry
  } = {}
) {
  const started = now()
  const { deadlineSeconds, command, commandArgs } = parse(args)
  configure({ run })
  await withAptRetries(
    async ({ remainingSeconds }) => {
      const result = await supervise(command, commandArgs, {
        seconds: remainingSeconds - reserveSeconds,
        graceSeconds,
      })
      if (result.error || result.status !== 0)
        throw Object.assign(new Error('apt_backed_command_failed'), {
          status: result.status ?? 1,
        })
    },
    // Configuration came out of the same deadline.
    { deadlineSeconds: deadlineSeconds - (now() - started) / 1000, now, ...retry }
  )
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  try {
    await runAptCommand(process.argv.slice(2))
  } catch (error) {
    console.error(`apt-retry: ${error.message}`)
    process.exit(typeof error.status === 'number' && error.status > 0 ? error.status : 1)
  }
}
