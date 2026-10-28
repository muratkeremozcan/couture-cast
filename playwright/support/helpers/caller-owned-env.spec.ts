/**
 * The local E2E launcher settles some keys itself (an isolated DATABASE_URL,
 * the weather double origins and keys) and lists them in
 * E2E_CALLER_OWNED_ENV_KEYS. Every place that later lets `.env.local` override
 * the environment under TEST_ENV=local must keep those keys, or a run aimed at
 * its own database migrates and reads the developer's default one instead.
 * `apps/api/src/load-env.ts` already does; these tests hold the migrate wrapper
 * and the Playwright environment loader to the same rule.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLauncherEnv } from '../../../scripts/lib/caller-owned-env.mjs'

const repoRoot = path.resolve(__dirname, '../../..')
const PLAYWRIGHT_CLI = path.join(repoRoot, 'node_modules/@playwright/test/cli.js')
/**
 * ENV-03 and ENV-04 each wait on one real `playwright test` run: a runner, its
 * config transpile and one worker process, so its cost grows with machine load.
 * Measured on 2026-10-28 at load average 41 to 55 on 14 cores: 2.7 to 4.6 s
 * through `npx`, 1.4 to 3.5 s calling the CLI directly, against vitest's 5 s
 * default that the npx runs overran at load 38 to 61. The child is killed at
 * about six times the worst direct run, and the test budget adds a second for setup
 * and reading the records, so a hung child fails here by name instead of by
 * timeout.
 */
const PLAYWRIGHT_RUN_DEADLINE_MS = 20_000
const PLAYWRIGHT_TEST_BUDGET_MS = PLAYWRIGHT_RUN_DEADLINE_MS + 1_000
const CALLER_DATABASE_URL = 'postgresql://caller:caller@127.0.0.1:55432/isolated'
const ENV_LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const migrateFiles = [
  'scripts/prisma-migrate-deploy.mjs',
  'scripts/local-e2e-database.mjs',
  'scripts/lib/caller-owned-env.mjs',
]
let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'caller-owned-env-'))
  fs.writeFileSync(
    path.join(directory, '.env.local'),
    `DATABASE_URL=${ENV_LOCAL_DATABASE_URL}\nSUPABASE_URL=http://127.0.0.1:54321\n`
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(directory, { recursive: true, force: true })
})

/** Runs the real migrate wrapper with a stand-in `npx` that records its DATABASE_URL. */
function migrateDatabaseUrl(env: Record<string, string>) {
  for (const file of migrateFiles) {
    const target = path.join(directory, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, file), target)
  }
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(directory, 'node_modules')
  )
  const bin = path.join(directory, 'bin')
  const recorded = path.join(directory, 'database-url.txt')
  fs.mkdirSync(bin)
  fs.writeFileSync(
    path.join(bin, 'npx'),
    `#!/bin/sh\nprintf '%s' "$DATABASE_URL" > '${recorded}'\n`,
    { mode: 0o755 }
  )
  const result = spawnSync(process.execPath, ['scripts/prisma-migrate-deploy.mjs'], {
    cwd: directory,
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, TEST_ENV: 'local', ...env },
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return fs.readFileSync(recorded, 'utf8')
}

/** The local stack keys every leg below records, with .env.local's defaults. */
const ENV_LOCAL_STACK = {
  DATABASE_URL: ENV_LOCAL_DATABASE_URL,
  REDIS_URL: 'redis://127.0.0.1:6379',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'default-service-role-key',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'default-anon-key',
}
type Stack = typeof ENV_LOCAL_STACK

/**
 * Runs a real `playwright test` under TEST_ENV=local with no
 * E2E_CALLER_OWNED_ENV_KEYS, against a .env.local holding the default stack.
 * The config imports the real environment module, so it loads in the runner
 * (recorded by globalSetup) and again in the worker (recorded by the probe).
 */
function runPlaywright(inherited: Stack): { runner: Stack; worker: Stack } {
  fs.writeFileSync(
    path.join(directory, '.env.local'),
    Object.entries(ENV_LOCAL_STACK)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('')
  )
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(directory, 'node_modules')
  )
  const record = (name: string) => path.join(directory, `${name}.json`)
  const snapshot = `JSON.stringify(Object.fromEntries(${JSON.stringify(
    Object.keys(ENV_LOCAL_STACK)
  )}.map((key) => [key, process.env[key]])))`
  fs.writeFileSync(
    path.join(directory, 'playwright.config.ts'),
    [
      `import ${JSON.stringify(path.join(repoRoot, 'playwright/config/environments'))}`,
      "import { defineConfig } from '@playwright/test'",
      "export default defineConfig({ testDir: '.', testMatch: 'probe.spec.ts', globalSetup: './record-runner.ts', workers: 1, reporter: 'line' })",
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(directory, 'record-runner.ts'),
    `import fs from 'node:fs'\nexport default () => fs.writeFileSync(${JSON.stringify(record('runner'))}, ${snapshot})\n`
  )
  fs.writeFileSync(
    path.join(directory, 'probe.spec.ts'),
    `import fs from 'node:fs'\nimport { test } from '@playwright/test'\ntest('records the worker environment', () => fs.writeFileSync(${JSON.stringify(record('worker'))}, ${snapshot}))\n`
  )
  // The CLI directly: `npx` would add its own package resolution to every run.
  const result = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI, 'test', '--config', 'playwright.config.ts'],
    {
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TEST_ENV: 'local',
        ...inherited,
      },
      encoding: 'utf8',
      timeout: PLAYWRIGHT_RUN_DEADLINE_MS,
      killSignal: 'SIGKILL',
    }
  )
  expect(
    result.status,
    `${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`
  ).toBe(0)
  const read = (name: string) =>
    JSON.parse(fs.readFileSync(record(name), 'utf8')) as Stack
  return { runner: read('runner'), worker: read('worker') }
}

