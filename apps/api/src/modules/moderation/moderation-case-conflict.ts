// Story 6.13 owner: the conflict rule over everything a case's evidence reaches.
import type { Prisma } from '@prisma/client'

type ConflictReader = Pick<
  Prisma.TransactionClient,
  'moderationDecision' | 'communityPostReport' | 'communityCommentReport'
>

/**
 * Whether the viewer filed a report or wrote the words this case's evidence reaches, or is named as the
 * subject of one of its decisions.
 * Erasing a post's author gives each of its reports its own orphan case, and only the decision rows still
 * tie them together, so a case's own reports are not enough to answer this.
 * Decisions link reports transitively, which is why this reads until the set stops growing.
 */
export async function viewerConflictsWithEvidence(
  db: ConflictReader,
  viewerId: string,
  caseKey: string,
  reportIds: readonly string[]
): Promise<boolean> {
  const reports = new Set(reportIds)
  const cases = new Set([caseKey])
  for (let size = -1; size !== reports.size + cases.size; ) {
    size = reports.size + cases.size
    const decisions = await db.moderationDecision.findMany({
      where: {
        OR: [{ case_key: { in: [...cases] } }, { report_ids: { hasSome: [...reports] } }],
      },
      select: { case_key: true, report_ids: true, subject_user_id: true },
    })
    for (const row of decisions) {
      if (row.subject_user_id === viewerId) return true
      cases.add(row.case_key)
      for (const id of row.report_ids) reports.add(id)
    }
  }
  const ids = [...reports]
  if (ids.length === 0) return false
  const [post, comment] = await Promise.all([
    db.communityPostReport.count({ where: { id: { in: ids }, reporter_id: viewerId } }),
    db.communityCommentReport.count({
      where: {
        id: { in: ids },
        OR: [{ reporter_id: viewerId }, { comment_author_id: viewerId }],
      },
    }),
  ])
  return post + comment > 0
}
