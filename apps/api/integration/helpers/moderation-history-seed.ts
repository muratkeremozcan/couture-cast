// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: what the erasure, completion, export and retention suites share.
// `scanForIdentity` walks the live catalog, so a table added later fails the proof until it is
// scrubbed or named here.
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { expect, vi } from 'vitest'
import { buildCommunityContentSnapshot } from '../../src/modules/community/community-audit-snapshot.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import type { DecisionFixtures, SeededMember } from './moderation-decisions-seed.js'

export const ERASED_REASON = '[erased]'

/** Columns allowed to hold an erased member's id after completion, and why. */
export const IDENTITY_ALLOW_LIST = new Set([
  // Spec TEA-12: the replay and the null-subject rule read it until the `User` row goes.
  'ModerationErasureRequest.member_id',
  // The account-deletion story owns the `User` row and these, which hang off it.
  'User.id',
  'User.email',
  'UserProfile.user_id',
  'UserProfile.preferences',
  'ComfortPreferences.user_id',
])

/** Every text-like column in `public` that holds any of the needles, as `table.column`. */
export async function scanForIdentity(
  prisma: PrismaClient,
  needles: readonly string[]
): Promise<string[]> {
  const columns = await prisma.$queryRaw<
    { table_name: string; column_name: string }[]
  >`SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name <> '_prisma_migrations'
      AND c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
    ORDER BY 1, 2`
  const hits: string[] = []
  for (const { table_name: table, column_name: column } of columns) {
    for (const needle of needles) {
      const rows = await prisma.$queryRawUnsafe<{ hit: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM "${table}" WHERE "${column}"::text LIKE $1) AS hit`,
        `%${needle.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      )
      if (rows[0]?.hit) {
        hits.push(`${table}.${column}`)
        break
      }
    }
  }
  return hits
}

/** The erasure transaction. A requester makes it the route's call, and none makes it a repository call. */
export const erase = (
  prisma: PrismaClient,
  memberId: string,
  at: Date,
  requestedBy?: string
) =>
  new CommunityRepository(prisma).requestAccountErasure(
    memberId,
    at,
    requestedBy
      ? {
          id: requestedBy,
          auditData: (requestId: string) => ({ requestId, role: 'admin' }),
        }
      : undefined
  )

/** A decision row written straight to the table, for tests that are not about the decision route. */
export async function seedDecision(
  prisma: PrismaClient,
  params: {
    caseKey: string
    at: Date
    sequence?: number
    subjectId?: string | null
    moderatorId?: string | null
    moderatorRole?: string
    subjectAlias?: string | null
    postId?: string | null
    commentId?: string | null
    reportIds?: string[]
    reason?: string
    action?: 'resolve' | 'release' | 'takedown' | 'ban' | 'escalate'
    terminal?: boolean
  }
) {
  return prisma.moderationDecision.create({
    data: {
      case_key: params.caseKey,
      sequence: params.sequence ?? 1,
      source: 'post',
      post_id: params.postId ?? null,
      comment_id: params.commentId ?? null,
      report_ids: params.reportIds ?? [],
      action: params.action ?? 'resolve',
      reason: params.reason ?? 'A rationale written by the moderator.',
      moderator_id: params.moderatorId ?? null,
      moderator_role: params.moderatorRole ?? 'moderator',
      subject_user_id: params.subjectId ?? null,
      subject_alias: params.subjectAlias ?? null,
      mutation_id: randomUUID(),
      payload_hash: 'seeded',
      response: {},
      is_terminal: params.terminal ?? true,
      decided_at: params.at,
    },
  })
}

/**
 * A member in every position erasure has to reach, with a distinct canary in each free-text column:
 * a post with a caption and alt text, a report on it holding a snapshot, a screening event, a ban and
 * an alias, plus a report the member filed on someone else's post.
 */
