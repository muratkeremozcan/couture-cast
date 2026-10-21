// Story 6.5 owner: commit-serialized append counters and snapshot-bounded replay.
import { communityBuildIdentity } from './community-operational-telemetry.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient, type LookbookPost } from '@prisma/client'

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

class AppendBudgetExceeded extends Error {}
function appendFailure(error: unknown) {
  if (error instanceof AppendBudgetExceeded) return 'budget_pressure'
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const sql = String(error.meta?.code)
    if (sql === '55P03') return 'head_contention'
    if (['57014', '25P04'].includes(sql) || error.code === 'P2028')
      return 'budget_pressure'
  }
  return 'dependency_unavailable'
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['55P03', '57014', '25P04'].includes(String(error.meta?.code))
      )
        return 0
      throw error
    }
  }

  async append(): Promise<number> {
    try {
      const count = await this.appendBatch()
      if (count) this.readyLimit = Math.min(25, this.readyLimit + 2)
      return count
    } catch (error) {
      const reason = appendFailure(error)
      if (reason === 'budget_pressure')
        this.readyLimit = Math.max(1, Math.floor(this.readyLimit / 2))
      this.logger.warn(
        { reason, nextBatchLimit: this.readyLimit },
        'Community append deferred'
      )
      try {
        await this.prisma.$transaction(
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

  private async appendBatch(): Promise<number> {
    return this.prisma.$transaction(
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
        let busy = 0
        for (const candidate of candidates) {
          // Reserve the remaining server budget for head allocation, events and commit.
          if (performance.now() - started >= 150 || ready.length >= this.readyLimit) break
          const row = await this.prepareCandidate(tx, candidate)
          if (row) ready.push(row)
          else busy++
        }
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
        const selected = ready.slice(
          0,
          Math.max(1, Math.floor(remaining / this.writeCostMs))
        )
        if (!selected.length) return 0
        const writeStarted = performance.now()
        await this.writeBatch(tx, selected)
        this.writeCostMs = Math.max(
          1,
          (this.writeCostMs + (performance.now() - writeStarted) / selected.length) / 2
        )
        return selected.length
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
    return this.prisma.$transaction(async (tx) => {
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
