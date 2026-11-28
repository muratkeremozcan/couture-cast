import { Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

export const LOOK_IDEA_BUDGET = Symbol('LOOK_IDEA_BUDGET')
export const LOOK_IDEA_DEADLINE_MS = 5_000

const ACCOUNT_DAILY_LIMIT = 3
// $5 deployment cap with one cent reserved for every dispatch.
const DISPATCH_LIMIT = 500

export type LookIdeaBudgetOutcome =
  | 'allowed'
  | 'account_limit'
  | 'spend_limit'
  | 'unavailable'

export interface LookIdeaBudget {
  reserve(userId: string): Promise<LookIdeaBudgetOutcome>
}

@Injectable()
export class DatabaseLookIdeaBudget implements LookIdeaBudget {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async reserve(userId: string): Promise<LookIdeaBudgetOutcome> {
    const deadline = performance.now() + LOOK_IDEA_DEADLINE_MS
    try {
      return await interactiveTransaction(
        this.prisma,
        async (tx) => {
          // All reservations acquire the deployment row first. A failed account reservation
          // leaves the deployment count unchanged, and both successful counters commit together.
          const [budget] = await tx.$queryRaw<{ dispatch_count: number }[]>`
          SELECT "dispatch_count" FROM "LookIdeaBudget" WHERE "id" = 1 FOR UPDATE
        `
          if (!budget) return 'unavailable'
          if (budget.dispatch_count >= DISPATCH_LIMIT) return 'spend_limit'

          const daily = await tx.$executeRaw`
          INSERT INTO "LookIdeaDailyQuota" ("user_id", "utc_day", "dispatch_count")
          VALUES (${userId}, (clock_timestamp() AT TIME ZONE 'UTC')::date, 1)
          ON CONFLICT ("user_id") DO UPDATE SET
            "utc_day" = EXCLUDED."utc_day",
            "dispatch_count" = CASE
              WHEN "LookIdeaDailyQuota"."utc_day" < EXCLUDED."utc_day" THEN 1
              ELSE "LookIdeaDailyQuota"."dispatch_count" + 1
            END
          WHERE "LookIdeaDailyQuota"."utc_day" < EXCLUDED."utc_day"
             OR ("LookIdeaDailyQuota"."utc_day" = EXCLUDED."utc_day"
                 AND "LookIdeaDailyQuota"."dispatch_count" < ${ACCOUNT_DAILY_LIMIT})
        `
          if (!daily) return 'account_limit'

          await tx.lookIdeaBudget.update({
            where: { id: 1 },
            data: { dispatch_count: { increment: 1 } },
          })
          if (performance.now() >= deadline) throw new Error('Look ideas quota deadline')
          return 'allowed'
        },
        () => {
          const remaining = Math.floor(deadline - performance.now())
          if (remaining <= 1) throw new Error('Look ideas quota deadline')
          const maxWait = Math.min(1_000, Math.floor(remaining / 2))
          return { maxWait, timeout: remaining - maxWait }
        }
      )
    } catch {
      return 'unavailable'
    }
  }
}
