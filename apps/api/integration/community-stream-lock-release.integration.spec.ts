// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { type Prisma, PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
let observer: Client
let blocker: Client
let claimant: Client
let appender: Client
type Lock = {
  classid: number
  objid: string
  objsubid: number
  mode: string
  granted: boolean
}
const migration = resolve(
  __dirname,
  '../../../packages/db/prisma/migrations/20261111120000_community_append_batch/migration.sql'
)
const rollbackSql = "RAISE EXCEPTION USING ERRCODE = 'CCAB1';"
// Opt-in mutation of the deployed candidate function, in this test database only: every skip
// returns without rolling its subtransaction back, so the guards and row lock it took stay held.
// Run the SAME assertions with STORY65_ROLLBACK_MUTANT=1; that command must exit 1.
async function installRollbackMutant() {
  if (process.env.STORY65_ROLLBACK_MUTANT !== '1') return
  const source = readFileSync(migration, 'utf8')
  const start = source.indexOf('CREATE FUNCTION community_append_prepare')
  const end = source.indexOf('END $$;', start) + 'END $$;'.length
  const original = source.slice(start, end)
  expect(original.split(rollbackSql)).toHaveLength(4)
  await observer.query(
    original
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
      .replaceAll(rollbackSql, 'RETURN NULL;')
  )
  console.info(
    JSON.stringify({
      evidence: 'R16-T01-isolated-mutant',
      originalSha256: createHash('sha256').update(original).digest('hex'),
      mutation: 'skip a candidate without rolling its subtransaction back',
      canonicalSourceWritten: false,
    })
  )
}
beforeAll(async () => {
  await database.migrate()
  observer = new Client({ connectionString: database.url })
  blocker = new Client({ connectionString: database.url })
  claimant = new Client({ connectionString: database.url })
  appender = new Client({ connectionString: database.url })
  await Promise.all([
    observer.connect(),
    blocker.connect(),
    claimant.connect(),
    appender.connect(),
  ])
  const version = await observer.query<{ version: number }>(
    "SELECT current_setting('server_version_num')::int AS version"
  )
  expect(version.rows[0]!.version).toBeGreaterThanOrEqual(170000)
  await installRollbackMutant()
}, 30_000)
beforeEach(async () => {
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
})
afterAll(async () => {
  await Promise.all(
    [observer, blocker, claimant, appender].filter(Boolean).map(async (client) => {
      await client.query('ROLLBACK')
      await client.end()
    })
  )
  await prisma.$disconnect()
  await database.drop()
})
async function fixture(createdAt: Date) {
  const user = await prisma.user.create({
    data: { email: `lock-${randomUUID()}@synthetic.test` },
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: user.id, status: 'published' })
    ),
  })
  const candidate = await prisma.communityDomainOutbox.findFirstOrThrow({
    where: { post_id: post.id },
  })
  await prisma.communityDomainOutbox.update({
    where: { id: candidate.id },
    data: { created_at: createdAt },
  })
  return { user, post, candidate }
}
async function advisory(pid: number): Promise<Lock[]> {
  return (
    await observer.query<Lock>(
      `SELECT classid::int, objid::bigint::text AS objid, objsubid, mode, granted
    FROM pg_locks WHERE pid=$1 AND locktype='advisory' ORDER BY classid, objid`,
      [pid]
    )
  ).rows
}
async function key(namespace: number, id: string): Promise<Lock> {
  const result = await observer.query<{ objid: string }>(
    'SELECT (hashtext($1)::bigint & 4294967295)::text AS objid',
    [id]
  )
  return {
    classid: namespace,
    objid: result.rows[0]!.objid,
    objsubid: 2,
    mode: 'ShareLock',
    granted: true,
  }
}
async function claimNowait(id: string, available: boolean) {
  await claimant.query('BEGIN')
  try {
    const attempt = claimant.query(
      'SELECT id FROM "CommunityDomainOutbox" WHERE id=$1::uuid FOR UPDATE NOWAIT',
      [id]
    )
    if (available) expect((await attempt).rows).toEqual([{ id }])
    else await expect(attempt).rejects.toMatchObject({ code: '55P03' })
  } finally {
    await claimant.query('ROLLBACK')
  }
}

