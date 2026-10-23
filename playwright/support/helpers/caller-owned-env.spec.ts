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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('1.2b-ENV-03 keeps the launcher-owned keys when the Playwright config loads', async () => {
    const cwd = process.cwd()
    vi.stubEnv('TEST_ENV', 'local')
    vi.stubEnv('DATABASE_URL', CALLER_DATABASE_URL)
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:55321')
    vi.stubEnv('E2E_CALLER_OWNED_ENV_KEYS', 'DATABASE_URL,SUPABASE_URL')
    process.chdir(directory)
    try {
      vi.resetModules()
      // A variable specifier, as in playwright-config-secrets.spec.ts: the
      // module is loaded fresh for its import-time env handling.
      const environments = '../../config/environments'
      await import(environments)
    } finally {
      process.chdir(cwd)
    }

    expect(process.env.DATABASE_URL).toBe(CALLER_DATABASE_URL)
    expect(process.env.SUPABASE_URL).toBe('http://127.0.0.1:55321')
  })
})
