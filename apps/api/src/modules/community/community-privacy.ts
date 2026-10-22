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
      if (attempt < 2 && (code === 'P2034' || ['40001', '40P01', '55P03'].includes(sql)))
        continue
      throw error
    }
  }
}
