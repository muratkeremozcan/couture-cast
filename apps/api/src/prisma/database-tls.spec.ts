import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withVerifiedDatabaseTls as migrateWithVerifiedDatabaseTls } from '../../../../scripts/lib/database-tls.mjs'
import {
  DatabaseTlsRefusedError,
  findDatabaseCa,
  withVerifiedDatabaseTls,
  withVerifiedDatasource,
} from './database-tls.js'

/** The worker launcher's refusal rules, the oracle every verified URL must pass. */
interface LauncherModule {
  databaseTlsRefusal: (
    env: Record<string, string>,
    fileExists: (candidate: string) => boolean
  ) => string | null
}
const launcher = path.resolve(
  __dirname,
  '../../../../scripts/start-community-worker-production.mjs'
)

const CA = '/var/task/apps/api/certs/supabase-root-2021-ca.pem'
const exists = (candidate: string) => candidate === CA
const tls = { caPath: CA, fileExists: exists }

// The production runtime URL since PR #169: Supabase's transaction pooler.
const TRANSACTION =
  'postgresql://postgres.abcref:p%40ss%2Fw0rd@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5'
const SESSION =
  'postgresql://postgres.abcref:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
const DIRECT = 'postgresql://postgres:pw@db.abcref.supabase.co:5432/postgres'

const REMOTE_CASES: readonly (readonly [string, string, string])[] = [
  [
    'the transaction pooler keeps pgbouncer, connection_limit and the encoded password',
    TRANSACTION,
    `${TRANSACTION}&sslcert=${CA}&sslaccept=strict`,
  ],
  [
    'a URL with no query gets one',
    SESSION,
    `${SESSION}?sslmode=require&sslcert=${CA}&sslaccept=strict`,
  ],
  [
    'a weaker sslmode and sslaccept are upgraded where they stand',
    `${DIRECT}?sslaccept=accept_invalid_certs&sslmode=prefer&pool_timeout=10`,
    `${DIRECT}?sslaccept=strict&sslmode=require&pool_timeout=10&sslcert=${CA}`,
  ],
  [
    'a relative sslcert is replaced, because Prisma resolves it against the client',
    `${SESSION}?sslmode=require&sslcert=certs/ca.pem&sslaccept=strict`,
    `${SESSION}?sslmode=require&sslcert=${CA}&sslaccept=strict`,
  ],
  [
    'an absolute sslcert that does not exist is replaced',
    `${SESSION}?sslcert=/app/missing.pem`,
    `${SESSION}?sslcert=${CA}&sslmode=require&sslaccept=strict`,
  ],
  [
    'a duplicated sslmode collapses to one',
    `${SESSION}?sslmode=disable&sslmode=prefer`,
    `${SESSION}?sslmode=require&sslcert=${CA}&sslaccept=strict`,
  ],
]

