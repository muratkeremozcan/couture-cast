// Moved out of `community-moderation.actions.ts` in Story 6.13, so the community repository can write a
// record without importing the service that imports it.
import { Prisma } from '@prisma/client'
import { postgresError } from '../../prisma/postgres-error.js'

/** A moderation record could not be written, so the decision cannot be attributed. */
export class ModerationRecordWriteError extends Error {
  constructor(cause: unknown) {
    super('A moderation record could not be written.', { cause })
    this.name = 'ModerationRecordWriteError'
  }
}

/**
 * Writes one attributed record. A failure rolls the transaction back and reads as one closed
 * error, except a unique violation and a retryable lock failure, which their callers handle.
 */
export async function writeModerationRecord<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    const prisma = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : ''
    const sql = postgresError(error)?.code ?? ''
    if (['P2002', 'P2034'].includes(prisma) || ['40001', '40P01', '55P03'].includes(sql))
      throw error
    throw new ModerationRecordWriteError(error)
  }
}