/**
 * The webServer launcher starts from the runner's environment plus its
 * overrides and resolves its own against the same .env.local.
 */
function resolveLauncher(runner: Stack) {
  const launcher: NodeJS.ProcessEnv = {
    ...runner,
    TEST_ENV: 'local',
    POSTHOG_API_KEY: '',
  }
  loadLauncherEnv(launcher, () => {
    loadEnv({
      path: path.join(directory, '.env.local'),
      override: true,
      // dotenv types its target as string values; this one is a plain env copy.
      processEnv: launcher as Record<string, string>,
      quiet: true,
    })
  })
  const stack = Object.fromEntries(
    Object.keys(ENV_LOCAL_STACK).map((key) => [key, launcher[key]])
  ) as Stack
  return { stack, owned: launcher.E2E_CALLER_OWNED_ENV_KEYS?.split(',') ?? [] }
}

describe('caller-owned environment keys survive the .env.local override', () => {
  it('1.2b-ENV-01 migrates the database the launcher chose', () => {
    expect(
      migrateDatabaseUrl({
        DATABASE_URL: CALLER_DATABASE_URL,
        E2E_CALLER_OWNED_ENV_KEYS: 'DATABASE_URL',
      })
    ).toBe(CALLER_DATABASE_URL)
  })

  it('1.2b-ENV-02 still prefers .env.local over an inherited, unclaimed value', () => {
    expect(migrateDatabaseUrl({ DATABASE_URL: CALLER_DATABASE_URL })).toBe(
      ENV_LOCAL_DATABASE_URL
    )
  })

  it(
    '1.2b-ENV-03 keeps an isolated loopback stack in the runner, its workers and the launcher',
    () => {
      const isolated: Stack = {
        DATABASE_URL: CALLER_DATABASE_URL,
        REDIS_URL: 'redis://127.0.0.1:56391',
        SUPABASE_URL: 'http://127.0.0.1:55321',
        SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-role-key',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-anon-key',
      }

      const { runner, worker } = runPlaywright(isolated)
      expect(runner).toEqual(isolated)
      expect(worker).toEqual(isolated)
      const launcher = resolveLauncher(runner)
      expect(launcher.stack).toEqual(isolated)
      expect(launcher.owned).toEqual(expect.arrayContaining(Object.keys(isolated)))
    },
    PLAYWRIGHT_TEST_BUDGET_MS
  )

  it(
    '1.2b-ENV-04 lets .env.local replace a remote stack in the runner, its workers and the launcher',
    () => {
      // The override exists for this: a shell that still holds a remote
      // database or Supabase project must not leak into a local run, and the
      // Supabase keys go with the URL they belong to.
      const remote: Stack = {
        DATABASE_URL:
          'postgresql://postgres:secret@db.remote-ref.supabase.co:5432/postgres',
        REDIS_URL: 'rediss://default:secret@remote-redis.example.com:6380',
        SUPABASE_URL: 'https://remote-ref.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'remote-service-role-key',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'remote-anon-key',
      }

      const { runner, worker } = runPlaywright(remote)
      expect(runner).toEqual(ENV_LOCAL_STACK)
      expect(worker).toEqual(ENV_LOCAL_STACK)
      expect(resolveLauncher(runner).stack).toEqual(ENV_LOCAL_STACK)
    },
    PLAYWRIGHT_TEST_BUDGET_MS
  )

  it('1.2b-ENV-05 keeps the keys a caller above the launcher already listed as owned', () => {
    // The real-session harness settles its own ports and origins before it starts
    // the launcher; an .env.local PORT must not move its API off 4077.
    fs.writeFileSync(
      path.join(directory, '.env.local'),
      'PORT=4000\nHTTP_CORS_ORIGIN=http://127.0.0.1:3005\n'
    )
    const resolve = (env: NodeJS.ProcessEnv) => {
      loadLauncherEnv(env, () => {
        loadEnv({
          path: path.join(directory, '.env.local'),
          override: true,
          processEnv: env as Record<string, string>,
          quiet: true,
        })
      })
      return env
    }

    const listed = resolve({
      PORT: '4077',
      HTTP_CORS_ORIGIN: 'http://127.0.0.1:3077',
      E2E_CALLER_OWNED_ENV_KEYS: 'PORT,HTTP_CORS_ORIGIN',
    })
    expect(listed.PORT).toBe('4077')
    expect(listed.HTTP_CORS_ORIGIN).toBe('http://127.0.0.1:3077')
    expect(listed.E2E_CALLER_OWNED_ENV_KEYS?.split(',')).toEqual(
      expect.arrayContaining(['PORT', 'HTTP_CORS_ORIGIN'])
    )

    const unlisted = resolve({ PORT: '4077', HTTP_CORS_ORIGIN: 'http://127.0.0.1:3077' })
    expect(unlisted.PORT).toBe('4000')
    expect(unlisted.HTTP_CORS_ORIGIN).toBe('http://127.0.0.1:3005')
  })
})
