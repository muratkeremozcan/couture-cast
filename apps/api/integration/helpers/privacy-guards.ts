import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Fixture writes under the privacy guard.
 *
 * The integration tier runs at `privacy_version` 1 (./privacy-capability.ts), where a
 * write to a member's or a post's privacy state needs that subject's exclusive guard in
 * the same transaction. Product code takes it through `community_privacy_guards` and
 * `community_prepare_subject_privacy`; a fixture that arranges, cleans up or races such a
 * write takes the same guard here, so no suite needs the guard off.
 */
export type PrivacySubjects = {
  members?: readonly (string | null | undefined)[]
  posts?: readonly (string | null | undefined)[]
}

const ids = (values: readonly (string | null | undefined)[] = []) => [
  ...new Set(values.filter((value): value is string => typeof value === 'string')),
]

/** Takes the exclusive guards, members first and in hash order, as product code does. */
export async function takePrivacyGuards(
  tx: Prisma.TransactionClient,
  { members, posts }: PrivacySubjects
): Promise<void> {
  await tx.$executeRaw`SELECT community_privacy_guards(${ids(members)}::text[], ${ids(posts)}::text[], true)`
}

/** Runs `work` in one transaction that first holds the guards of `subjects`. */
export function withPrivacyGuards<T>(
  prisma: PrismaClient,
  subjects: PrivacySubjects,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await takePrivacyGuards(tx, subjects)
      return work(tx)
    },
    { maxWait: 10_000, timeout: 60_000 }
  )
}

/**
 * The subjects a delete of these members reaches through its cascades: the members,
 * the teens of their guardian consents, their posts and every post they commented on.
 */
export async function memberSubjects(
  tx: Prisma.TransactionClient | PrismaClient,
  memberIds: readonly string[]
): Promise<Required<PrivacySubjects>> {
  if (memberIds.length === 0) return { members: [], posts: [] }
  const list = [...memberIds]
  const [teens, posts] = await Promise.all([
    tx.$queryRaw<{ id: string }[]>`
      SELECT teen_id AS id FROM "GuardianConsent" WHERE guardian_id = ANY(${list}::text[])`,
    tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LookbookPost" WHERE user_id = ANY(${list}::text[])
      UNION SELECT post_id FROM "CommunityComment" WHERE user_id = ANY(${list}::text[])`,
  ])
  return {
    members: ids([...list, ...teens.map((row) => row.id)]),
    posts: ids(posts.map((row) => row.id)),
  }
}

/** Deletes the members matching `where` with every guard their cascades need. */
export async function deleteMembers(
  prisma: PrismaClient,
  where: Prisma.UserWhereInput
): Promise<void> {
  const memberIds = (await prisma.user.findMany({ where, select: { id: true } })).map(
    (row) => row.id
  )
  if (memberIds.length === 0) return
  await withPrivacyGuards(prisma, await memberSubjects(prisma, memberIds), (tx) =>
    tx.user.deleteMany({ where: { id: { in: memberIds } } })
  )
}

/** Deletes the posts matching `where` under their guards. */
export async function deletePosts(
  prisma: PrismaClient,
  where: Prisma.LookbookPostWhereInput
): Promise<void> {
  const postIds = (
    await prisma.lookbookPost.findMany({ where, select: { id: true } })
  ).map((row) => row.id)
  if (postIds.length === 0) return
  await withPrivacyGuards(prisma, { posts: postIds }, (tx) =>
    tx.lookbookPost.deleteMany({ where: { id: { in: postIds } } })
  )
}

/** Deletes the comments matching `where` under the guards of their posts. */
export async function deleteComments(
  prisma: PrismaClient,
  where: Prisma.CommunityCommentWhereInput = {}
): Promise<void> {
  const rows = await prisma.communityComment.findMany({
    where,
    select: { id: true, post_id: true },
  })
  if (rows.length === 0) return
  await withPrivacyGuards(prisma, { posts: rows.map((row) => row.post_id) }, (tx) =>
    tx.communityComment.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
  )
}

/** Deletes the guardian consents matching `where` under the guards of their teens. */
export async function deleteGuardianConsents(
  prisma: PrismaClient,
  where: Prisma.GuardianConsentWhereInput
): Promise<void> {
  const rows = await prisma.guardianConsent.findMany({
    where,
    select: { id: true, teen_id: true },
  })
  if (rows.length === 0) return
  await withPrivacyGuards(prisma, { members: rows.map((row) => row.teen_id) }, (tx) =>
    tx.guardianConsent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })
  )
}

/** Updates one post under its guard, as a product status or erasure change does. */
export function updatePost(
  prisma: PrismaClient,
  id: string,
  data: Prisma.LookbookPostUpdateInput
) {
  return withPrivacyGuards(prisma, { posts: [id] }, (tx) =>
    tx.lookbookPost.update({ where: { id }, data })
  )
}

/** Updates one guardian consent under its teen's guard, as revocation does. */
export async function updateGuardianConsent(
  prisma: PrismaClient,
  where: Prisma.GuardianConsentWhereUniqueInput,
  data: Prisma.GuardianConsentUpdateInput
) {
  const { teen_id } = await prisma.guardianConsent.findUniqueOrThrow({
    where,
    select: { teen_id: true },
  })
  return withPrivacyGuards(prisma, { members: [teen_id] }, (tx) =>
    tx.guardianConsent.update({ where, data })
  )
}
