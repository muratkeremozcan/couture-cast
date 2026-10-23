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

  it('1.2b-ENV-03 keeps an isolated loopback stack in the runner, its workers and the launcher', () => {
    // The real path, with no E2E_CALLER_OWNED_ENV_KEYS anywhere: a caller
    // exports an isolated stack and runs Playwright under TEST_ENV=local while
    // .env.local names the default one. A real `playwright test` loads the
    // environment module in the runner (recorded by globalSetup) and again in
    // its worker (recorded by the probe test); the webServer launcher then
    // starts from the runner's environment and resolves its own.
    const isolated = {
      DATABASE_URL: CALLER_DATABASE_URL,
      SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-role-key',
    }
    fs.appendFileSync(
      path.join(directory, '.env.local'),
      'SUPABASE_SERVICE_ROLE_KEY=default-service-role-key\nREDIS_URL=redis://127.0.0.1:6379\n'
    )
    fs.symlinkSync(
      path.join(repoRoot, 'node_modules'),
      path.join(directory, 'node_modules')
    )
    const record = (name: string) => path.join(directory, `${name}.json`)
    const snapshot =
      'JSON.stringify({ DATABASE_URL: process.env.DATABASE_URL, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY })'
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

    const result = spawnSync(
      'npx',
      ['playwright', 'test', '--config', 'playwright.config.ts'],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          TEST_ENV: 'local',
          ...isolated,
        },
        encoding: 'utf8',
      }
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const runner = JSON.parse(fs.readFileSync(record('runner'), 'utf8')) as Record<
      string,
      string
    >
    const worker = JSON.parse(fs.readFileSync(record('worker'), 'utf8')) as Record<
      string,
      string
    >
    expect(runner).toEqual(isolated)
    expect(worker).toEqual(isolated)

    // The launcher: the runner's environment plus the webServer overrides,
    // resolved by the launcher's own loader against the same .env.local.
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
    expect({
      DATABASE_URL: launcher.DATABASE_URL,
      SUPABASE_URL: launcher.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: launcher.SUPABASE_SERVICE_ROLE_KEY,
    }).toEqual(isolated)
    expect(launcher.E2E_CALLER_OWNED_ENV_KEYS?.split(',')).toEqual(
      expect.arrayContaining(Object.keys(isolated))
    )
    // A remote value still loses: nothing inherited named REDIS_URL, so the
    // file's default stands.
    expect(launcher.REDIS_URL).toBe('redis://127.0.0.1:6379')
  })
})
