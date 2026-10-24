/**
 * Every process a real-session run starts, owned until it and everything it started
 * have exited.
 *
 * Each child leads its own process group, so stopping it reaches the workers it
 * spawned too: Playwright's test workers, Next's build workers, the API stack's API
 * and queue workers. Once `close()` begins, nothing new may start: `spawn` throws
 * `TeardownStarted`, and the run's startup sequence calls `assertRunning()` after
 * every step that awaited, so a step that settles during teardown cannot go on to
 * create a user, a process or a database that teardown has already passed.
 */
import { spawn as spawnChild } from 'node:child_process'
import fs from 'node:fs'

export class TeardownStarted extends Error {
  constructor() {
    super('Teardown has started; no new work may begin.')
    this.name = 'TeardownStarted'
  }
}

/** True when no process of the group `pgid` is left. */
export function processGroupGone(pgid) {
  try {
    process.kill(-pgid, 0)
    return false
  } catch (error) {
    if (error.code === 'ESRCH') return true
    // EPERM: a member exists that this user cannot signal, so the group is not gone.
    return false
  }
}

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function waitUntil(condition, timeoutMs, pollMs = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return condition()
}

/**
 * @param {{ graceMs?: number, killWaitMs?: number }} [options]
 */
export function createProcessOwner({ graceMs = 20_000, killWaitMs = 10_000 } = {}) {
  /** @type {Set<{ name: string, child: import('node:child_process').ChildProcess, pgid: number, exited: Promise<{ code: number | null, signal: string | null }> }>} */
  const handles = new Set()
  let closing = false
  /** @type {Promise<void> | undefined} */
  let closed

  const assertRunning = () => {
    if (closing) throw new TeardownStarted()
  }

  /**
   * Starts `command` as the leader of a new process group. `logFile` takes its
   * output; without one the caller reads `child.stdout` and `child.stderr`.
   *
   * @param {string} name
   * @param {string} command
   * @param {readonly string[]} args
   * @param {{ cwd: string, env: NodeJS.ProcessEnv, logFile?: string }} options
   */
  const spawn = (name, command, args, { cwd, env, logFile }) => {
    assertRunning()
    let out
    if (logFile) out = fs.openSync(logFile, 'w', 0o600)
    const child = spawnChild(command, args, {
      cwd,
      env,
      detached: true,
      stdio: out === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', out, out],
    })
    if (out !== undefined) fs.closeSync(out)
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
      child.once('error', () => resolve({ code: 1, signal: null }))
    })
    // A child that failed to start has no pid and no group to stop.
    if (child.pid === undefined) return { name, child, pgid: 0, exited }
    const handle = { name, child, pgid: child.pid, exited }
    handles.add(handle)
    return handle
  }

  /** Stops one group: SIGTERM, a grace period, then SIGKILL until it is empty. */
  const stop = async (handle) => {
    if (!handle || handle.pgid === 0) return
    if (!processGroupGone(handle.pgid)) {
      signalGroup(handle.pgid, 'SIGTERM')
      const graceful = await waitUntil(() => processGroupGone(handle.pgid), graceMs)
      if (!graceful) {
        signalGroup(handle.pgid, 'SIGKILL')
        const killed = await waitUntil(() => processGroupGone(handle.pgid), killWaitMs)
        if (!killed)
          throw new Error(`${handle.name} (process group ${handle.pgid}) did not exit.`)
      }
    }
    await handle.exited
    handles.delete(handle)
  }

  return {
    get closing() {
      return closing
    },
    assertRunning,
    spawn,
    stop,
    /** Refuses new work, then stops every owned group and awaits its exit. */
    close() {
      closing = true
      closed ??= Promise.allSettled([...handles].map(stop)).then((results) => {
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length > 0)
          throw new Error(failures.map((failure) => failure.reason.message).join(' '))
      })
      return closed
    },
    /** The groups still owned, for diagnostics and tests. */
    owned() {
      return [...handles].map(({ name, pgid }) => ({ name, pgid }))
    },
  }
}
