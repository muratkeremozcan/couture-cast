// Story 6.5 owner: commit-serialized append counters and snapshot-bounded replay.
import { communityBuildIdentity } from './community-operational-telemetry.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { postgresError } from '../../prisma/postgres-error.js'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

/** What `community_append_batch` returns for one batch. */
type BatchResult = {
  budgetExhausted?: true
  count: number
  stop: AppendStop
  ready: number
  limit: number
  preparedMs: number
  selected: number
  selectedReason: 'all' | 'budget'
  remainingMs: number
  writeCostMs: number
  writeMs: number
}

export class AppendBudgetExceeded extends Error {}
// PostgreSQL 17 ends a transaction past either of its time budgets with a FATAL, each
// under its own SQLSTATE and fixed text (postgres.c ProcessInterrupts, REL_17_STABLE;
// reproduced on 17.6). Both are this transaction's budget running out. When either
// fires while the session is idle, Prisma 6.19 reports only P1017 with no SQLSTATE,
// which cannot be told from a lost connection and stays a dependency failure.
const TRANSACTION_BUDGET_FATAL: Readonly<Record<string, string>> = {
  '25P03': 'terminating connection due to idle-in-transaction timeout',
  '25P04': 'terminating connection due to transaction timeout',
}
/** A lock miss or one of the append's own SQL timeouts, in either Prisma error form. */
function sqlDeferral(error: unknown) {
  const sql = postgresError(error)
  if (!sql) return null
  if (sql.code === '55P03') return 'head_contention'
  if (sql.code === '57014') return 'budget_pressure'
  if (Object.hasOwn(TRANSACTION_BUDGET_FATAL, sql.code))
    return TRANSACTION_BUDGET_FATAL[sql.code] === sql.message ? 'budget_pressure' : null
  return null
}
export function appendFailure(error: unknown) {
  if (error instanceof AppendBudgetExceeded) return 'budget_pressure'
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028')
    return 'budget_pressure'
  return sqlDeferral(error) ?? 'dependency_unavailable'
}
/**
 * Why preparation stopped: the 150 ms window closed, the ready limit filled, or the
 * backlog ran out. Only the batch that drains the backlog stops for the last reason.
 */
export type AppendStop = 'window' | 'limit' | 'drained'
export type AppendReport = {
  count: number
  stop: AppendStop
  /** Candidates prepared, and the ready limit this batch ran under. */
  ready: number
  limit: number
  /** Preparation time when the loop stopped, the figure the window is measured on. */
  preparedMs: number
  /**
   * Ready rows written: all of them, or the rows that fit the remaining completion
   * budget at the measured per-row write cost when that budget trimmed the batch.
   */
  selected: number
  selectedReason: 'all' | 'budget'
  remainingMs: number
  writeCostMs: number
}
/** Head contention and budget pressure defer a batch; the append loop retries it. */
export function isAppendDeferral(error: unknown): boolean {
  return appendFailure(error) !== 'dependency_unavailable'
}

@Injectable()
export class CommunityStreamRepository {
  private readyLimit = 25
  private writeCostMs = 4
  private readonly logger = createBaseLogger().child({ feature: 'community-append' })
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async assist(): Promise<number> {
    // Claim commits before append; it never changes a stream sequence.
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "CommunityStreamHead" h SET last_assist_at = clock_timestamp()
      WHERE (last_assist_at IS NULL OR last_assist_at < clock_timestamp() - interval '1 second')
        AND EXISTS (SELECT 1 FROM "CommunityDomainOutbox" o
          WHERE o.stream_id = h.id AND o.appended_at IS NULL)
      RETURNING id
    `
    if (!claimed.length) return 0
    try {
      return await this.append()
    } catch (error) {
      if (sqlDeferral(error)) return 0
      throw error
    }
  }

  async append(): Promise<number> {
    return (await this.appendWithReport()).count
  }

  /**
   * Whether any outbox row waits for append, in one autocommitted statement.
   * The worker's append loop asks this first, so an idle tick costs one round trip where the
   * bounded append transaction costs six.
   */
  async hasPending(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ pending: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM "CommunityDomainOutbox" WHERE appended_at IS NULL) AS pending
    `
    return rows[0]?.pending === true
  }