export async function seedErasableMember(
  prisma: PrismaClient,
  fx: DecisionFixtures,
  at: Date
) {
  const run = randomUUID().slice(0, 8)
  const canaries = {
    caption: `caption-canary-${run}`,
    altText: `alt-canary-${run}`,
    details: `their-details-canary-${run}`,
    thirdPartyDetails: `third-party-details-canary-${run}`,
  }
  const member = await fx.member('erased')
  const operator = await fx.operator()
  const thirdParty = await fx.member('third-party')
  const post = await fx.post({ authorId: member.id })
  await prisma.lookbookPost.update({
    where: { id: post.id },
    data: {
      caption: canaries.caption,
      alt_text: canaries.altText,
      image_object_path: `community/${post.id}/${run}.jpg`,
    },
  })
  const snapshot = buildCommunityContentSnapshot(
    {
      caption: canaries.caption,
      alt_text: canaries.altText,
      locale: 'en-US',
      climate_band: 'temperate_dry',
    },
    at
  )
  const report = await fx.postReport(post.id, thirdParty.id, {
    subjectAlias: member.alias,
  })
  await prisma.communityPostReport.update({
    where: { id: report.id },
    data: {
      details: canaries.thirdPartyDetails,
      content_snapshot: snapshot as never,
      image_object_path: `community/${post.id}/${run}.jpg`,
    },
  })
  const event = await prisma.moderationEvent.create({
    data: {
      post_id: post.id,
      flagged_by_id: member.id,
      action: 'flagged',
      reason: 'unsafe_class',
      subject_alias: member.alias,
      content_snapshot: snapshot as never,
      image_object_path: `community/${post.id}/${run}.jpg`,
      created_at: at,
    },
  })
  const otherPost = await fx.post({ authorId: thirdParty.id })
  const filed = await fx.postReport(otherPost.id, member.id)
  await prisma.communityPostReport.update({
    where: { id: filed.id },
    data: { details: canaries.details },
  })
  const decision = await seedDecision(prisma, {
    caseKey: `post.${post.id}`,
    at,
    postId: post.id,
    subjectId: member.id,
    moderatorId: operator.id,
    subjectAlias: member.alias,
    reportIds: [report.id],
    action: 'ban',
    reason: `The reason names ${canaries.caption}.`,
  })
  // The operator's words are also copied to the event and to the post, so erasure has to reach those.
  const operatorEvent = await prisma.moderationEvent.create({
    data: {
      post_id: post.id,
      reviewed_by_id: operator.id,
      action: 'banned_by_operator',
      reason: decision.reason,
      created_at: at,
    },
  })
  await prisma.lookbookPost.update({
    where: { id: post.id },
    data: { moderation_reason: decision.reason },
  })
  const sanction = await prisma.communitySanction.create({
    data: {
      user_id: member.id,
      decision_id: decision.id,
      case_key: `post.${post.id}`,
      kind: 'permanent',
      created_at: at,
    },
  })
  return {
    member,
    operator,
    thirdParty,
    post,
    report,
    event,
    operatorEvent,
    filed,
    otherPost,
    decision,
    sanction,
    canaries,
  }
}

export type SeededErasure = Awaited<ReturnType<typeof seedErasableMember>>
export type { SeededMember }

/**
 * Installs a statement-level fault or barrier. The suites connect as a superuser, so they can reach
 * tables the application role does not own.
 */
export async function installTrigger(
  prisma: PrismaClient,
  table: string,
  timing: string,
  body: string
) {
  const name = `test_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN ${body} RETURN COALESCE(NEW, OLD); END $fn$`
  )
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${name} ${timing} ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`
  )
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`)
  }
}

/** A session lock a trigger can wait on, so a test decides when a transaction may continue. */
export async function holdBarrier(databaseUrl: string, key: number) {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  await client.query('SELECT pg_advisory_lock($1)', [key])
  let released = false
  // Safe to call twice, so a failed test can release it in `finally` and leave nothing waiting.
  return async () => {
    if (released) return
    released = true
    await client.query('SELECT pg_advisory_unlock($1)', [key])
    await client.end()
  }
}

/** True once some session is waiting on the barrier, so the order of a race is known. */
export async function waitForBarrierWaiter(prisma: PrismaClient, key: number) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND objid = ${key}::oid
      ) AS waiting`
    if (rows[0]?.waiting) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Nothing reached barrier ${key} within 15 seconds.`)
}

/** True once this many sessions on this database are blocked on a lock of any kind. */
export async function waitForLockWaiters(prisma: PrismaClient, count: number) {
  const deadline = Date.now() + 15_000
  let waiting = 0
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`
    waiting = rows[0]?.waiting ?? 0
    if (waiting >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${waiting} of ${count} sessions blocked on a lock after 15 seconds.`)
}

/**
 * Holds `first` at a barrier inside its transaction and starts `second`, then waits until the database
 * reports `second` blocked or `second` has finished, and only then lets `first` go. Waiting for "blocked"
 * alone would report a missing lock as a timeout, and what matters is the state the race leaves.
 * The decision's barrier is on its audit row, in the same transaction after the decision row: the
 * application role owns `AuditLog` and cannot put a trigger on `ModerationDecision` on the real image.
 */
export async function runInOrder<A, B>(
  prisma: PrismaClient,
  databaseUrl: string,
  table: 'AuditLog' | 'ModerationErasureRequest',
  first: () => Promise<A>,
  second: () => Promise<B>
): Promise<[A, B]> {
  const key = 800_000 + Math.floor(Math.random() * 90_000)
  const release = await holdBarrier(databaseUrl, key)
  const remove = await installTrigger(
    prisma,
    table,
    'BEFORE INSERT',
    `PERFORM pg_advisory_xact_lock(${key});`
  )
  try {
    const running = first()
    running.catch(() => undefined)
    await waitForBarrierWaiter(prisma, key)
    let finished = false
    const following = second()
    following.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      }
    )
    await vi.waitFor(
      async () => {
        if (finished) return
        const rows = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`
        expect(rows[0]!.waiting).toBeGreaterThanOrEqual(2)
      },
      { timeout: 15_000, interval: 25 }
    )
    await release()
    return await Promise.all([running, following])
  } finally {
    await release()
    await remove()
  }
}
