import { Prisma } from '@prisma/client'

/**
 * A Postgres error reaches the API in two Prisma forms, measured on Prisma 6.19 against
 * real lock, statement, transaction and deadlock failures. A raw query raises a known
 * request error (P2010) with the SQLSTATE and message in meta. A model operation raises
 * an unknown request error whose message carries the engine's PostgresError rendering:
 * 55P03, 57014, 25P04 and 40P01 all arrive that way. Prisma maps only 40001, to P2034.
 */
export type PostgresError = { code: string; message: string }

const RENDERING =
  /QueryError\(PostgresError \{ code: "([0-9A-Z]{5})", message: "((?:[^"\\]|\\.)*)"/
// A raw message starts with its severity and continues with DETAIL and HINT lines; the
// rendering keeps those in their own fields, so both forms compare on the first line.
const SEVERITY = /^(?:ERROR|FATAL|PANIC): /

/** The SQLSTATE and primary message of a Postgres error in either Prisma form. */
export function postgresError(error: unknown): PostgresError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown; message?: unknown } | undefined
    if (typeof meta?.code !== 'string') return null
    const message = typeof meta.message === 'string' ? meta.message : ''
    return { code: meta.code, message: message.split('\n')[0]!.replace(SEVERITY, '') }
  }
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) return null
  const match = RENDERING.exec(error.message)
  if (!match) return null
  return { code: match[1]!, message: match[2]!.replace(/\\(["\\])/g, '$1') }
}