describe('Story 6.5 R16 T01: production candidate subtransaction lock release', () => {
  it('releases a partially acquired member guard when the post guard is busy and retains prior candidate locks', async () => {
    const retained = await fixture(new Date('2026-01-01T00:00:00Z'))
    const rejected = await fixture(new Date('2026-01-02T00:00:00Z'))
    const retainedKeys = await Promise.all([
      key(65001, retained.user.id),
      key(65002, retained.post.id),
    ])
    await blocker.query('BEGIN')
    await blocker.query('SELECT pg_advisory_xact_lock(65002, hashtext($1))', [
      rejected.post.id,
    ])
    let backendPid = 0
    let observed: Lock[] = []
    // The proxy observes the open transaction right after the production batch function
    // returns, before COMMIT. Every lock taken and released is the function's own.
    const instrumented = new Proxy(prisma, {
      get(target, property): unknown {
        if (property !== '$transaction') return Reflect.get(target, property)
        return (
          body: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: Parameters<PrismaClient['$transaction']>[1]
        ) =>
          target.$transaction(async (tx) => {
            backendPid = (
              await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            )[0]!.pid
            const wrapped = new Proxy(tx, {
              get(transaction, name): unknown {
                if (name !== '$queryRaw') return Reflect.get(transaction, name)
                return async (
                  ...args: Parameters<Prisma.TransactionClient['$queryRaw']>
                ) => {
                  const result: unknown = await transaction.$queryRaw(...args)
                  if (
                    (args[0] as readonly string[])
                      .join('?')
                      .includes('community_append_batch')
                  ) {
                    observed = await advisory(backendPid)
                    await claimNowait(rejected.candidate.id, true)
                    await claimNowait(retained.candidate.id, false)
                  }
                  return result
                }
              },
            })
            return body(wrapped)
          }, options)
      },
    })
    try {
      expect(await new CommunityStreamRepository(instrumented).append()).toBe(1)
      // Exact identities prevent a coincidental equal lock count from passing.
      expect(observed).toHaveLength(retainedKeys.length)
      expect(observed).toEqual(expect.arrayContaining(retainedKeys))
      const events = await prisma.communityStreamEvent.findMany()
      expect(events.map((row) => row.source_outbox_id)).toEqual([retained.candidate.id])
      expect(
        (
          await prisma.communityDomainOutbox.findUniqueOrThrow({
            where: { id: rejected.candidate.id },
          })
        ).appended_at
      ).toBeNull()
      expect(await advisory(backendPid)).toEqual([])
      console.info(
        JSON.stringify({
          evidence: 'R16-T01-production-candidate-rollback',
          reason: 'busy-post',
          backendPid,
          observed,
          rejectedRowNowait: 'acquired',
          retainedRowNowait: '55P03',
        })
      )
    } finally {
      await blocker.query('ROLLBACK')
    }
  })

  it('releases the claimed outbox row and guards after a concurrent subject change, retaining prior candidate locks', async () => {
    const retained = await fixture(new Date('2026-01-01T00:00:00Z'))
    const rejected = await fixture(new Date('2026-01-02T00:00:00Z'))
    const retainedKeys = await Promise.all([
      key(65001, retained.user.id),
      key(65002, retained.post.id),
    ])
    const pid = (await appender.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]!.pid
    await appender.query('BEGIN')
    try {
      const kept = await appender.query<{ id: string | null }>(
        'SELECT (community_append_prepare($1::uuid, community_append_subjects($1::uuid))).id',
        [retained.candidate.id]
      )
      expect(kept.rows[0]!.id).toBe(retained.candidate.id)
      // The links the batch read before locking, then a concurrent change that committed before
      // the row lock: the candidate must be skipped and everything it took released.
      const seen = (
        await appender.query<{ seen: unknown }>(
          'SELECT community_append_subjects($1::uuid) AS seen',
          [rejected.candidate.id]
        )
      ).rows[0]!.seen
      await observer.query(
        'UPDATE "CommunityArtifactSubject" SET generation=generation+1 WHERE artifact_kind=\'outbox\' AND artifact_id=$1',
        [rejected.candidate.id]
      )
      const skipped = await appender.query<{ id: string | null }>(
        'SELECT (community_append_prepare($1::uuid, $2::jsonb)).id',
        [rejected.candidate.id, JSON.stringify(seen)]
      )
      expect(skipped.rows[0]!.id).toBeNull()
      const observed = await advisory(pid)
      expect(observed).toHaveLength(retainedKeys.length)
      expect(observed).toEqual(expect.arrayContaining(retainedKeys))
      await claimNowait(rejected.candidate.id, true)
      await claimNowait(retained.candidate.id, false)
      console.info(
        JSON.stringify({
          evidence: 'R16-T01-production-candidate-rollback',
          reason: 'changed-subjects',
          pid,
          observed,
          rejectedRowNowait: 'acquired',
          retainedRowNowait: '55P03',
        })
      )
    } finally {
      await appender.query('ROLLBACK')
    }
    expect(await advisory(pid)).toEqual([])
  })
})
