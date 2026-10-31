// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import {
  acquireAdvisoryLock,
  advisoryLockKey,
} from '../../../playwright/support/helpers/advisory-lock'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const repo = path.resolve(__dirname, '../../..')
const lockModule = path.join(repo, 'playwright/support/helpers/advisory-lock.ts')

/**
 * A Playwright worker stand-in: its own process and database session. It takes
 * the lock `rounds` times, holding it `holdMs` each time and logging when it
 * entered and left; with `crash`, it exits holding the lock.
 */
function worker(
  directory: string,
  name: string,
  lockName: string,
  options: { rounds: number; holdMs: number; crash?: boolean }
) {
  const script = path.join(directory, `${name}.cts`)
  fs.writeFileSync(
    script,
    `const fs = require('node:fs')
const { acquireAdvisoryLock } = require(${JSON.stringify(lockModule)})
const log = ${JSON.stringify(path.join(directory, `${name}.log`))}
void (async () => {
for (let round = 0; round < ${options.rounds}; round += 1) {
  const release = await acquireAdvisoryLock(${JSON.stringify(databaseUrl)}, ${JSON.stringify(lockName)}, { timeoutMs: 30_000 })
  fs.appendFileSync(log, 'enter ' + (performance.timeOrigin + performance.now()) + '\\n')
  await new Promise((resolve) => setTimeout(resolve, ${options.holdMs}))
  ${options.crash ? "fs.appendFileSync(log, 'crash\\n'); process.exit(0)" : ''}
  fs.appendFileSync(log, 'leave ' + (performance.timeOrigin + performance.now()) + '\\n')
  await release()
}
})()
`
  )
  // One process, loading TypeScript through tsx's hooks, so a signal reaches the worker itself.
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: repo,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
  workers.add({ child, exited })
  return exited
}

/** Every worker a test started, so a test that times out cannot leave one behind. */
const workers = new Set<{ child: ChildProcess; exited: Promise<number | null> }>()

/**
 * Ends every worker still running and waits for each to exit; its database
 * session, and any advisory lock it holds, closes with the process.
 */
async function stopWorkers() {
  const running = [...workers]
  workers.clear()
  await Promise.all(
    running.map(async ({ child, exited }) => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await Promise.race([
        exited.catch(() => null),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`worker ${child.pid} did not exit`)), 10_000)
        ),
      ])
    })
  )
}

type Holder = { pid: number; state: string | null; backendStart: string | null }

/** The sessions holding `lockName`'s key now, with what Postgres says each is doing. */
async function holders(lockName: string): Promise<Holder[]> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const unsigned = BigInt.asUintN(64, BigInt(advisoryLockKey(lockName)))
    const { rows } = await client.query<{
      pid: number
      state: string | null
      backend_start: Date | null
    }>(
      `SELECT l.pid, a.state, a.backend_start FROM pg_locks l
         LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.granted
          AND l.classid = $1::bigint::oid AND l.objid = $2::bigint::oid AND l.objsubid = 1`,
      [(unsigned >> 32n).toString(), (unsigned & 0xffffffffn).toString()]
    )
    return rows.map((row) => ({
      pid: row.pid,
      state: row.state,
      backendStart: row.backend_start?.toISOString() ?? null,
    }))
  } finally {
    await client.end()
  }
}

/**
 * Waits until no session holds the lock. A client's exit closes its socket at
 * once, but the server backend finishes its cleanup, and drops its locks, a
 * moment later; failing at the deadline names the sessions still holding it.
 */
async function waitForNoHolders(
  observe: () => Promise<Holder[]>,
  { timeoutMs = 5_000, pollMs = 50 }: { timeoutMs?: number; pollMs?: number } = {}
) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = await observe()
    if (current.length === 0) return
    if (Date.now() > deadline)
      throw new Error(
        `the advisory lock is still held after ${timeoutMs} ms by ${JSON.stringify(current)}`
      )
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function intervals(directory: string, name: string) {
  const lines = fs
    .readFileSync(path.join(directory, `${name}.log`), 'utf8')
    .trim()
    .split('\n')
  const at = (line: string | undefined) => Number(line?.split(' ')[1])
  const spans: { enter: number; leave: number }[] = []
  for (let index = 0; index < lines.length; index += 2)
    spans.push({ enter: at(lines[index]), leave: at(lines[index + 1]) })
  return spans
}

describe('waiting for advisory-lock holders to go', () => {
  const holder: Holder = { pid: 4242, state: 'idle', backendStart: null }

  it('passes once a holder seen just after its client exited is gone', async () => {
    const seen = [[holder], [holder], []]
    const observe = () => Promise.resolve(seen.shift() ?? [])
    await waitForNoHolders(observe, { timeoutMs: 1_000, pollMs: 10 })
    expect(seen).toEqual([])
  })

  it('fails at its deadline naming a holder that never goes', async () => {
    await expect(
      waitForNoHolders(() => Promise.resolve([holder]), { timeoutMs: 100, pollMs: 10 })
    ).rejects.toThrow(/still held after 100 ms by .*"pid":4242/)
  })
})

describe('Playwright cross-worker advisory lock', () => {
  let directory: string
  let lockName: string
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-lock-'))
    lockName = `advisory-lock-spec:${path.basename(directory)}`
  })
  afterEach(async () => {
    try {
      await stopWorkers()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('never lets two workers hold it at once', async () => {
    const exits = await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        worker(directory, name, lockName, { rounds: 3, holdMs: 150 })
      )
    )
    expect(exits).toEqual([0, 0, 0])
    const spans = ['a', 'b', 'c']
      .flatMap((name) => intervals(directory, name))
      .sort((left, right) => left.enter - right.enter)
    expect(spans).toHaveLength(9)
    spans.slice(1).forEach((span, index) => {
      expect(span.enter).toBeGreaterThanOrEqual(spans[index]!.leave)
    })
  }, 60_000)

  it('is free again when a holder dies without releasing it', async () => {
    expect(
      await worker(directory, 'crashed', lockName, { rounds: 1, holdMs: 0, crash: true })
    ).toBe(0)
    expect(fs.readFileSync(path.join(directory, 'crashed.log'), 'utf8')).toContain(
      'crash'
    )
    const release = await acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 5_000 })
    await release()
  }, 60_000)

  it('leaves no worker or session behind when a run is cut short', async () => {
    const holding = worker(directory, 'holder', lockName, { rounds: 1, holdMs: 120_000 })
    const log = path.join(directory, 'holder.log')
    await waitFor(() => fs.existsSync(log))
    expect((await holders(lockName)).map(({ pid }) => typeof pid)).toEqual(['number'])

    // What afterEach does when a test times out with a worker still holding the lock.
    await stopWorkers()
    expect(await holding).toBeNull()
    await waitForNoHolders(() => holders(lockName))
    const release = await acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 2_000 })
    await release()
  }, 30_000)

  it('gives up at its deadline while another session holds it', async () => {
    const release = await acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 1_000 })
    try {
      await expect(
        acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 200 })
      ).rejects.toMatchObject({ code: '55P03' })
    } finally {
      await release()
    }
  }, 30_000)
})
