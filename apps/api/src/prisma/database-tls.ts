import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Prisma } from '@prisma/client'

/*
 * Story 6.2b final review (RF3): every Prisma client the API builds verifies the
 * database's certificate, the way the community worker does.
 *
 * Prisma's `sslmode=require` alone encrypts without checking who answers.
 * `sslaccept=strict` with `sslcert` naming the Supabase Root 2021 CA makes the
 * engine verify the chain and the host name. Both Supabase poolers (5432 session,
 * 6543 transaction) present `*.pooler.supabase.com` signed by Supabase
 * Intermediate 2021 CA, which chains to that root (checked 2026-10-31 with
 * `openssl s_client -starttls postgres -verify_hostname`).
 *
 * The connection string is completed here, in code, so the deployed
 * DATABASE_URL values keep working unchanged: the CA path differs between the
 * Vercel function, the worker image and a laptop, and only the running process
 * knows where it is. Every other parameter (pgbouncer, connection_limit,
 * pool_timeout) and the credentials stay byte for byte as configured.
 *
 * `scripts/lib/database-tls.mjs` applies the same rules to `prisma migrate
 * deploy`; `database-tls.spec.ts` holds the two to the same table and checks
 * every result against the worker launcher's own refusal rules.
 */

/** The committed CA, relative to the api workspace (`apps/api`). */
export const DATABASE_CA_RELATIVE_PATH = path.join('certs', 'supabase-root-2021-ca.pem')

/**
 * Hosts with no TLS to verify: the local Supabase stack, CI's service
 * containers, and a container reaching the laptop's own PostgreSQL. The worker
 * launcher exempts the same set.
 */
export const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  'host.docker.internal',
])

/** Thrown when a remote database URL cannot be made to verify its certificate. */
export class DatabaseTlsRefusedError extends Error {
  constructor(reason: string) {
    super(
      `${reason} Refusing to connect without verifying the database certificate ` +
        `(Story 6.2b RF3); deploy ${DATABASE_CA_RELATIVE_PATH} with the API.`
    )
    this.name = 'DatabaseTlsRefusedError'
  }
}

type FileExists = (candidate: string) => boolean

/**
 * Where the committed CA is in this deployment. Walks up from each start: from
 * `src/prisma` (Vercel compiles the sources in place) and `dist/src/prisma` (the
 * worker image and `start:prod`) the walk reaches `apps/api/certs`, and from a
 * repository-root working directory the `apps/api` candidate does.
 */
export function findDatabaseCa(
  starts: readonly string[] = [__dirname, process.cwd()],
  fileExists: FileExists = existsSync
): string | undefined {
  for (const start of starts) {
    let current = path.resolve(start)
    for (;;) {
      for (const candidate of [
        path.join(current, DATABASE_CA_RELATIVE_PATH),
        path.join(current, 'apps', 'api', DATABASE_CA_RELATIVE_PATH),
      ]) {
        if (fileExists(candidate)) return candidate
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return undefined
}

/** A query value as Prisma reads it back; `/` stays readable in a CA path. */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '/')
}

function queryKey(segment: string): string {
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
 */
function setQueryParams(raw: string, updates: ReadonlyMap<string, string>): string {
  const hashAt = raw.indexOf('#')
  const withoutHash = hashAt === -1 ? raw : raw.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : raw.slice(hashAt)
  const queryAt = withoutHash.indexOf('?')
  const base = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt)
  const query = queryAt === -1 ? '' : withoutHash.slice(queryAt + 1)
  const written = new Set<string>()
  const segments: string[] = []
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
 * already verifies or names a local host.
 *
 * A remote URL gets `sslmode=require` and `sslaccept=strict`, and keeps an
 * `sslcert` only when it is an absolute path to a file that exists (Prisma
 * resolves a relative one against the generated client's directory); otherwise
 * `sslcert` names the committed CA. Throws DatabaseTlsRefusedError when the URL
 * does not parse or the CA is not in this deployment.
 */
export function withVerifiedDatabaseTls(
  raw: string,
  options: { caPath?: string; fileExists?: FileExists } = {}
): string {
  const fileExists = options.fileExists ?? existsSync
  const url = remoteDatabaseUrl(raw)
  if (!url) return raw

  const updates = new Map<string, string>()
  if (url.searchParams.get('sslmode') !== 'require') updates.set('sslmode', 'require')
  const sslcert = url.searchParams.get('sslcert')
  if (!isReadableAbsolute(sslcert, fileExists)) {
    const caPath = options.caPath ?? findDatabaseCa(undefined, fileExists)
    if (!isReadableAbsolute(caPath, fileExists)) {
      throw new DatabaseTlsRefusedError(
        `The Supabase Root 2021 CA (${DATABASE_CA_RELATIVE_PATH}) is not in this deployment.`
      )
    }
    updates.set('sslcert', caPath)
  }
  if (url.searchParams.get('sslaccept') !== 'strict') updates.set('sslaccept', 'strict')
  return updates.size === 0 ? raw : setQueryParams(raw, updates)
}

/** The parsed URL when it names a remote PostgreSQL host, otherwise undefined. */
function remoteDatabaseUrl(raw: string): URL | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DatabaseTlsRefusedError('The database URL is not a valid URL.')
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return undefined
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  return LOCAL_DATABASE_HOSTS.has(host) ? undefined : url
}

function isReadableAbsolute(
  file: string | null | undefined,
  fileExists: FileExists
): file is string {
  return typeof file === 'string' && path.isAbsolute(file) && fileExists(file)
}

/**
 * Prisma client options whose datasource verifies the database certificate:
 * an explicit `datasources.db.url` or `datasourceUrl` is completed in place,
 * and with neither the ambient DATABASE_URL is passed as `datasourceUrl`. The
 * options come back unchanged when nothing needs completing, so a local or
 * test client still reads DATABASE_URL lazily, as Prisma does by default.
 */
export function withVerifiedDatasource(
  options: Prisma.PrismaClientOptions | undefined,
  env: NodeJS.ProcessEnv = process.env,
  tls: Parameters<typeof withVerifiedDatabaseTls>[1] = {}
): Prisma.PrismaClientOptions | undefined {
  const explicit = options?.datasources?.db?.url
  if (options && explicit) {
    const verified = withVerifiedDatabaseTls(explicit, tls)
    if (verified === explicit) return options
    return {
      ...options,
      datasources: {
        ...options.datasources,
        db: { ...options.datasources?.db, url: verified },
      },
    }
  }
  if (options?.datasourceUrl) {
    const verified = withVerifiedDatabaseTls(options.datasourceUrl, tls)
    return verified === options.datasourceUrl
      ? options
      : { ...options, datasourceUrl: verified }
  }
  const ambient = env.DATABASE_URL
  if (!ambient) return options
  const verified = withVerifiedDatabaseTls(ambient, tls)
  return verified === ambient ? options : { ...options, datasourceUrl: verified }
}
