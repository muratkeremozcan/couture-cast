// Story 6.13 owner: what account erasure removes from moderation records, in `apps/api/src/modules/community/community-erasure.ts`.
// The request transaction and the sweep's repair pass both run this, so they cannot disagree about what identity is.
import { Prisma, type PrismaClient } from '@prisma/client'
import { MODERATION_ERASED_REASON } from '@couture/api-client/contracts/http'
import { COMMUNITY_SNAPSHOT_METADATA_KEYS } from './community-audit-snapshot.js'

type Tx = Prisma.TransactionClient

/** Every moderation decision takes this lock ahead of every privacy lock, so erasure has to as well. */
export async function lockModerationCase(tx: Tx, caseKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('moderation_case:' || ${caseKey}))`
}

/** The cases a member reported, in the one order two erasures sharing a case can both take. */
export async function reportedCaseKeys(tx: Tx, member: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ key: string }[]>`
    SELECT keys.key FROM (
      SELECT CASE WHEN post_id IS NULL THEN 'orphan-post.' || id ELSE 'post.' || post_id END AS key
      FROM "CommunityPostReport" WHERE reporter_id = ${member}
      UNION
      SELECT CASE WHEN comment_id IS NULL THEN 'orphan-comment.' || id ELSE 'comment.' || comment_id END
      FROM "CommunityCommentReport" WHERE reporter_id = ${member}
    ) AS keys
    ORDER BY keys.key COLLATE "C"`
  return rows.map((row) => row.key)
}

/** A decision takes no lock on a reporter, so this is what serializes one with that reporter's erasure. */
export async function lockReportedCases(tx: Tx, member: string): Promise<string[]> {
  const keys = await reportedCaseKeys(tx, member)
  for (const key of keys) await lockModerationCase(tx, key)
  return keys
}

/** The privacy transaction retries this state, so a report filed during the lock phase starts it over. */
export async function assertReportedCasesUnchanged(
  tx: Tx,
  member: string,
  locked: readonly string[]
): Promise<void> {
  const keys = await reportedCaseKeys(tx, member)
  if (keys.length === locked.length && keys.every((key, at) => key === locked[at])) return
  await tx.$executeRawUnsafe(
    "DO $$ BEGIN RAISE EXCEPTION 'erasure case set changed' USING ERRCODE = '40001'; END $$"
  )
}

const snapshotKeys = Prisma.sql`ARRAY[${Prisma.join([...COMMUNITY_SNAPSHOT_METADATA_KEYS])}]::text[]`

/** Leaves the metadata keys. A rerun matches no row, so the repair pass writes nothing when nothing is left. */
const stripSnapshots = (table: 'CommunityPostReport' | 'ModerationEvent') => {
  const name = Prisma.raw(`"${table}"`)
  return (member: string, alias: string | null) => Prisma.sql`
    UPDATE ${name} AS t
    SET content_snapshot = (
      SELECT coalesce(jsonb_object_agg(kept.key, kept.value), '{}'::jsonb)
      FROM jsonb_each(t.content_snapshot) AS kept
      WHERE kept.key = ANY(${snapshotKeys})
    )
    WHERE jsonb_typeof(t.content_snapshot) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_object_keys(t.content_snapshot) AS present(key)
        WHERE present.key <> ALL(${snapshotKeys})
      )
      AND (
        t.post_id IN (SELECT id FROM "LookbookPost" WHERE user_id = ${member})
        OR (${alias}::text IS NOT NULL AND t.subject_alias = ${alias}::text)
      )`
}
const stripReportSnapshots = stripSnapshots('CommunityPostReport')
const stripEventSnapshots = stripSnapshots('ModerationEvent')

/** One decision whose words the function is about to redact, with where those words were copied. */
interface RedactedDecision {
  reason: string
  post_id: string | null
  report_ids: string[]
  subject_alias: string | null
}

/**
 * A decision's reason is also written to its prior-action row and, for a takedown, to the post, so
 * redacting only the decision would leave the same words in three other tables. This reads the words the
 * function is about to redact, with the same rule it uses, so the copies can be matched exactly. A
 * moderator's own erasure is not in this rule: it keeps the words, which are about someone else.
 */
async function decisionsToRedact(
  tx: Tx,
  member: string,
  alias: string | null
): Promise<RedactedDecision[]> {
  const [postReports, commentReports] = await Promise.all([
    tx.communityPostReport.findMany({
      where: { reporter_id: member },
      select: { id: true },
    }),
    tx.communityCommentReport.findMany({
      where: { reporter_id: member },
      select: { id: true },
    }),
  ])
  const reported = [...postReports, ...commentReports].map(({ id }) => id)
  return tx.moderationDecision.findMany({
    where: {
      reason: { not: MODERATION_ERASED_REASON },
      OR: [
        { subject_user_id: member },
        ...(alias ? [{ subject_alias: alias }] : []),
        ...(reported.length > 0 ? [{ report_ids: { hasSome: reported } }] : []),
      ],
    },
    select: { reason: true, post_id: true, report_ids: true, subject_alias: true },
  })
}

/**
 * Each copy is matched on the words and on the decision's own target, because moderators reuse wording
 * and audit evidence must not be destroyed by a coincidence of text. An orphan's events lost `post_id`,
 * so only a decision that lost it too looks there, and its alias stands in for the post.
 */
async function redactOperatorReasonCopies(
  tx: Tx,
  decisions: readonly RedactedDecision[]
): Promise<void> {
  const onPosts = decisions.flatMap(({ reason, post_id }) =>
    post_id ? [{ reason, post_id }] : []
  )
  const onOrphans = decisions.flatMap(({ reason, post_id, subject_alias }) =>
    !post_id && subject_alias ? [{ reason, post_id: null, subject_alias }] : []
  )
  const onEvents = [...onPosts, ...onOrphans]
  if (onEvents.length > 0)
    await tx.moderationEvent.updateMany({
      where: { OR: onEvents },
      data: { reason: MODERATION_ERASED_REASON },
    })
  const onAudits = decisions.flatMap(({ reason, report_ids }) =>
    report_ids.length > 0 ? [{ reason, report_id: { in: report_ids } }] : []
  )
  if (onAudits.length > 0)
    await tx.communityCommentAudit.updateMany({
      where: { OR: onAudits },
      data: { reason: MODERATION_ERASED_REASON },
    })
  if (onPosts.length > 0)
    await tx.lookbookPost.updateMany({
      where: {
        OR: onPosts.map(({ reason, post_id }) => ({
          id: post_id,
          moderation_reason: reason,
        })),
      },
      data: { moderation_reason: null },
    })
}

/**
 * D4, under the member's privacy guard and ahead of `eraseCommunityComments`, because the function reads
 * the reporter ids that call clears. A third party's `details` on the member's post stays: they wrote it.
 */
export async function removeMemberFromModerationRecords(
  tx: Tx,
  member: string
): Promise<void> {
  const alias =
    (
      await tx.communityAlias.findUnique({
        where: { user_id: member },
        select: { alias: true },
      })
    )?.alias ?? null
  const redacted = await decisionsToRedact(tx, member, alias)
  await tx.$executeRaw`SELECT private.moderation_history_anonymize(${member})`
  await redactOperatorReasonCopies(tx, redacted)
  await tx.communityPostReport.updateMany({
    where: { reporter_id: member },
    data: { reporter_id: null, details: null },
  })
  await tx.$executeRaw(stripReportSnapshots(member, alias))
  await tx.$executeRaw(stripEventSnapshots(member, alias))
  await tx.moderationEvent.updateMany({
    where: { flagged_by_id: member },
    data: { flagged_by_id: null },
  })
  await tx.moderationEvent.updateMany({
    where: { reviewed_by_id: member },
    data: { reviewed_by_id: null },
  })
  await tx.moderationErasureRequest.updateMany({
    where: { requested_by: member },
    data: { requested_by: null },
  })
  await tx.communitySanction.deleteMany({ where: { user_id: member } })
  await tx.communityAlias.deleteMany({ where: { user_id: member } })
}

/** An unlocked read, so a sweep with nothing to repair takes no guard for a member it has already finished. */
/**
 * The sanction locks, always in id order. A decision or appeal holds its operator's lock shared while it
 * writes, and erasure holds the member's exclusively, so once a request row commits every writer naming
 * that member either finished first, and erasure sees its row, or starts later and sees the request.
 */
export async function lockCommunitySanctions(
  tx: Prisma.TransactionClient,
  shared: string | null,
  exclusive: string | null
): Promise<void> {
  const ids = [
    ...new Set([shared, exclusive].flatMap((id) => (id === null ? [] : [id]))),
  ].sort()
  for (const id of ids) {
    if (id === exclusive)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_sanction:' || ${id}))`
    else
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('community_sanction:' || ${id}))`
  }
}

export async function memberIdentityRemains(
  prisma: PrismaClient,
  member: string
): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ remains: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM "ModerationDecision" WHERE subject_user_id = ${member} OR moderator_id = ${member})
      OR EXISTS (SELECT 1 FROM "CommunityPostReport" WHERE reporter_id = ${member})
      OR EXISTS (SELECT 1 FROM "CommunityCommentReport" WHERE reporter_id = ${member} OR comment_author_id = ${member})
      OR EXISTS (SELECT 1 FROM "CommunityComment" WHERE user_id = ${member})
      OR EXISTS (SELECT 1 FROM "ModerationEvent" WHERE flagged_by_id = ${member} OR reviewed_by_id = ${member})
      OR EXISTS (SELECT 1 FROM "CommunitySanction" WHERE user_id = ${member})
      OR EXISTS (SELECT 1 FROM "CommunityAlias" WHERE user_id = ${member})
      OR EXISTS (SELECT 1 FROM "ModerationErasureRequest" WHERE requested_by = ${member})
      AS remains`
  return row?.remains === true
}
