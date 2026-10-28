// Story 6.5 owner: commit-serialized append counters and snapshot-bounded replay.
import { communityBuildIdentity } from './community-operational-telemetry.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { postgresError } from '../../prisma/postgres-error.js'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient, type LookbookPost } from '@prisma/client'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

type Subject = { member_id: string; generation: number; role: string }
type Candidate = {
  id: string
  stream_id: string
  kind: string
  revision: bigint
  post_id: string | null
  comment_id: string | null
  parent_id: string | null
}

function publicSourceUnavailable(source: LookbookPost | null, kind: string) {
  return (
    !source ||
    source.status !== 'published' ||
    source.erasure_requested_at ||
    source.anonymized_at ||
    source.user_id.startsWith('canary-user-') ||
    kind.endsWith('.removed')
  )
}
function subjectIdentity(subjects: Subject[]): string {
  return JSON.stringify(subjects)
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
          { timeout: 150, maxWait: 50 }
        )
      } catch {
        /* The sanitized process observation remains when the telemetry DB is unavailable. */
      }
      throw error
    }
  }

  private async appendBatch(signal?: AbortSignal): Promise<AppendReport> {
    return interactiveTransaction(
      this.prisma,
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '500ms'")
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '450ms'")
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
        const started = performance.now()
        const candidates = await tx.communityDomainOutbox.findMany({
          where: { appended_at: null },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          take: 100,
        })
        const ready: Candidate[] = []
        const limit = this.readyLimit
        let busy = 0
        let stop: AppendStop = 'drained'
        for (const candidate of candidates) {
          signal?.throwIfAborted()
          // Reserve the remaining server budget for head allocation, events and commit.
          if (performance.now() - started >= 150) {
            stop = 'window'
            break
          }
          if (ready.length >= limit) {
            stop = 'limit'
            break
          }
          const row = await this.prepareCandidate(tx, candidate)
          if (row) ready.push(row)
          else busy++
        }
        const preparedMs = performance.now() - started
        const report = { stop, ready: ready.length, limit, preparedMs }
        signal?.throwIfAborted()
        if (busy)
          await tx.communityEngagementTelemetry.create({
            data: {
              event_type: 'community_append_contention',
              outcome: 'skipped',
              reason: 'busy_or_changed_candidate',
              backlog_count: busy,
              elapsed_ms: Math.ceil(performance.now() - started),
              build_identity: communityBuildIdentity(),
            },
          })

        const streams = [...new Set(ready.map((row) => row.stream_id))].sort()
        for (const stream of streams) {
          // A busy head aborts this bounded batch; its holder supplies progress.
          await tx.$queryRaw`SELECT id FROM "CommunityStreamHead" WHERE id = ${stream} FOR UPDATE NOWAIT`
        }
        const remaining = 400 - (performance.now() - started)
        if (ready.length && remaining < 30)
          throw new AppendBudgetExceeded('Community append completion budget exhausted')
        const writeCostMs = this.writeCostMs
        const fit = Math.max(1, Math.floor(remaining / writeCostMs))
        const trimmed = fit < ready.length
        const selected = trimmed ? ready.slice(0, fit) : ready
        const written = {
          selected: selected.length,
          selectedReason: trimmed ? ('budget' as const) : ('all' as const),
          remainingMs: remaining,
          writeCostMs,
        }
        if (!selected.length) return { ...report, ...written, count: 0 }
        signal?.throwIfAborted()
        const writeStarted = performance.now()
        await this.writeBatch(tx, selected)
        this.writeCostMs = Math.max(
          1,
          (this.writeCostMs + (performance.now() - writeStarted) / selected.length) / 2
        )
        // An abort that lands during the write still rolls the batch back here.
        signal?.throwIfAborted()
        return { ...report, ...written, count: selected.length }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 750,
        maxWait: 100,
      }
    )
  }

  private async writeBatch(tx: Prisma.TransactionClient, rows: Candidate[]) {
    const values = rows.map(
      (
        row,
        index
      ) => Prisma.sql`(${row.id}::uuid,${row.stream_id}::text,${row.kind}::text,
      ${row.revision}::bigint,${row.post_id}::text,${row.comment_id}::text,${row.parent_id}::text,${index}::int)`
    )
    await tx.$executeRaw(Prisma.sql`
      WITH input(id,stream_id,kind,revision,post_id,comment_id,parent_id,ordinal) AS (VALUES ${Prisma.join(values)}),
      counts AS (SELECT stream_id,count(*) AS total FROM input GROUP BY stream_id),
      heads AS (UPDATE "CommunityStreamHead" h SET sequence = h.sequence+c.total FROM counts c
        WHERE h.id = c.stream_id RETURNING h.id,h.sequence-c.total AS base),
      numbered AS (SELECT i.*,row_number() OVER (PARTITION BY stream_id ORDER BY ordinal) AS offset FROM input i),
      events AS (INSERT INTO "CommunityStreamEvent" (id,source_outbox_id,stream_id,sequence,revision,kind,post_id,comment_id,parent_id)
        SELECT gen_random_uuid(),i.id,i.stream_id,h.base+i.offset,i.revision,i.kind,i.post_id,i.comment_id,i.parent_id
        FROM numbered i JOIN heads h ON h.id=i.stream_id RETURNING id,source_outbox_id,kind),
      links AS (INSERT INTO "CommunityArtifactSubject" (artifact_kind,artifact_id,member_id,role,generation)
        SELECT 'event',e.id::text,a.member_id,a.role,a.generation FROM events e JOIN "CommunityArtifactSubject" a
          ON a.artifact_kind='outbox' AND a.artifact_id=e.source_outbox_id::text WHERE e.kind <> 'resync')
      UPDATE "CommunityDomainOutbox" o SET appended_at=clock_timestamp() FROM events e WHERE o.id=e.source_outbox_id
    `)
  }

  private async prepareCandidate(
    tx: Prisma.TransactionClient,
    candidate: Candidate
  ): Promise<Candidate | null> {
    await tx.$executeRawUnsafe('SAVEPOINT community_candidate')
    const subjects = await this.subjects(tx, candidate.id)
    const posts = candidate.post_id ? [candidate.post_id] : []
    if (!(await this.tryGuards(tx, subjects, posts))) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT community_candidate')
      return null
    }
    const owned = await tx.$queryRaw<Candidate[]>`
            SELECT * FROM "CommunityDomainOutbox" WHERE id = ${candidate.id}::uuid
              AND appended_at IS NULL FOR UPDATE SKIP LOCKED
          `
    if (
      !owned[0] ||
      subjectIdentity(subjects) !== subjectIdentity(await this.subjects(tx, candidate.id))
    ) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT community_candidate')
      return null
    }
    const current = await tx.$queryRaw<{ valid: boolean }[]>`
            SELECT NOT EXISTS (
              SELECT 1 FROM "CommunityArtifactSubject" a
              LEFT JOIN "CommunitySubject" s ON s.member_id = a.member_id
              WHERE a.artifact_kind = 'outbox' AND a.artifact_id = ${candidate.id}
                AND (s.member_id IS NULL OR s.generation <> a.generation)
            ) AS valid
          `
    const row = owned[0]
    if (!current[0]?.valid && row.stream_id !== 'public') {
      await tx.communityDomainOutbox.delete({ where: { id: row.id } })
      await this.deleteLinks(tx, row.id)
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT community_candidate')
      return null
    }
    const source = row.post_id
      ? await tx.lookbookPost.findUnique({ where: { id: row.post_id } })
      : null
    let prepared = row
    if (
      row.stream_id === 'public' &&
      (!current[0]?.valid || publicSourceUnavailable(source, row.kind))
    ) {
      prepared = {
        ...row,
        kind: 'resync',
        post_id: null,
        comment_id: null,
        parent_id: null,
      }
    }
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT community_candidate')
    return prepared
  }

  private subjects(tx: Prisma.TransactionClient, id: string): Promise<Subject[]> {
    return tx.communityArtifactSubject.findMany({
      where: { artifact_kind: 'outbox', artifact_id: id },
      select: { member_id: true, generation: true, role: true },
      orderBy: [{ member_id: 'asc' }, { role: 'asc' }],
    })
  }

  private async tryGuards(
    tx: Prisma.TransactionClient,
    subjects: Subject[],
    posts: string[]
  ): Promise<boolean> {
    for (const [namespace, ids] of [
      [65001, subjects.map((s) => s.member_id)],
      [65002, posts],
    ] as const) {
      if (!ids.length) continue
      const keys = await tx.$queryRaw<{ key: number }[]>(Prisma.sql`
        SELECT DISTINCT hashtext(value) AS key FROM unnest(ARRAY[${Prisma.join(ids)}]::text[]) value ORDER BY key
      `)
      for (const { key } of keys) {
        const result = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock_shared(${namespace}::int,${key}::int) AS acquired
        `
        if (!result[0]?.acquired) return false
      }
    }
    return true
  }

  private async deleteLinks(tx: Prisma.TransactionClient, id: string) {
    await tx.communityArtifactSubject.deleteMany({
      where: { artifact_kind: 'outbox', artifact_id: id },
    })
  }

  async retain(): Promise<number> {
    return interactiveTransaction(this.prisma, async (tx) => {
      const expired = await tx.communityStreamEvent.findMany({
        where: { appended_at: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
        orderBy: [{ stream_id: 'asc' }, { sequence: 'asc' }],
        take: 500,
      })
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
