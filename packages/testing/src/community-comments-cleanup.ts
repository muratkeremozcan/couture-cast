// Story 6.4 owner: scoped synthetic thread cleanup retains content-free moderation history.
import { Prisma } from '@prisma/client'

/** Run inside the fixture owner's transaction. Other members' replies retain their root. */
export async function cleanupCommunityCommentFixtures(
  tx: Prisma.TransactionClient,
  commentIds: string[]
): Promise<void> {
  if (commentIds.length === 0) return
  const referencedRoots = await tx.communityComment.findMany({
    where: { parent_id: { in: commentIds }, id: { notIn: commentIds } },
    select: { parent_id: true },
  })
  const retained = new Set(referencedRoots.map((row) => row.parent_id))
  await tx.communityCommentReport.updateMany({
    where: { comment_id: { in: commentIds } },
    data: { content_snapshot: Prisma.DbNull },
  })
  await tx.communityComment.updateMany({
    where: { id: { in: commentIds.filter((id) => retained.has(id)) } },
    data: {
      body: null,
      user_id: null,
      status: 'erased',
      screening_reason: null,
      screening_version: null,
    },
  })
  // A single statement removes owned roots and replies under the NO ACTION self reference.
  await tx.communityComment.deleteMany({
    where: { id: { in: commentIds.filter((id) => !retained.has(id)) } },
  })
}
