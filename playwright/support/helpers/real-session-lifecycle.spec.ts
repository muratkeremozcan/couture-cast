/**
 * Unit tests for the real-session run's teardown order
 * (`scripts/e2e-real-session/lifecycle.mjs` and `process-owner.mjs`), driven with
 * real child processes.
 *
 * The cancellation case is R53: a SIGTERM during the specs used to start deleting
 * Auth users while the Playwright worker could still create and record more, and
 * cleanup then wrote its old snapshot over the newly recorded one. Here a stand-in
 * Playwright (`real-session-fake-playwright.mjs`) with a worker that ignores
 * SIGTERM creates users through the real write-ahead record, the run is torn down
 * with identities at every step of creation, and the deleter is held at a barrier
 * so the test can look at the processes before the first delete. Every address
 * below is a dummy; the Auth server is a directory.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteRecordedUsers,
  type DeleteUserResult,
  type FindUserResult,
} from '../../../scripts/e2e-real-session/cleanup-users.mjs'
import { readIdentities } from '../../../scripts/e2e-real-session/identities.mjs'
import { startRunLifecycle } from '../../../scripts/e2e-real-session/lifecycle.mjs'
import {
  TeardownStarted,
  createProcessOwner,
  processGroupGone,
  type ProcessOwner,
} from '../../../scripts/e2e-real-session/process-owner.mjs'

const fixture = path.join(__dirname, 'real-session-fake-playwright.mjs')

let root: string
let control: string
let runDir: string
let authDir: string
let owners: ProcessOwner[]

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'real-session-lifecycle-'))
  control = path.join(root, 'control')
  runDir = path.join(root, 'run')
  authDir = path.join(root, 'auth')
  for (const folder of [control, runDir, authDir]) fs.mkdirSync(folder)
  owners = []
})

afterEach(async () => {
  // A failed assertion must not leave the stand-ins running.
  await Promise.allSettled(owners.map((owner) => owner.close()))
  fs.rmSync(root, { recursive: true, force: true })
})

function owner(options?: { graceMs?: number; killWaitMs?: number }) {
  const created = createProcessOwner(options)
  owners.push(created)
  return created
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForFile(name: string, timeoutMs = 10_000) {
  const file = path.join(control, name)
  const deadline = Date.now() + timeoutMs
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name}`)
    await sleep(10)
  }
  return fs.readFileSync(file, 'utf8')
}

const touch = (name: string) => fs.writeFileSync(path.join(control, name), '')

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The stand-in Auth server: one file per user, named by id, holding its address. */
const auth = {
  users: () =>
    fs
      .readdirSync(authDir)
      .map((id) => ({ id, email: fs.readFileSync(path.join(authDir, id), 'utf8') })),
  delete(id: string): DeleteUserResult {
    const file = path.join(authDir, id)
    if (!fs.existsSync(file)) return { status: 'missing' }
    fs.rmSync(file)
    return { status: 'deleted' }
  },
  find(email: string): FindUserResult {
    const user = auth.users().find((candidate) => candidate.email === email)
    return user ? { status: 'found', authUserId: user.id } : { status: 'absent' }
  },
}