  /**
   * Appends one batch and reports why its preparation stopped. An aborted signal stops
   * the append before its next write and rolls the batch back; an aborted append
   * records no retry either, so nothing is written after the abort.
   */
  async appendWithReport(signal?: AbortSignal): Promise<AppendReport> {
    try {
      const report = await this.appendBatch(signal)
      if (report.count) this.readyLimit = Math.min(25, this.readyLimit + 2)
      return report
    } catch (error) {
      if (signal?.aborted) throw error
      const reason = appendFailure(error)
      if (reason === 'budget_pressure')
        this.readyLimit = Math.max(1, Math.floor(this.readyLimit / 2))
      this.logger.warn(
        { reason, nextBatchLimit: this.readyLimit },
        'Community append deferred'
      )
      try {
        await interactiveTransaction(
          this.prisma,
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '100ms'")
            await tx.communityEngagementTelemetry.create({
              data: {
                event_type: 'community_append_retry',
                outcome: 'aborted',
                reason,
                backlog_count: this.readyLimit,
                build_identity: communityBuildIdentity(),
              },
            })
          },
          // Two statements: about 125 ms p50 and 190 ms p95 at production's 31 ms round trip
          // (2026-11-11). The old 150 ms budget dropped most retry rows there. A connection's
          // first insert also prepares its statement, and production's round trip reached
          // 220 ms at worst, so 400 ms still dropped the occasional cold row; CI dropped one
          // at load. 1 s holds a cold write at three times the round trip (6.5-INT-033), and
          // the server still bounds the insert at 100 ms. A 50 ms wait for a pool connection
          // dropped the row whenever another worker loop held it; 250 ms is the wait those
          // loops use (6.5-INT-036).
          { timeout: 1_000, maxWait: 250 }
        )
      } catch (telemetryError) {
        // The deferral warning above remains the observation; this one says the durable row
        // is missing, so a gap in community_append_retry is never silent.
        this.logger.warn(
          {
            reason,
            code:
              postgresError(telemetryError)?.code ??
              (telemetryError instanceof Prisma.PrismaClientKnownRequestError
                ? telemetryError.code
                : 'unknown'),
          },
          'Community append retry not recorded'
        )
      }
      throw error
    }
  }

  /**
   * One batch in one statement: `community_append_batch` prepares candidates and writes events
   * server-side (migration 20261111120000), so a batch costs four round trips whatever its size.
   * Preparing each candidate here took about 16, which at production's 31 ms round trip ran past
   * the 500 ms transaction budget for a single candidate. The settings bound the server work;
   * the 150 ms preparation window and 400 ms completion budget are measured inside the function.
   */
  private async appendBatch(signal?: AbortSignal): Promise<AppendReport> {
    return interactiveTransaction(
      this.prisma,
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('transaction_timeout', '500ms', true),
          set_config('statement_timeout', '450ms', true),
          set_config('lock_timeout', '100ms', true),
          set_config('community.build_identity', ${communityBuildIdentity()}, true)`
        signal?.throwIfAborted()
        const [row] = await tx.$queryRaw<{ batch: BatchResult }[]>`
          SELECT community_append_batch(${this.readyLimit}::integer, ${this.writeCostMs}::float8) AS batch
        `
        const batch = row!.batch
        // An abort that lands during the batch still rolls it back here.
        signal?.throwIfAborted()
        if (batch.budgetExhausted)
          throw new AppendBudgetExceeded('Community append completion budget exhausted')
        if (batch.selected)
          this.writeCostMs = Math.max(
            1,
            (this.writeCostMs + batch.writeMs / batch.selected) / 2
          )
        return {
          count: batch.count,
          stop: batch.stop,
          ready: batch.ready,
          limit: batch.limit,
          preparedMs: batch.preparedMs,
          selected: batch.selected,
          selectedReason: batch.selectedReason,
          remainingMs: batch.remainingMs,
          writeCostMs: batch.writeCostMs,
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 750,
        // The worker's three pool connections serve its other loops too, whose transactions wait
        // 250 ms for one. A 100 ms wait gave up while a sibling held the connection and reported
        // budget_pressure, halving the next batch for a busy pool (6.5-INT-035).
        maxWait: 250,
      }
    )
  }

  async retain(): Promise<number> {
    return interactiveTransaction(this.prisma, async (tx) => {
      const expired = await tx.communityStreamEvent.findMany({
        where: { appended_at: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
        orderBy: [{ stream_id: 'asc' }, { sequence: 'asc' }],
        take: 500,
      })
      if (!expired.length) return 0
      for (const stream of [...new Set(expired.map((e) => e.stream_id))].sort()) {
        const floor = expired.filter((e) => e.stream_id === stream).at(-1)!.sequence
        await tx.$queryRaw`SELECT id FROM "CommunityStreamHead" WHERE id = ${stream} FOR UPDATE`
        await tx.communityStreamHead.updateMany({
          where: { id: stream, retention_floor: { lt: floor } },
          data: { retention_floor: floor },
        })
      }
      const ids = expired.map((e) => e.id)
      await tx.communityArtifactSubject.deleteMany({
        where: { artifact_kind: 'event', artifact_id: { in: ids } },
      })
      return (await tx.communityStreamEvent.deleteMany({ where: { id: { in: ids } } }))
        .count
    })
  }
}
