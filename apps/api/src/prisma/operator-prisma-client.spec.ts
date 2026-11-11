// Story 6.14 follow-up: the operator commands' verified client.
import { afterEach, describe, expect, it, vi } from 'vitest'

const pgAdapter = vi.hoisted(() => vi.fn())
const pgAdapterOptions = vi.hoisted(() => vi.fn())
const createPrismaClient = vi.hoisted(() => vi.fn(() => ({ kind: 'api-client' })))
const findDatabaseCa = vi.hoisted(() =>
  vi.fn<() => string | undefined>(() => '/repo/apps/api/certs/ca.pem')
)

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: function PrismaPg(this: unknown, config: unknown, options?: unknown) {
    pgAdapter(config)
    pgAdapterOptions(options)
  },
}))
vi.mock('./prisma-client.js', () => ({ createPrismaClient }))
vi.mock('./database-tls.js', async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseTls>()),
  findDatabaseCa,
}))

import type * as DatabaseTls from './database-tls.js'
import { DatabaseTlsRefusedError } from './database-tls.js'
import { createOperatorPrismaClient } from './operator-prisma-client.js'

const remote =
  'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5'

afterEach(() => vi.clearAllMocks())

describe('createOperatorPrismaClient', () => {
  it('keeps the API client for a loopback database', () => {
    const url = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    expect(createOperatorPrismaClient(url)).toEqual({ kind: 'api-client' })
    expect(createPrismaClient).toHaveBeenCalledWith({ datasources: { db: { url } } })
    expect(pgAdapter).not.toHaveBeenCalled()
  })

  it('verifies a remote certificate against the committed CA and host, with no engine params', () => {
    createOperatorPrismaClient(remote, () => 'CA-PEM')
    expect(pgAdapter).toHaveBeenCalledWith({
      connectionString:
        'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
      ssl: {
        ca: 'CA-PEM',
        servername: 'aws-1-us-east-1.pooler.supabase.com',
        rejectUnauthorized: true,
      },
      max: 1,
    })
    // Through the central factory, so the retry extension wraps the operator client too.
    expect(createPrismaClient).toHaveBeenCalledTimes(1)
    const [options] = createPrismaClient.mock.calls[0] as unknown as [
      { adapter: unknown },
    ]
    expect(Object.keys(options)).toEqual(['adapter'])
    expect(options.adapter).toBeInstanceOf(Object)
  })

  it('passes no schema option when the URL names none', () => {
    createOperatorPrismaClient(remote, () => 'CA-PEM')
    expect(pgAdapterOptions).toHaveBeenCalledWith(undefined)
  })

  it('keeps a configured schema as the adapter option after dropping the URL params', () => {
    createOperatorPrismaClient(`${remote}&schema=ops`, () => 'CA-PEM')
    expect(pgAdapterOptions).toHaveBeenCalledWith({ schema: 'ops' })
    const [config] = pgAdapter.mock.calls[0] as [{ connectionString: string }]
    expect(config.connectionString).not.toContain('schema=')
  })

  it('refuses a remote database when the CA is missing', () => {
    findDatabaseCa.mockReturnValueOnce(undefined)
    expect(() => createOperatorPrismaClient(remote)).toThrow(DatabaseTlsRefusedError)
    expect(pgAdapter).not.toHaveBeenCalled()
  })

  it('refuses a URL that does not parse', () => {
    expect(() => createOperatorPrismaClient('not a url')).toThrow(DatabaseTlsRefusedError)
  })
})
