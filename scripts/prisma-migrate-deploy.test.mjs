// Runs the real migrate wrapper against a stand-in `npx` that plays back the
// production build failure: Supavisor's session pooler out of client slots.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wrapperFiles = [
  'scripts/prisma-migrate-deploy.mjs',
  'scripts/local-e2e-database.mjs',
  'scripts/lib/caller-owned-env.mjs',
  'scripts/lib/prisma-migrate-connection.mjs',
]
const EXHAUSTED =
  'FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15'
const SESSION =
  'postgresql://postgres.abcref:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require'
const TRANSACTION =
  'postgresql://postgres.abcref:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5'

let directory

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-migrate-deploy-'))
  for (const file of wrapperFiles) {
    const target = path.join(directory, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, file), target)
  }
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(directory, 'node_modules')
  )
  const bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  // Each call appends the DATABASE_URL it saw, then fails with the pool error
  // until it has failed FAIL_TIMES times, or fails with FAIL_OUTPUT instead.
  fs.writeFileSync(
    path.join(bin, 'npx'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$DATABASE_URL" >> '${path.join(directory, 'calls.txt')}'`,
      `calls=$(wc -l < '${path.join(directory, 'calls.txt')}')`,
      'if [ -n "$FAIL_OUTPUT" ]; then echo "$FAIL_OUTPUT" >&2; exit 1; fi',
      `if [ "$calls" -le "\${FAIL_TIMES:-0}" ]; then echo 'Error: Schema engine error:' >&2; echo '${EXHAUSTED}' >&2; exit 1; fi`,
      "echo 'All migrations have been successfully applied.'",
      '',
    ].join('\n'),
    { mode: 0o755 }
  )
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function runWrapper(env) {
  const result = spawnSync(process.execPath, ['scripts/prisma-migrate-deploy.mjs'], {
    cwd: directory,
    env: {
      PATH: `${path.join(directory, 'bin')}:${process.env.PATH ?? ''}`,
      PRISMA_MIGRATE_POOL_RETRY_BASE_MS: '1',
      ...env,
    },
    encoding: 'utf8',
  })
  const callsFile = path.join(directory, 'calls.txt')
  const calls = fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, 'utf8').trim().split('\n')
    : []
  return { ...result, calls }
}

describe('prisma-migrate-deploy wrapper', () => {
  test('rides out an exhausted session pool and exits 0 once a slot frees', () => {
    const result = runWrapper({ DATABASE_URL: SESSION, FAIL_TIMES: '2' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.calls.length, 3)
    assert.match(result.stderr, /EMAXCONNSESSION/)
    assert.match(result.stdout, /pool exhausted on attempt 1\/8/)
    assert.match(result.stdout, /pool exhausted on attempt 2\/8/)
    assert.match(result.stdout, /successfully applied/)
  })

  test('stops after eight attempts with the named failure', () => {
    const result = runWrapper({ DATABASE_URL: SESSION, FAIL_TIMES: '99' })
    assert.equal(result.status, 1)
    assert.equal(result.calls.length, 8)
    assert.match(result.stderr, /PrismaMigratePoolExhaustedError: .*after 8 attempts/)
  })

  test('passes any other migrate failure through untouched', () => {
    const result = runWrapper({
      DATABASE_URL: SESSION,
      FAIL_OUTPUT: 'Error: P3009 migrate found failed migrations',
    })
    assert.equal(result.status, 1)
    assert.equal(result.calls.length, 1)
    assert.doesNotMatch(result.stdout, /pool exhausted/)
  })

  test('migrates through DIRECT_URL while the runtime uses the transaction pooler', () => {
    const result = runWrapper({ DATABASE_URL: TRANSACTION, DIRECT_URL: SESSION })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, [SESSION])
    assert.match(result.stdout, /Migrating through DIRECT_URL/)
  })

  test('refuses the transaction pooler without running prisma', () => {
    const result = runWrapper({ DATABASE_URL: TRANSACTION })
    assert.equal(result.status, 1)
    assert.deepEqual(result.calls, [])
    assert.match(
      result.stderr,
      /PrismaMigrateTransactionPoolerError: DATABASE_URL points at/
    )
  })
})
