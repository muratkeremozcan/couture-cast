// Owner operator commands' database client (Story 6.14 follow-up).
import { readFileSync } from 'node:fs'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PrismaClient } from '@prisma/client'
import {
  DatabaseTlsRefusedError,
  findDatabaseCa,
  LOCAL_DATABASE_HOSTS,
} from './database-tls.js'
import { createPrismaClient } from './prisma-client.js'

/**
 * The client the owner's operator commands (`access:complimentary`, `community:sponsorship`)
 * connect with.
 *
 * A loopback database takes the API's own client unchanged. A remote one connects through
 * node-postgres, which verifies the Supabase certificate with Node's OpenSSL against the
 * committed root CA, host name included. The Prisma engine's TLS on macOS rejects that same
 * chain (a five-year pooler certificate with no SCTs), so the API's client cannot reach
 * production from the owner's laptop; OpenSSL verifies it as the worker image does.
 *
 * Every query parameter is dropped from the connection string: `pgbouncer`,
 * `connection_limit` and `sslmode` are Prisma engine settings, and node-postgres would read
 * `sslmode=require` as "encrypt without verifying" and override the CA below.
 */
export function createOperatorPrismaClient(
  databaseUrl: string,
  readCa: (path: string) => string = (path) => readFileSync(path, 'utf8')
): PrismaClient {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new DatabaseTlsRefusedError('DATABASE_URL does not parse.')
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (LOCAL_DATABASE_HOSTS.has(host)) {
    return createPrismaClient({ datasources: { db: { url: databaseUrl } } })
  }
  const caPath = findDatabaseCa()
  if (!caPath) throw new DatabaseTlsRefusedError('The Supabase root CA was not found.')
  for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key)
  const adapter = new PrismaPg({
    connectionString: url.toString(),
    ssl: { ca: readCa(caPath), servername: host, rejectUnauthorized: true },
    max: 1,
  })
  return createPrismaClient({ adapter })
}
