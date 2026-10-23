/**
 * The teardown's `db:reset` is opt-in. On 2026-10-23 a raw `npx playwright test`
 * run, with no skip flag, reset the shared default database at 127.0.0.1:54322:
 * the old rule reset any local run that did not opt out. These cases hold the
 * opt-in, the guards that still win over it, the one script that opts in, and
 * the teardown that acts on the decision.
 */
import type * as ChildProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import globalTeardown from '../../global-teardown'
import { databaseResetDecision } from './db-reset-policy'

const execSync = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execSync,
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
  afterEach(() => {
    process.env = { ...saved }
    execSync.mockReset()
    vi.restoreAllMocks()
  })

  async function runTeardown(env: Record<string, string>) {
    process.env = { PATH: saved.PATH, HOME: saved.HOME, ...env }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await globalTeardown()
    return warn
  }

  it('leaves the database alone for a raw local run', async () => {
    const warn = await runTeardown({
      TEST_ENV: 'local',
      DATABASE_URL: UNREACHABLE_LOCAL_DB,
    })
    expect(execSync).not.toHaveBeenCalledWith('npm run db:reset', expect.anything())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the reset is opt-in'))
  })

  it('resets the database for a run that opted in', async () => {
    await runTeardown({
      TEST_ENV: 'local',
      DATABASE_URL: UNREACHABLE_LOCAL_DB,
      PLAYWRIGHT_DB_RESET: 'true',
    })
    expect(execSync).toHaveBeenCalledWith('npm run db:reset', expect.anything())
  })
})
