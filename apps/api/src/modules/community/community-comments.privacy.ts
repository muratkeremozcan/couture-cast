// Story 6.4 owner: immediate account-erasure cleanup within the authoritative transaction.
import { Prisma } from '@prisma/client'

export async function eraseCommunityComments(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const authored = await tx.communityComment.findMany({
    where: { user_id: userId },
    select: { id: true },
  })
  const ids = authored.map((row) => row.id)
  await tx.communityCommentReport.updateMany({
    where: { OR: [{ reporter_id: userId }, { comment_id: { in: ids } }] },
    data: { content_snapshot: Prisma.DbNull },
  })
  await tx.communityCommentReport.updateMany({
    where: { reporter_id: userId },
    data: { reporter_id: null },
  })
  await tx.communityCommentReceipt.deleteMany({ where: { user_id: userId } })
  await tx.communityCommentScreeningOutbox.deleteMany({
    where: { comment_id: { in: ids } },
  })
  await tx.communityCommentAnalyticsSubject.deleteMany({ where: { user_id: userId } })
  await tx.communityComment.updateMany({
    where: { user_id: userId },
    data: {
      body: null,
      user_id: null,
      status: 'erased',
      screening_reason: null,
      screening_version: null,
    },
  })
}
