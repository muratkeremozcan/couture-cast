// Story 6.11 owner: returning content a temporary ban held to screening in `apps/api/src/modules/community/community-ban-holds.ts`.
// A hold never publishes anything by ending: the row goes back through the same screening it was waiting for.
import { COMMUNITY_BAN_MARKER_PREFIX } from '@couture/api-client/contracts/http'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export const communityBanMarkerOf = (sanctionId: string) =>
  `${COMMUNITY_BAN_MARKER_PREFIX}${sanctionId}`

/**
 * Moves the rows these bans hold back to screening and re-arms their outboxes. Only a row still in
 * its held status with one of these markers moves, so a withdrawn, erased or moderator-taken-down
 * row stays as it is. `updated_at` is fresh, or the stale review sweep would fail the post at once.
 */
export async function returnBanHoldsToScreening(
  tx: Tx,
  subjectId: string,
  sanctionIds: readonly string[],
  now: Date
): Promise<{ posts: number; comments: number }> {
  const markers = sanctionIds.map(communityBanMarkerOf)
  const posts = await tx.lookbookPost.findMany({
    where: {
      user_id: subjectId,
      status: 'flagged',
      moderation_reason: { in: markers },
      erasure_requested_at: null,
      anonymized_at: null,
    },
    select: { id: true },
  })
  const postIds = posts.map((post) => post.id)
  if (postIds.length > 0) {
    await tx.lookbookPost.updateMany({
      where: { id: { in: postIds } },
      data: { status: 'pending_review', moderation_reason: null, updated_at: now },
    })
    for (const postId of postIds)
      await tx.communityModerationOutbox.upsert({
        where: { post_id: postId },
        create: { post_id: postId, generation: 1 },
        update: { generation: { increment: 1 }, dispatched_at: null, last_error: null },
      })
  }

  const comments = await tx.communityComment.findMany({
    where: {
      user_id: subjectId,
      status: 'held_for_review',
      screening_reason: { in: markers },
    },
    select: { id: true },
  })
  const commentIds = comments.map((comment) => comment.id)
  if (commentIds.length > 0) {
    await tx.communityComment.updateMany({
      where: { id: { in: commentIds } },
      data: { status: 'pending_screening', screening_reason: null, updated_at: now },
    })
    for (const commentId of commentIds)
      await tx.communityCommentScreeningOutbox.upsert({
        where: { comment_id: commentId },
        create: { comment_id: commentId, generation: 1 },
        update: { generation: { increment: 1 }, dispatched_at: null },
      })
  }
  return { posts: postIds.length, comments: commentIds.length }
}
