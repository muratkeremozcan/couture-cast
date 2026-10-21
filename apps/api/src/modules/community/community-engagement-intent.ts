// Story 6.5 owner: first-occurrence qualification inside the source transaction.
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export async function recordCommunityEngagement(
  tx: Prisma.TransactionClient,
  source: {
    actor: string
    post: string
    comment?: string
  }
): Promise<void> {
  if (source.actor.startsWith('canary-user-')) return
  const post = await tx.lookbookPost.findUnique({ where: { id: source.post } })
  if (!post || post.user_id.startsWith('canary-user-')) return
  const comment = source.comment
    ? await tx.communityComment.findUnique({ where: { id: source.comment } })
    : null
  const parent = comment?.parent_id
    ? await tx.communityComment.findUnique({ where: { id: comment.parent_id } })
    : null
  const recipients = [
    ...new Set(
      [post.user_id, parent?.user_id].filter(
        (id): id is string => !!id && id !== source.actor
      )
    ),
  ].sort()
  for (const recipient of recipients) {
    const preference = await tx.communityNotificationPreference.findUnique({
      where: { user_id: recipient },
    })
    const intent = randomUUID()
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "CommunityNotificationIntent" (id,source_kind,post_id,comment_id,actor_id,recipient_id,
        preference_generation,deliverable,qualification_recorded_at,expires_at)
      VALUES (${intent}::uuid,${source.comment ? 'comment' : 'reaction'},${source.post},${source.comment ?? null},${source.actor},${recipient},
        ${preference?.generation ?? 0},${preference?.enabled ?? false},clock_timestamp(),clock_timestamp() + interval '24 hours')
      ON CONFLICT DO NOTHING RETURNING id
    `
    if (!inserted.length) continue
    for (const [role, member] of [
      ['actor', source.actor],
      ['recipient', recipient],
      ['post_author', post.user_id],
      ['parent_author', parent?.user_id],
    ] as const) {
      if (member)
        await tx.$executeRaw`SELECT community_link_subject('intent',${intent},${member},${role})`
    }
  }
}
