/**
 * The teardown's `db:reset` is opt-in. On 2026-10-23 a raw `npx playwright test`
 * run, with no skip flag, reset the shared default database at 127.0.0.1:54322:
 * the old rule reset any local run that did not opt out. These cases hold the
 * opt-in, the guards that still win over it, the one script that opts in, and
 * the teardown that acts on the decision.
 */
import type * as ChildProcess from 'node:child_process'
import type * as E2eStackPid from '../../../scripts/e2e-stack-pid.mjs'
import { spawn as realSpawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEnvironmentConfig } from '../../config/environments'
import globalTeardown from '../../global-teardown'
import { databaseResetDecision } from './db-reset-policy'

const execSync = vi.hoisted(() => vi.fn())
const stopE2eStack = vi.hoisted(() => vi.fn(() => Promise.resolve('no-record')))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execSync,
}))
// The teardown stops "this run's" E2E stack before a reset. `prepare:playwright`
// runs this suite inside the burn-in web server, whose own launcher is that
// stack, so the real call signalled the server it was running in.
vi.mock('../../../scripts/e2e-stack-pid.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof E2eStackPid>()),
  stopE2eStack,
}))

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
/**
 * The teardown cases run the real teardown with `execSync` mocked. They still
 * point at a local port nothing listens on, so a broken mock could never reach a
 * real database.
 */
const UNREACHABLE_LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:1/never'
const repoRoot = path.resolve(__dirname, '../../..')

describe('Playwright teardown database reset policy', () => {
  it.each([
    [
      'a raw local run that did not opt in',
      { TEST_ENV: 'local', DATABASE_URL: LOCAL_DB },
    ],
    ['a run with TEST_ENV unset and no opt-in', { DATABASE_URL: LOCAL_DB }],
    [
      'CI, even when opted in',
      {
        CI: 'true',
        TEST_ENV: 'local',
        DATABASE_URL: LOCAL_DB,
        PLAYWRIGHT_DB_RESET: 'true',
      },
    ],
    [
      'a non-local target, even when opted in',
      { TEST_ENV: 'preview', DATABASE_URL: LOCAL_DB, PLAYWRIGHT_DB_RESET: 'true' },
    ],
    [
      'a missing DATABASE_URL, even when opted in',
      { TEST_ENV: 'local', PLAYWRIGHT_DB_RESET: 'true' },
    ],
    [
      'a remote DATABASE_URL, even when opted in',
      {
        TEST_ENV: 'local',
        DATABASE_URL: 'postgresql://user:pw@db.example.com:5432/postgres',
        PLAYWRIGHT_DB_RESET: 'true',
      },
    ],
    [
      'PLAYWRIGHT_SKIP_DB_RESET=true, even when opted in',
      {
        TEST_ENV: 'local',
        DATABASE_URL: LOCAL_DB,
        PLAYWRIGHT_DB_RESET: 'true',
        PLAYWRIGHT_SKIP_DB_RESET: 'true',
      },
    ],
  ])('skips the reset for %s', (_name, env) => {
    const decision = databaseResetDecision(env)
    expect(decision.reset).toBe(false)
    expect(decision.reason).toMatch(/^Skipping db:reset in global teardown/)
  })

  it('tells a raw run why it skipped and how to opt in', () => {
    expect(
      databaseResetDecision({ TEST_ENV: 'local', DATABASE_URL: LOCAL_DB }).reason
    ).toContain('`npm run test:pw-local` sets PLAYWRIGHT_DB_RESET=true')
  })

  it('resets a local database only when the run opted in', () => {
    expect(
      databaseResetDecision({
        TEST_ENV: 'local',
        DATABASE_URL: LOCAL_DB,
        PLAYWRIGHT_DB_RESET: 'true',
      }).reset
    ).toBe(true)
  })

  it('opts in from test:pw-local and from no other npm script', () => {
    const scripts = (
      JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
    ).scripts
    const optingIn = Object.entries(scripts)
      .filter(([, command]) => command.includes('PLAYWRIGHT_DB_RESET=true'))
      .map(([name]) => name)
    expect(optingIn).toEqual(['test:pw-local'])
  })
})

describe('Playwright global teardown', () => {
  const saved = { ...process.env }
  let recordDirectory: string
  let standIn: ChildProcess.ChildProcess | undefined

  beforeEach(() => {
    // The teardown finds "this run's" stack record under os.tmpdir(). A fresh
    // TMPDIR keeps these cases away from any real stack's record, such as the
    // burn-in web server's own launcher, which runs this suite.
    recordDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'db-reset-policy-'))
  })
  afterEach(() => {
    standIn?.kill('SIGKILL')
    standIn = undefined
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    fs.rmSync(recordDirectory, { recursive: true, force: true })
    execSync.mockReset()
    stopE2eStack.mockClear()
    vi.restoreAllMocks()
  })

  async function runTeardown(env: Record<string, string>) {
    // Mutated in place: a new object would detach process.env from the real
    // environment, and os.tmpdir() reads TMPDIR from the real one.
    for (const key of Object.keys(process.env))
      if (!['PATH', 'HOME'].includes(key)) delete process.env[key]
    Object.assign(process.env, { TMPDIR: recordDirectory }, env)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await globalTeardown()
    return warn
  }

  /** A live process recorded as this checkout's E2E stack launcher. */
  async function recordStandInLauncher(): Promise<ChildProcess.ChildProcess> {
    const actual = await vi.importActual<typeof E2eStackPid>(
      '../../../scripts/e2e-stack-pid.mjs'
    )
    const launcherPath = actual.e2eStackLauncherPath(repoRoot)
    const child = realSpawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', launcherPath, '--with-web'],
      { stdio: 'ignore' }
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const webPort = new URL(resolveEnvironmentConfig('local').webBaseUrl).port || '3005'
    const recordPath = actual.e2eStackRecordPath(repoRoot, webPort, recordDirectory)
    expect(
      actual.writeE2eStackRecord(recordPath, { pid: child.pid!, launcherPath })
    ).not.toBeNull()
    return child
  }

  const alive = (child: ChildProcess.ChildProcess) => {
    try {
      process.kill(child.pid!, 0)
      return child.exitCode === null && child.signalCode === null
    } catch {
      return false
    }
  }

  it('leaves the database alone for a raw local run', async () => {
    const warn = await runTeardown({
      TEST_ENV: 'local',
      DATABASE_URL: UNREACHABLE_LOCAL_DB,
    })
    expect(execSync).not.toHaveBeenCalledWith('npm run db:reset', expect.anything())
    expect(stopE2eStack).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the reset is opt-in'))
  })

  it('resets the database for a run that opted in, and never signals a live launcher', async () => {
    standIn = await recordStandInLauncher()
    await runTeardown({
      TEST_ENV: 'local',
      DATABASE_URL: UNREACHABLE_LOCAL_DB,
      PLAYWRIGHT_DB_RESET: 'true',
    })
    expect(execSync).toHaveBeenCalledWith('npm run db:reset', expect.anything())
    expect(stopE2eStack).toHaveBeenCalledTimes(1)
    // The burn-in web server runs this suite from inside its own launcher.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(alive(standIn)).toBe(true)
  })
})
