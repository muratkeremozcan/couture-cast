// Story 6.4 owner: one rolling abuse ledger for post and comment reports.
import type { Prisma } from '@prisma/client'

export async function sharedCommunityReportRetryAfter(
  tx: Prisma.TransactionClient,
  reporterId: string,
  limit: number,
  now = new Date()
): Promise<number | null> {
  const windowStart = new Date(now.getTime() - 86_400_000)
  const [posts, comments] = await Promise.all([
    tx.communityPostReport.findMany({
      where: { reporter_id: reporterId, created_at: { gt: windowStart } },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
      take: limit,
    }),
    tx.communityCommentReport.findMany({
      where: { reporter_id: reporterId, accepted_at: { gt: windowStart } },
      orderBy: { accepted_at: 'desc' },
      select: { accepted_at: true },
      take: limit,
    }),
  ])
  const dates = [
    ...posts.map((row) => row.created_at.getTime()),
    ...comments.map((row) => row.accepted_at.getTime()),
  ].sort((a, b) => b - a)
  if (dates.length < limit) return null
  // If historic data already exceeds the current cap, enough receipts must expire.
  const expiry = dates[limit - 1] ?? now.getTime()
  return Math.max(1, Math.ceil((expiry + 86_400_000 - now.getTime()) / 1000))
}