const UNCHANGED_CASES: readonly (readonly [string, string])[] = [
  ['the local Supabase stack', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'],
  ['localhost', 'postgresql://postgres:postgres@LOCALHOST:5432/app'],
  ['IPv6 loopback', 'postgresql://postgres:postgres@[::1]:5432/app'],
  [
    'a container reaching the host',
    'postgresql://u:p@host.docker.internal:54322/postgres',
  ],
  [
    "the worker's already verified URL",
    `${SESSION}?sslmode=require&sslcert=${CA}&sslaccept=strict`,
  ],
]

describe('withVerifiedDatabaseTls', () => {
  it.each(REMOTE_CASES)('%s', (_name, input, expected) => {
    expect(withVerifiedDatabaseTls(input, tls)).toBe(expected)
  })

  it.each(UNCHANGED_CASES)('leaves %s as configured', (_name, input) => {
    expect(withVerifiedDatabaseTls(input, tls)).toBe(input)
  })

  it('refuses a remote URL when the CA is not in the deployment', () => {
    expect(() =>
      withVerifiedDatabaseTls(TRANSACTION, { caPath: CA, fileExists: () => false })
    ).toThrow(DatabaseTlsRefusedError)
    expect(() =>
      withVerifiedDatabaseTls(TRANSACTION, { fileExists: () => false })
    ).toThrow(
      /Supabase Root 2021 CA \(certs\/supabase-root-2021-ca\.pem\) is not in this deployment/
    )
  })

  it('refuses a URL that does not parse', () => {
    expect(() => withVerifiedDatabaseTls('postgresql://u:p@[bad/db', tls)).toThrow(
      DatabaseTlsRefusedError
    )
  })

  it('uses the committed CA by default', () => {
    const verified = new URL(withVerifiedDatabaseTls(TRANSACTION))
    const sslcert = verified.searchParams.get('sslcert') ?? ''
    expect(sslcert).toBe(path.resolve(__dirname, '../../certs/supabase-root-2021-ca.pem'))
    expect(readFileSync(sslcert, 'utf8')).toMatch(/^-----BEGIN CERTIFICATE-----/)
  })
})

describe('findDatabaseCa', () => {
  const api = '/var/task/apps/api'
  const at = (file: string) => (candidate: string) => candidate === file

  it.each([
    ['the compiled-in-place sources (Vercel)', `${api}/src/prisma`],
    ['the compiled dist (worker image, start:prod)', `${api}/dist/src/prisma`],
    ['a repository-root working directory', '/var/task'],
  ])('finds apps/api/certs from %s', (_name, start) => {
    expect(findDatabaseCa([start], at(CA))).toBe(CA)
  })

  it('returns undefined when no start reaches the CA', () => {
    expect(findDatabaseCa(['/var/task/apps/api/src/prisma'], () => false)).toBeUndefined()
  })
})

describe('withVerifiedDatasource', () => {
  it('passes the verified ambient DATABASE_URL as datasourceUrl', () => {
    expect(withVerifiedDatasource(undefined, { DATABASE_URL: TRANSACTION }, tls)).toEqual(
      {
        datasourceUrl: `${TRANSACTION}&sslcert=${CA}&sslaccept=strict`,
      }
    )
  })

  it('leaves a local client to read DATABASE_URL lazily', () => {
    const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    expect(
      withVerifiedDatasource(undefined, { DATABASE_URL: local }, tls)
    ).toBeUndefined()
    expect(withVerifiedDatasource(undefined, {}, tls)).toBeUndefined()
    const options = { log: ['warn' as const] }
    expect(withVerifiedDatasource(options, { DATABASE_URL: local }, tls)).toBe(options)
  })

  it('completes an explicit datasources url and keeps the other options', () => {
    expect(
      withVerifiedDatasource(
        { log: ['warn'], datasources: { db: { url: SESSION } } },
        { DATABASE_URL: 'postgresql://ignored@127.0.0.1/x' },
        tls
      )
    ).toEqual({
      log: ['warn'],
      datasources: {
        db: { url: `${SESSION}?sslmode=require&sslcert=${CA}&sslaccept=strict` },
      },
    })
  })

  it('completes an explicit datasourceUrl', () => {
    expect(withVerifiedDatasource({ datasourceUrl: DIRECT }, {}, tls)).toEqual({
      datasourceUrl: `${DIRECT}?sslmode=require&sslcert=${CA}&sslaccept=strict`,
    })
  })

  it('refuses an unverifiable production URL at client construction', () => {
    expect(() =>
      withVerifiedDatasource(
        undefined,
        { NODE_ENV: 'production', DATABASE_URL: TRANSACTION },
        { fileExists: () => false }
      )
    ).toThrow(DatabaseTlsRefusedError)
  })
})

describe('parity with the migrate wrapper and the worker launcher', () => {
  const production = (url: string) => ({ NODE_ENV: 'production', DATABASE_URL: url })

  it.each([...REMOTE_CASES, ...UNCHANGED_CASES.map(([n, i]) => [n, i, i] as const)])(
    '%s: the migrate wrapper produces the same URL',
    (_name, input) => {
      expect(migrateWithVerifiedDatabaseTls(input, tls)).toBe(
        withVerifiedDatabaseTls(input, tls)
      )
    }
  )

  it.each(REMOTE_CASES)(
    '%s: the worker would refuse the input and accepts the result',
    async (_name, input, expected) => {
      const { databaseTlsRefusal } = (await import(launcher)) as LauncherModule
      expect(databaseTlsRefusal(production(input), exists)).toEqual(expect.any(String))
      expect(databaseTlsRefusal(production(expected), exists)).toBeNull()
    }
  )
})

describe('Vercel function bundle', () => {
  const config = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')
  ) as { functions: Record<string, { includeFiles?: string }> }

  // Both functions build a Prisma client, so both need the CA beside them.
  it.each(['api/index.ts', 'api/realtime.ts'])(
    '%s includes the committed CA',
    (entry) => {
      const includeFiles = config.functions[entry]?.includeFiles ?? ''
      expect(path.matchesGlob('certs/supabase-root-2021-ca.pem', includeFiles)).toBe(true)
    }
  )

  it('still includes the share-card assets', () => {
    const includeFiles = config.functions['api/index.ts']?.includeFiles ?? ''
    expect(
      path.matchesGlob('dist/src/modules/share-cards/assets/fonts.conf', includeFiles)
    ).toBe(true)
  })
})
