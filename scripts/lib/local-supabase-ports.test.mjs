import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import {
  isLocalSupabaseDatabaseUrl,
  localDatabaseUrl,
  localMailpitUrl,
  localSupabaseApiUrl,
  localSupabasePorts,
} from './local-supabase-ports.mjs'

const CI = {
  SUPABASE_API_PORT: '24321',
  SUPABASE_DB_PORT: '24322',
  SUPABASE_INBUCKET_PORT: '24324',
}

describe('local Supabase ports', () => {
  test('a developer environment reads supabase/config.toml', () => {
    assert.deepEqual(localSupabasePorts({}), { api: 54321, db: 54322, inbucket: 54324 })
    assert.equal(
      localDatabaseUrl({}),
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    )
    assert.equal(localSupabaseApiUrl({}), 'http://127.0.0.1:54321')
    assert.equal(localMailpitUrl({}), 'http://127.0.0.1:54324')
  })

  test("CI's SUPABASE_*_PORT overrides win, as they do in the Supabase CLI", () => {
    assert.deepEqual(localSupabasePorts(CI), { api: 24321, db: 24322, inbucket: 24324 })
    assert.equal(
      localDatabaseUrl(CI),
      'postgresql://postgres:postgres@127.0.0.1:24322/postgres'
    )
    assert.equal(localMailpitUrl(CI), 'http://127.0.0.1:24324')
  })

  test('an override that is not a port fails instead of falling back', () => {
    for (const value of ['abc', '0', '70000', '24322x'])
      assert.throws(
        () => localSupabasePorts({ SUPABASE_DB_PORT: value }),
        new RegExp(`SUPABASE_DB_PORT must be a TCP port, got '${value}'`)
      )
  })

  test('the local database is a loopback host on the configured port, nothing else', () => {
    const at = (port, host = '127.0.0.1') =>
      `postgresql://postgres:postgres@${host}:${port}/postgres`
    assert.equal(isLocalSupabaseDatabaseUrl(at(54322), {}), true)
    assert.equal(isLocalSupabaseDatabaseUrl(at(54322, 'localhost'), {}), true)
    // CI's stack is on 24322: a URL for config.toml's 54322 is some other server there.
    assert.equal(isLocalSupabaseDatabaseUrl(at(54322), CI), false)
    assert.equal(isLocalSupabaseDatabaseUrl(at(24322), CI), true)
    assert.equal(isLocalSupabaseDatabaseUrl(at(24322), {}), false)
    assert.equal(isLocalSupabaseDatabaseUrl(at(54322, 'db.example.com'), {}), false)
    assert.equal(isLocalSupabaseDatabaseUrl('http://127.0.0.1:54322/postgres', {}), false)
    assert.equal(isLocalSupabaseDatabaseUrl(undefined, {}), false)
    assert.equal(isLocalSupabaseDatabaseUrl('not a url', {}), false)
  })
})

describe('run-with-local-db-env Prisma consent', () => {
  const wrapper = fileURLToPath(new URL('../run-with-local-db-env.mjs', import.meta.url))
  const consent = (env) => {
    const result = spawnSync(
      process.execPath,
      [
        wrapper,
        process.execPath,
        '-e',
        "console.log('consent=' + (process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION ? 'yes' : 'no'))",
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          // Storage keys present, so the wrapper never asks a Supabase CLI.
          SUPABASE_URL: 'http://127.0.0.1:1',
          SUPABASE_SERVICE_ROLE_KEY: 'test',
          ...env,
        },
      }
    )
    assert.equal(result.status, 0, result.stderr)
    return /consent=(yes|no)/.exec(result.stdout)?.[1]
  }

  test('is recorded only for the local Supabase server on its configured port', () => {
    const at = (port) => `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`
    assert.equal(consent({ DATABASE_URL: at(54322) }), 'yes')
    assert.equal(consent({ DATABASE_URL: at(24322), ...CI }), 'yes')
    // On CI's ports, the developer default port is not the test database: no consent.
    assert.equal(consent({ DATABASE_URL: at(54322), ...CI }), 'no')
    assert.equal(consent({ DATABASE_URL: at(5432) }), 'no')
    assert.equal(
      consent({
        DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:54322/postgres',
      }),
      'no'
    )
  })
})

describe('start:all resets only the configured local database', () => {
  const wrapper = fileURLToPath(new URL('../run-with-local-db-env.mjs', import.meta.url))
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const run = (env) =>
    spawnSync(
      process.execPath,
      [
        wrapper,
        '--require-local',
        process.execPath,
        '-e',
        'console.log(process.env.DATABASE_URL)',
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          TEST_ENV: 'local',
          SUPABASE_URL: 'http://127.0.0.1:1',
          SUPABASE_SERVICE_ROLE_KEY: 'test',
          ...env,
        },
      }
    )
  const at = (port) => `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`

  test('fills the database on the configured port', () => {
    const result = run(CI)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /127\.0\.0\.1:24322\/postgres/)
  })

  test('refuses a DATABASE_URL on another port than the one Supabase binds', () => {
    const result = run({ ...CI, DATABASE_URL: at(54322) })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /refusing/i)
    assert.doesNotMatch(result.stdout, /postgresql:/)
  })

  test('refuses another database or schema on the configured server', () => {
    for (const url of [
      'postgresql://postgres:postgres@127.0.0.1:24322/customer_records',
      'postgresql://postgres:postgres@127.0.0.1:24322/postgres?schema=customer_records',
    ]) {
      const result = run({ ...CI, DATABASE_URL: url })
      assert.equal(result.status, 1, url)
      assert.match(result.stderr, /refusing/i, url)
    }
    const publicSchema = run({ ...CI, DATABASE_URL: `${at(24322)}?schema=public` })
    assert.equal(publicSchema.status, 0, publicSchema.stderr)
  })

  test('the start:all script goes through that guard and names no port', () => {
    const script = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      .scripts['start:all']
    assert.doesNotMatch(script, /\b5432\d\b/)
    assert.match(
      script,
      /run-with-local-db-env\.mjs --require-local npm-run-all2 --sequential supabase:start db:reset/
    )
  })
})
