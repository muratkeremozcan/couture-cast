// Story 6.4 owner: scoped synthetic thread cleanup retains content-free moderation history.
import { Prisma } from '@prisma/client'

/** Run inside the fixture owner's transaction. Other members' replies retain their root. */
export async function cleanupCommunityCommentFixtures(
  tx: Prisma.TransactionClient,
  commentIds: string[]
): Promise<void> {
  if (commentIds.length === 0) return
  // Erasing or deleting a comment is a privacy write: hold its post's guard, as product
  // deletion does, so the cleanup also runs where `privacy_version` is 1.
  const posts = await tx.communityComment.findMany({
    where: { id: { in: commentIds } },
    select: { post_id: true },
    distinct: ['post_id'],
  })
  await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[]::text[], ${posts.map((row) => row.post_id)}::text[], true)`
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
