/**
 * Certificate verification for the connection `prisma migrate deploy` opens
 * (Story 6.2b final review, RF3).
 *
 * The same rules as `apps/api/src/prisma/database-tls.ts`, which the API's
 * Prisma clients use: a remote URL gets `sslmode=require`, `sslaccept=strict`
 * and an absolute `sslcert` naming the committed Supabase Root 2021 CA, so the
 * engine verifies the chain and the host name. A local host is left alone. The
 * wrapper runs before the API workspace is compiled, so it cannot import the
 * TypeScript module; `apps/api/src/prisma/database-tls.spec.ts` holds the two
 * to one table and checks every result against the worker launcher's refusal
 * rules.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The committed CA, resolved from this file so any working directory works. */
export const DATABASE_CA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/api/certs/supabase-root-2021-ca.pem'
)

/** Hosts with no TLS to verify; the API and the worker launcher exempt the same set. */
export const LOCAL_DATABASE_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  'host.docker.internal',
])

/** Thrown when a remote database URL cannot be made to verify its certificate. */
export class DatabaseTlsRefusedError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(
      `${reason} Refusing to connect without verifying the database certificate ` +
        '(Story 6.2b RF3); apps/api/certs/supabase-root-2021-ca.pem must be present.'
    )
    this.name = 'DatabaseTlsRefusedError'
  }
}

/** @param {string} value */
function encodeQueryValue(value) {
  return encodeURIComponent(value).replace(/%2F/gi, '/')
}

/** @param {string} segment */
function queryKey(segment) {
  const equals = segment.indexOf('=')
  const raw = (equals === -1 ? segment : segment.slice(0, equals)).replace(/\+/g, ' ')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Sets each of `updates` in the query of `raw`, in place of its first
 * occurrence (later duplicates dropped) or appended. Everything before the `?`
 * and every other query segment is kept exactly as written.
 *
 * @param {string} raw
 * @param {Map<string, string>} updates
 */
function setQueryParams(raw, updates) {
  const hashAt = raw.indexOf('#')
  const withoutHash = hashAt === -1 ? raw : raw.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : raw.slice(hashAt)
  const queryAt = withoutHash.indexOf('?')
  const base = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt)
  const query = queryAt === -1 ? '' : withoutHash.slice(queryAt + 1)
  const written = new Set()
  const segments = []
  for (const segment of query.split('&')) {
    if (!segment) continue
    const key = queryKey(segment)
    const value = updates.get(key)
    if (value === undefined) {
      segments.push(segment)
    } else if (!written.has(key)) {
      segments.push(`${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
      written.add(key)
    }
  }
  for (const [key, value] of updates) {
    if (!written.has(key))
      segments.push(`${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
  }
  return `${base}?${segments.join('&')}${hash}`
}

/**
 * `raw` with certificate verification switched on, or `raw` itself when it
 * already verifies or names a local host. Keeps an existing absolute `sslcert`
 * that exists; otherwise names the committed CA.
 *
 * @param {string} raw
 * @param {{ caPath?: string, fileExists?: (candidate: string) => boolean }} [options]
 * @returns {string}
 */
export function withVerifiedDatabaseTls(raw, options = {}) {
  const fileExists = options.fileExists ?? existsSync
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new DatabaseTlsRefusedError('The database URL is not a valid URL.')
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return raw
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  if (LOCAL_DATABASE_HOSTS.has(host)) return raw

  const updates = new Map()
  if (url.searchParams.get('sslmode') !== 'require') updates.set('sslmode', 'require')
  const sslcert = url.searchParams.get('sslcert')
  if (!sslcert || !path.isAbsolute(sslcert) || !fileExists(sslcert)) {
    const caPath = options.caPath ?? DATABASE_CA_PATH
    if (!path.isAbsolute(caPath) || !fileExists(caPath)) {
      throw new DatabaseTlsRefusedError(
        `The Supabase Root 2021 CA (${caPath}) does not exist.`
      )
    }
    updates.set('sslcert', caPath)
  }
  if (url.searchParams.get('sslaccept') !== 'strict') updates.set('sslaccept', 'strict')
  return updates.size === 0 ? raw : setQueryParams(raw, updates)
}
