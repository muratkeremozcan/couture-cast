// Story 6.5 dispatch guard pool's database client (2026-11-11, X-DISPATCH follow-up).
import { readFileSync } from 'node:fs'
import type { Socket } from 'node:net'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PrismaClient } from '@prisma/client'
import pg from 'pg'
import {
  DatabaseTlsRefusedError,
  findDatabaseCa,
  LOCAL_DATABASE_HOSTS,
} from './database-tls.js'
import { createPrismaClient } from './prisma-client.js'

/**
 * Why the guard pool runs on node-postgres and not the Prisma engine's own pool.
 *
 * A guard connection that accepts a query and never answers (a pooler that stalls, a path that
 * stops forwarding) was measured against Prisma 6.19's engine on 2026-11-11: the query neither
 * resolved nor rejected after 60 s with `socket_timeout=3`, and `$disconnect` waited on it, so
 * the connection stayed open until the process ended. Here every query has `queryTimeoutMs`,
 * and a query that runs out destroys its socket, so the pool drops that client and opens a
 * fresh one when it is next needed.
 *
 * Every failure to get or use a guard connection (opening it, waiting for it, a query that is
 * never answered, the connection lost under a query) reaches the caller as a GuardDriverError, so
 * the dispatch preflight and the send guard can tell "the guard database is unreachable" apart
 * from a real answer. Prisma passes such an error through unchanged: the adapter maps only
 * PostgreSQL, socket and TLS errors.
 *
 * TLS is the operator client's (operator-prisma-client.ts): the committed Supabase root CA,
 * the host name checked, nothing unverified. Query parameters are dropped, because `pgbouncer`,
 * `connection_limit` and `sslmode` are Prisma engine settings and node-postgres would read
 * `sslmode=require` as "encrypt without verifying".
 */
export type GuardDriverFailure =
  | 'acquire_timeout'
  | 'connect_failed'
  | 'query_timeout'
  | 'connection_lost'

export class GuardDriverError extends Error {
  constructor(
    readonly kind: GuardDriverFailure,
    options?: { cause?: unknown }
  ) {
    super(`Community dispatch guard connection failed: ${kind}.`, options)
    this.name = 'GuardDriverError'
  }
}

export type GuardPoolOptions = {
  /** Connections the pool may hold: send slots plus the control connections. */
  max: number
  /** Longest wait for a connection, opening one included. */
  acquireTimeoutMs: number
  /** Longest one query may wait for its answer before its connection is destroyed. */
  queryTimeoutMs: number
}

const QUERY_READ_TIMEOUT = 'Query read timeout'
const ACQUIRE_TIMEOUT = 'timeout exceeded when trying to connect'
/** What node-postgres rejects a query with when its established connection goes away. */
const CONNECTION_LOST = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
])

/**
 * A failure of the connection itself, never an answer from PostgreSQL: one of node-postgres's
 * own connection messages, or a socket error (ECONNRESET, EPIPE and the like, which carry the
 * failed `syscall`). A SQL error is a `pg.DatabaseError` with a SQLSTATE and is never one.
 */
function isConnectionLost(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof pg.DatabaseError) return false
  if (CONNECTION_LOST.has(error.message)) return true
  const { code, syscall } = error as { code?: unknown; syscall?: unknown }
  return typeof syscall === 'string' && typeof code === 'string' && /^E[A-Z]+$/.test(code)
}

type Callback = (...args: unknown[]) => void

/** A failure of an established guard connection as a GuardDriverError; anything else as is. */
function guardQueryError(error: unknown): unknown {
  if (error instanceof GuardDriverError || !isConnectionLost(error)) return error
  return new GuardDriverError('connection_lost', { cause: error })
}

/**
 * Runs a node-postgres `query`, in whichever of its call styles it was given (a trailing
 * callback, or a returned promise), with its error passed through `map`.
 */
function mappingErrors(
  args: unknown[],
  query: (...parameters: unknown[]) => unknown,
  map: (error: unknown) => unknown
): never {
  const last = args.at(-1)
  if (typeof last === 'function') {
    const callback = last as Callback
    args[args.length - 1] = (error: unknown, ...rest: unknown[]) =>
      callback(error ? map(error) : error, ...rest)
    return query(...args) as never
  }
  const result = query(...args)
  if (result instanceof Promise)
    return result.catch((error: unknown) => {
      throw map(error)
    }) as never
  return result as never
}

