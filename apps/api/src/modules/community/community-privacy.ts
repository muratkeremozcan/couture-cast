// Story 6.5 owner: privacy locks precede every existing engagement lock.
import { Prisma, type PrismaClient } from '@prisma/client'
import { ForbiddenException } from '@nestjs/common'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { postgresError } from '../../prisma/postgres-error.js'

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
 * Erasure and the community maintenance transactions. interactiveTransaction already
 * retries the pldbgapi2 stack error; this loop adds the serialization, deadlock and
 * lock-timeout causes, which also roll the whole transaction back first.
 */
export async function communityPrivacyTransaction<T>(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await interactiveTransaction(prisma, work, {
        isolationLevel: 'ReadCommitted',
        timeout: 7000,
        maxWait: 1000,
      })
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : ''
      // A model operation raises 40P01 and 55P03 as unknown request errors; Prisma maps
      // only 40001, to P2034. postgresError reads the state from either form.
      const sql = postgresError(error)?.code ?? ''
      // Three attempts in all, retried at once.
      if (attempt < 2 && (code === 'P2034' || ['40001', '40P01', '55P03'].includes(sql)))
        continue
      throw error
    }
  }
}
