import { Prisma } from '@prisma/client'
import { PLDBGAPI2_STACK_ERROR } from '../prisma/prisma-client.js'

/** The pldbgapi2 abort as a model operation reports it (captured from Prisma 6.19). */
export function pldbgapi2Abort(): Prisma.PrismaClientUnknownRequestError {
  return new Prisma.PrismaClientUnknownRequestError(
    `Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "XX000", message: "${PLDBGAPI2_STACK_ERROR}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion: 'test' }
  )
}

/**
 * A `$transaction` stand-in whose first run executes the callback and then aborts with
 * the pldbgapi2 error, as a rolled-back attempt would; later runs commit normally.
 */
export function abortFirstRun<C>(client: () => C) {
  let runs = 0
  return async (work: (tx: C) => Promise<unknown>) => {
    const result = await work(client())
    if (runs++ === 0) throw pldbgapi2Abort()
    return result
  }
}
