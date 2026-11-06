// Story 6.13 owner: the conflict rule over everything a case's evidence reaches.
import type { Prisma } from '@prisma/client'

type ConflictReader = Pick<
  Prisma.TransactionClient,
  'moderationDecision' | 'communityPostReport' | 'communityCommentReport'
>

export interface EvidenceClosure {
  reports: Set<string>
  cases: Set<string>
  subjects: Set<string>
}

const originsOf = (cases: ReadonlySet<string>, prefix: string): string[] =>
  [...cases].flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))

/**
 * Grows a set of reports and case keys until a pass adds nothing, so the rows it can reach bound it.
 * Erasing a post's author gives each of its reports its own orphan case. Two things still tie them together:
 * decision rows, and each report's origin id, which outlives the target and joins the case keys a decision
 * keeps. Post and comment origins stay apart, because a post's reporter has no conflict on its comments.
 */
export async function closeOverEvidence(
  db: ConflictReader,
  seed: { reports: Iterable<string>; cases: Iterable<string> }
): Promise<EvidenceClosure> {
  const closure: EvidenceClosure = {
    reports: new Set(seed.reports),
    cases: new Set(seed.cases),
    subjects: new Set(),
  }
  const { reports, cases, subjects } = closure
  for (let size = -1; size !== reports.size + cases.size; ) {
    size = reports.size + cases.size
    const ids = [...reports]
    const [decisions, postReports, commentReports] = await Promise.all([
      db.moderationDecision.findMany({
        where: {
          OR: [{ case_key: { in: [...cases] } }, { report_ids: { hasSome: ids } }],
        },
        select: { case_key: true, report_ids: true, subject_user_id: true },
      }),
      db.communityPostReport.findMany({
        where: {
          OR: [
            { id: { in: ids } },
            { origin_post_id: { in: originsOf(cases, 'post.') } },
          ],
        },
        select: { id: true, origin_post_id: true },
      }),
      db.communityCommentReport.findMany({
        where: {
          OR: [
            { id: { in: ids } },
            { origin_comment_id: { in: originsOf(cases, 'comment.') } },
          ],
        },
        select: { id: true, origin_comment_id: true },
      }),
    ])
    for (const row of decisions) {
      cases.add(row.case_key)
      for (const id of row.report_ids) reports.add(id)
      if (row.subject_user_id) subjects.add(row.subject_user_id)
    }
    for (const row of postReports) {
      reports.add(row.id)
      if (row.origin_post_id) cases.add(`post.${row.origin_post_id}`)
    }
    for (const row of commentReports) {
      reports.add(row.id)
      if (row.origin_comment_id) cases.add(`comment.${row.origin_comment_id}`)
    }
  }
  return closure
}

/**
 * Whether the viewer filed a report or wrote the words this case's evidence reaches, or is named as the
 * subject of one of its decisions. A case's own reports are not enough to answer this: see the closure.
 */
export async function viewerConflictsWithEvidence(
  db: ConflictReader,
  viewerId: string,
  caseKey: string,
  reportIds: readonly string[]
): Promise<boolean> {
  const { reports, subjects } = await closeOverEvidence(db, {
    reports: reportIds,
    cases: [caseKey],
  })
  if (subjects.has(viewerId)) return true
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
