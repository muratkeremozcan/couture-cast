// Story 6.5 owner: privacy locks precede every existing engagement lock.
import { Prisma, type PrismaClient } from '@prisma/client'
import { ForbiddenException } from '@nestjs/common'

export async function assertCommunitySubjectAvailable(
  tx: Pick<Prisma.TransactionClient, 'communitySubject'>,
  member: string
): Promise<void> {
  if (
    !(await tx.communitySubject.findUnique({
      where: { member_id: member },
      select: { member_id: true },
    }))
  )
    throw new ForbiddenException({
      statusCode: 403,
      code: 'denied',
      message: 'Community account unavailable.',
    })
}

export async function guardCommunitySubject(
  tx: Prisma.TransactionClient,
  member: string
) {
  await tx.$executeRaw`SELECT community_prepare_subject_privacy(${member})`
}
export async function guardCommunityPost(tx: Prisma.TransactionClient, post: string) {
  await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[]::text[],ARRAY[${post}]::text[],true)`
}
export async function forgetCommunitySubject(
  tx: Prisma.TransactionClient,
  member: string,
  erase: boolean
) {
  await tx.$executeRaw`SELECT community_forget_subject(${member},${erase})`
  // Story 6.6: account erasure also drops the member's spotlight read window,
  // in the same transaction as the rest of the subject.
  if (erase)
    await tx.communitySpotlightReadWindow.deleteMany({ where: { user_id: member } })
}
/**
 * The Supabase Postgres image preloads plpgsql_check, whose pldbgapi2 layer hooks every
 * PL/pgSQL call and can abort an ordinary nested call with this internal error
 * (okbob/plpgsql_check#197). It aborts and rolls back the whole transaction, so a
 * transaction that is safe to repeat after a serialization failure is safe to repeat
 * after this. Only this exact signature matches: SQLSTATE XX000 plus the message.
 */
export const PLDBGAPI2_STACK_ERROR =
  'cannot find parent statement on pldbgapi2 call stack'
export function isPldbgapi2StackError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  const meta = error.meta as { code?: unknown; message?: unknown } | undefined
  if (meta?.code !== 'XX000') return false
  const message = typeof meta.message === 'string' ? meta.message : error.message
  return message.includes(PLDBGAPI2_STACK_ERROR)
}

export async function communityPrivacyTransaction<T>(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: 'ReadCommitted',
        timeout: 7000,
        maxWait: 1000,
      })
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : ''
      const sql =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? String(error.meta?.code)
          : ''
      // Three attempts in all, retried at once: every retryable cause rolled back the
      // whole transaction first.
      if (
        attempt < 2 &&
        (code === 'P2034' ||
          ['40001', '40P01', '55P03'].includes(sql) ||
          isPldbgapi2StackError(error))
      )
        continue
      throw error
    }
  }
}
