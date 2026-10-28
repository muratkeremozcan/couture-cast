import { Prisma, PrismaClient } from '@prisma/client'

/**
 * The Supabase Postgres image preloads plpgsql_check, whose pldbgapi2 layer hooks every
 * PL/pgSQL call and can abort an ordinary nested call with this internal error
 * (okbob/plpgsql_check#197). Writes to the community, consent, token and preference
 * tables can run nested PL/pgSQL: privacy-assert triggers call community_require_guard,
 * and the invalidation triggers call community_record_invalidation, which updates
 * LookbookPost and fires its triggers.
 *
 * The error aborts its statement and, inside an interactive transaction, the whole
 * transaction, so every write it made is rolled back. Repeating the whole unit of work
 * is therefore safe: the single statement for a top-level operation, the whole callback
 * for a transaction. This file is the only place either is repeated.
 */
export const PLDBGAPI2_STACK_ERROR =
  'cannot find parent statement on pldbgapi2 call stack'

/** Attempts in all, retried at once: the abort already rolled the work back. */
export const PLDBGAPI2_MAX_ATTEMPTS = 3

// Model operations surface an unmapped database error as an unknown request error
// whose message carries the engine's PostgresError rendering (measured on Prisma
// 6.19). Only that SQLSTATE plus that exact message matches.
const UNKNOWN_REQUEST_SIGNATURE = `PostgresError { code: "XX000", message: "${PLDBGAPI2_STACK_ERROR}"`

/** Matches only SQLSTATE XX000 with the pldbgapi2 message, in either Prisma form. */
export function isPldbgapi2StackError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientUnknownRequestError)
    return error.message.includes(UNKNOWN_REQUEST_SIGNATURE)
  // Raw queries report a known request error (P2010) with the SQLSTATE in meta.
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  const meta = error.meta as { code?: unknown; message?: unknown } | undefined
  if (meta?.code !== 'XX000') return false
  const message = typeof meta.message === 'string' ? meta.message : error.message
  return message.includes(PLDBGAPI2_STACK_ERROR)
}

/** Runs `attempt` until it settles without the pldbgapi2 error, at most 3 times. */
export async function retryPldbgapi2<T>(attempt: () => Promise<T>): Promise<T> {
  for (let made = 1; ; made++) {
    try {
      return await attempt()
    } catch (error) {
      if (made < PLDBGAPI2_MAX_ATTEMPTS && isPldbgapi2StackError(error)) continue
      throw error
    }
  }
}

type TransactionOptions = Parameters<PrismaClient['$transaction']>[1]
type Transactor = Pick<PrismaClient, '$transaction'>
type Work<T> = (tx: Prisma.TransactionClient) => Promise<T>

function startTransaction<T>(
  prisma: Transactor,
  work: Work<T>,
  options: TransactionOptions | (() => TransactionOptions)
): Promise<T> {
  const resolved = typeof options === 'function' ? options() : options
  return resolved === undefined
    ? prisma.$transaction(work)
    : prisma.$transaction(work, resolved)
}

/**
 * Every interactive transaction in the API goes through here or through
 * singleRunTransaction (a guard spec scans `src` for any other `$transaction` call).
 * A callback must keep every write on `tx` and do nothing a rollback cannot undo,
 * because the pldbgapi2 abort re-runs it. Options given as a function are computed
 * again for each attempt, so a deadline-derived timeout shrinks with the deadline.
 */
export function interactiveTransaction<T>(
  prisma: Transactor,
  work: Work<T>,
  options?: TransactionOptions | (() => TransactionOptions)
): Promise<T> {
  return retryPldbgapi2(() => startTransaction(prisma, work, options))
}

/**
 * Runs once, for a callback that does something before commit that a rollback cannot
 * undo: a provider send, an analytics capture, a write on another connection. Each
 * caller writes no table whose triggers run nested PL/pgSQL, so the pldbgapi2 abort
 * cannot reach it; the guard spec pins the callers.
 */
export function singleRunTransaction<T>(
  prisma: Transactor,
  work: Work<T>,
  options?: TransactionOptions
): Promise<T> {
  return startTransaction(prisma, work, options)
}

/**
 * Retries a top-level operation, which Postgres runs as its own implicit transaction.
 * Inside an interactive or batch transaction it only passes the operation through: the
 * abort has already doomed that transaction, so only interactiveTransaction may repeat
 * it. Prisma marks those operations with `__internalParams.transaction`; the
 * integration spec fails if a Prisma upgrade stops doing so.
 */
export async function retryTopLevelOperation(params: {
  args: unknown
  query: (args: unknown) => Promise<unknown>
}): Promise<unknown> {
  const internal = (params as { __internalParams?: { transaction?: unknown } })
    .__internalParams
  if (internal?.transaction !== undefined) return params.query(params.args)
  return retryPldbgapi2(() => params.query(params.args))
}

/**
 * The only constructor of a production Prisma client. The extended client keeps
 * PrismaClient's runtime API apart from `$on`, which the API never calls.
 */
export function createPrismaClient(options?: Prisma.PrismaClientOptions): PrismaClient {
  return new PrismaClient(options).$extends({
    name: 'pldbgapi2-retry',
    query: { $allOperations: (params) => retryTopLevelOperation(params) },
  }) as unknown as PrismaClient
}