/**
 * A client that destroys its socket when a query outlives `query_timeout`, and names a query
 * whose connection was lost under it (the pooler closed it, the network reset it) as
 * `connection_lost`, so it is told apart from a SQL error.
 */
class GuardClient extends pg.Client {
  // node-postgres overloads `query` many ways; the wrapper only watches how it settles.
  override query(...args: unknown[]): never {
    return mappingErrors(
      args,
      (...parameters) => (super.query as (...all: unknown[]) => unknown)(...parameters),
      (error) => {
        if (!(error instanceof Error) || error.message !== QUERY_READ_TIMEOUT)
          return guardQueryError(error)
          // The answer may still arrive later and would be read as the next query's, so the
          // connection cannot be reused: end it at the socket, which also ends the client.
        ;(
          this as unknown as { connection?: { stream?: Socket } }
        ).connection?.stream?.destroy()
        return new GuardDriverError('query_timeout', { cause: error })
      }
    )
  }
}

function guardConnectError(error: unknown): GuardDriverError {
  if (error instanceof GuardDriverError) return error
  const kind =
    error instanceof Error && error.message === ACQUIRE_TIMEOUT
      ? 'acquire_timeout'
      : 'connect_failed'
  return new GuardDriverError(kind, { cause: error })
}

type ConnectCallback = (
  error: Error | undefined,
  client: pg.PoolClient | undefined,
  done: (release?: Error | boolean) => void
) => void

/**
 * A pool whose connection failures are GuardDriverErrors, in both of its call styles. Its own
 * `query` needs the mapping as well: when a connection is lost mid-query, pg-pool answers with
 * the client's `error` event, which reaches the caller without passing through GuardClient.
 */
class GuardPool extends pg.Pool {
  override query(...args: unknown[]): never {
    return mappingErrors(
      args,
      (...parameters) => (super.query as (...all: unknown[]) => unknown)(...parameters),
      guardQueryError
    )
  }

  override connect(): Promise<pg.PoolClient>
  override connect(callback: ConnectCallback): void
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    if (callback) {
      super.connect((error, client, done) =>
        callback(error ? guardConnectError(error) : undefined, client, done)
      )
      return
    }
    return super.connect().catch((error: unknown) => {
      throw guardConnectError(error)
    })
  }
}

/** The guard pool's Prisma client over node-postgres; see the note at the top of this file. */
export function createGuardPrismaClient(
  databaseUrl: string,
  options: GuardPoolOptions,
  readCa: (path: string) => string = (path) => readFileSync(path, 'utf8')
): PrismaClient {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new DatabaseTlsRefusedError('The guard database URL does not parse.')
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  const local = LOCAL_DATABASE_HOSTS.has(host)
  const caPath = local ? undefined : findDatabaseCa()
  if (!local && !caPath)
    throw new DatabaseTlsRefusedError('The Supabase root CA was not found.')
  const schema = url.searchParams.get('schema')
  for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key)
  const pool = new GuardPool({
    connectionString: url.toString(),
    ...(caPath
      ? { ssl: { ca: readCa(caPath), servername: host, rejectUnauthorized: true } }
      : {}),
    Client: GuardClient,
    max: options.max,
    connectionTimeoutMillis: options.acquireTimeoutMs,
    query_timeout: options.queryTimeoutMs,
    // Opened connections stay: opening one costs 0.6 to 1.2 s, more than a send may wait.
    idleTimeoutMillis: 0,
    keepAlive: true,
  })
  // An idle client that errors is dropped by the pool; the listener keeps it from throwing.
  pool.on('error', () => undefined)
  return createPrismaClient({
    // The adapter compiles against its own copy of the pg types; the pool is the same class.
    adapter: new PrismaPg(pool as unknown as ConstructorParameters<typeof PrismaPg>[0], {
      ...(schema ? { schema } : {}),
      disposeExternalPool: true,
    }),
  })
}