describe('real-session teardown', () => {
  it('R53-LC-01 stops Playwright and its workers before any delete, and loses no identity', async () => {
    const processes = owner({ graceMs: 300, killWaitMs: 5_000 })
    let pgid = 0
    let failingId: string | undefined
    let processesAliveAtFirstDelete: boolean | undefined
    let openDeleter!: () => void
    const deleterOpen = new Promise<void>((resolve) => (openDeleter = resolve))
    let deleterReached!: () => void
    const reachedDeleter = new Promise<void>((resolve) => (deleterReached = resolve))
    const pids: number[] = []

    const deleteUser = async (id: string): Promise<DeleteUserResult> => {
      if (processesAliveAtFirstDelete === undefined) {
        processesAliveAtFirstDelete = pids.some(alive) || !processGroupGone(pgid)
        deleterReached()
      }
      await deleterOpen
      if (id === failingId) return { status: 'failed', reason: 'Auth unavailable' }
      return auth.delete(id)
    }
    const findUserByEmail = (email: string) => Promise.resolve(auth.find(email))

    const lifecycle = startRunLifecycle({
      owner: processes,
      settleMs: 5_000,
      run: async () => {
        const playwright = processes.spawn(
          'playwright',
          process.execPath,
          [fixture, 'leader', control, runDir, authDir],
          { cwd: root, env: process.env, logFile: path.join(root, 'playwright.log') }
        )
        pgid = playwright.pgid
        const result = await playwright.exited
        processes.assertRunning()
        return result.code ?? 1
      },
      release: async () => {
        const summary = await deleteRecordedUsers({
          directory: runDir,
          deleteUser,
          findUserByEmail,
        })
        return summary.failed.length > 0 ? 1 : 0
      },
    })

    for (const name of ['leader', 'a', 'b'])
      pids.push(Number(await waitForFile(`${name}.pid`)))
    // a-0: created and recorded.
    for (const step of ['a-go-0', 'a-create-0', 'a-record-0']) touch(step)
    await waitForFile('a-recorded-0')
    // a-1: the Auth user exists, its row is still the pending one.
    for (const step of ['a-go-1', 'a-create-1']) touch(step)
    failingId = await waitForFile('a-created-1')
    // b-0: the pending row is written, the Auth call has not happened.
    touch('b-go-0')
    await waitForFile('b-pending-0')
    expect(auth.users()).toHaveLength(2)

    const teardown = lifecycle.teardown('signal')
    await reachedDeleter
    expect(processesAliveAtFirstDelete).toBe(false)
    // The workers outlived SIGTERM, so the group had to be killed and awaited.
    for (const name of ['a', 'b'])
      expect(fs.existsSync(path.join(control, `${name}-ignored-sigterm`))).toBe(true)
    openDeleter()

    expect(await teardown).toBe(1)
    expect(await lifecycle.done).toBe(1)
    expect(pids.some(alive)).toBe(false)
    expect(processGroupGone(pgid)).toBe(true)
    expect(processes.owned()).toEqual([])
    expect(() =>
      processes.spawn('late', process.execPath, ['-e', ''], {
        cwd: root,
        env: process.env,
      })
    ).toThrow(TeardownStarted)

    // Every user the worker created is deleted, or still recorded for a retry.
    const recorded = readIdentities(runDir)
    for (const user of auth.users())
      expect(
        recorded.some((row) => row.authUserId === user.id || row.email === user.email)
      ).toBe(true)
    expect(auth.users().map((user) => user.id)).toEqual([failingId])
    expect(recorded).toEqual([
      expect.objectContaining({ label: 'identity-a-1', pending: true }),
    ])

    // The CI always() cleanup finishes the job.
    failingId = undefined
    expect(
      await deleteRecordedUsers({ directory: runDir, deleteUser, findUserByEmail })
    ).toMatchObject({ recorded: 1, deleted: 1, failed: [] })
    expect(auth.users()).toEqual([])
    expect(readIdentities(runDir)).toEqual([])
  }, 30_000)

  it('R53-LC-02 lets a startup step settle, then blocks what it would start next', async () => {
    const processes = owner({ graceMs: 200 })
    const events: string[] = []
    const reportError = vi.fn()
    let openDatabase!: () => void
    const databaseCreated = new Promise<void>((resolve) => (openDatabase = resolve))
    let database: string | undefined
    let spawned = false

    const lifecycle = startRunLifecycle({
      owner: processes,
      settleMs: 5_000,
      reportError,
      run: async () => {
        await databaseCreated
        database = 'tea_community_dummy'
        events.push('database created')
        processes.assertRunning()
        processes.spawn('api-stack', process.execPath, ['-e', ''], {
          cwd: root,
          env: process.env,
        })
        spawned = true
        return 0
      },
      release: () => {
        events.push(`released ${database}`)
        return Promise.resolve(0)
      },
    })

    const teardown = lifecycle.teardown('signal')
    await sleep(100)
    // Teardown waits for the step in flight instead of releasing around it.
    expect(events).toEqual([])
    openDatabase()

    expect(await teardown).toBe(1)
    expect(events).toEqual(['database created', 'released tea_community_dummy'])
    expect(spawned).toBe(false)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('R53-LC-03 bounds the wait for a startup step that never settles', async () => {
    const log = vi.fn()
    const release = vi.fn(() => Promise.resolve(0))
    const lifecycle = startRunLifecycle({
      owner: owner(),
      settleMs: 100,
      log,
      run: () => new Promise<number>(() => undefined),
      release,
    })

    expect(await lifecycle.teardown('signal')).toBe(1)
    expect(release).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/did not settle/))
  })

  it('R53-LC-04 passes only when the run and the release both pass', async () => {
    const run = (code: number) => () => Promise.resolve(code)
    const passing = startRunLifecycle({
      owner: owner(),
      run: run(0),
      release: () => Promise.resolve(0),
    })
    const failedRelease = startRunLifecycle({
      owner: owner(),
      run: run(0),
      release: () => Promise.resolve(1),
    })
    const failedSpecs = startRunLifecycle({
      owner: owner(),
      run: run(1),
      release: () => Promise.resolve(0),
    })
    const reportError = vi.fn()
    const thrown = startRunLifecycle({
      owner: owner(),
      reportError,
      run: () => Promise.reject(new Error('The web build failed (1).')),
      release: () => Promise.resolve(0),
    })

    expect(await passing.done).toBe(0)
    expect(await failedRelease.done).toBe(1)
    expect(await failedSpecs.done).toBe(1)
    expect(await thrown.done).toBe(1)
    expect(reportError).toHaveBeenCalledWith(new Error('The web build failed (1).'))
  })
})
