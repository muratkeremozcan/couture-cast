import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { Client } from 'pg'
import { type Prisma, PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { createBaseLogger } from '../src/logger/pino.config.js'
import { communityBuildIdentity } from '../src/modules/community/community-operational-telemetry.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
let observer: Client
let blocker: Client
let claimant: Client
const rollbackSql = 'ROLLBACK TO SAVEPOINT community_candidate'
const mutationSql = 'SELECT 1 /* R16 omitted candidate rollback */'
type Lock = {
  classid: number
  objid: string
  objsubid: number
  mode: string
  granted: boolean
}

// Opt-in mutation changes an in-memory copy of actual production source only.
// Run the SAME assertions with STORY65_ROLLBACK_MUTANT=1; that command must exit1.
function repositoryClass(): typeof CommunityStreamRepository {
  if (process.env.STORY65_ROLLBACK_MUTANT !== '1') return CommunityStreamRepository
  const path = resolve(
    __dirname,
    '../src/modules/community/community-stream.repository.ts'
  )
  const source = readFileSync(path, 'utf8')
  expect(source.split(rollbackSql)).toHaveLength(3)
  const mutant = source.replaceAll(rollbackSql, mutationSql)
  const code = transpileModule(mutant, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText
  const localRequire = createRequire(path)
  const module = {
    exports: {} as { CommunityStreamRepository: typeof CommunityStreamRepository },
  }
  runInNewContext(
    code,
    {
      exports: module.exports,
      require: (id: string): unknown => {
        if (id === './community-operational-telemetry.js')
          return { communityBuildIdentity }
        if (id === '../../logger/pino.config.js') return { createBaseLogger }
        return localRequire(id) as unknown
      },
      performance,
      console,
      setTimeout,
      clearTimeout,
    },
    { filename: `${path}.rollback-omission-mutant` }
  )
  console.info(
    JSON.stringify({
      evidence: 'R16-T01-isolated-mutant',
      originalSha256: createHash('sha256').update(source).digest('hex'),
      mutation: 'omit both candidate ROLLBACK TO SAVEPOINT statements',
      canonicalSourceWritten: false,
    })
  )
  return module.exports.CommunityStreamRepository
}

beforeAll(async () => {
  await database.migrate()
  observer = new Client({ connectionString: database.url })
  blocker = new Client({ connectionString: database.url })
  claimant = new Client({ connectionString: database.url })
  await Promise.all([observer.connect(), blocker.connect(), claimant.connect()])
  const version = await observer.query<{ version: number }>(
    "SELECT current_setting('server_version_num')::int AS version"
  )
  expect(version.rows[0]!.version).toBeGreaterThanOrEqual(170000)
}, 30_000)
beforeEach(async () => {
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
})
afterAll(async () => {
  await Promise.all(
    [observer, blocker, claimant].filter(Boolean).map(async (client) => {
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

describe('Story 6.5 R16 T01: production candidate savepoint lock release', () => {
  it.each([
    {
      reason: 'busy-post',
      name: 'releases a partially acquired member guard when the post guard is busy and retains prior candidate locks',
    },
    {
      reason: 'changed-subjects',
      name: 'releases actual claimed outbox row and guards after a concurrent subject change, retaining prior candidate locks',
    },
  ] as const)('$name', async ({ reason }) => {
    const retained = await fixture(new Date('2026-01-01T00:00:00Z'))
    const rejected = await fixture(new Date('2026-01-02T00:00:00Z'))
    const retainedKeys = await Promise.all([
      key(65001, retained.user.id),
      key(65002, retained.post.id),
    ])
    const rejectedKeys = [await key(65001, rejected.user.id)]
    if (reason === 'changed-subjects')
      rejectedKeys.push(await key(65002, rejected.post.id))
    await blocker.query('BEGIN')
    if (reason === 'busy-post')
      await blocker.query('SELECT pg_advisory_xact_lock(65002, hashtext($1))', [
        rejected.post.id,
      ])
    let backendPid = 0
    let observed = 0
    let subjectReads = 0
    let before: Lock[] = []
    let after: Lock[] = []
    // The proxy observes SQL and inserts a real concurrent link change. All query
    // results, guard acquisition, row claims and rollback decisions are production.
    const instrumented = new Proxy(prisma, {
      get(target, property): unknown {
        if (property !== '$transaction') return Reflect.get(target, property)
        return (
          body: (tx: Prisma.TransactionClient) => Promise<number>,
          options: Parameters<PrismaClient['$transaction']>[1]
        ) =>
          target.$transaction(async (tx) => {
            backendPid = (
              await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            )[0]!.pid
            const wrapped = new Proxy(tx, {
              get(transaction, name): unknown {
                if (name === '$executeRawUnsafe')
                  return async (sql: string, ...values: unknown[]) => {
                    if (sql !== rollbackSql && sql !== mutationSql)
                      return transaction.$executeRawUnsafe(sql, ...values)
                    observed++
                    before = await advisory(backendPid)
                    expect(before).toHaveLength(retainedKeys.length + rejectedKeys.length)
                    expect(before).toEqual(
                      expect.arrayContaining([...retainedKeys, ...rejectedKeys])
                    )
                    if (reason === 'changed-subjects')
                      await claimNowait(rejected.candidate.id, false)
                    const result = await transaction.$executeRawUnsafe(sql, ...values)
                    after = await advisory(backendPid)
                    // Exact identities prevent a coincidental equal lock count from passing.
                    expect(after).toHaveLength(retainedKeys.length)
                    expect(after).toEqual(expect.arrayContaining(retainedKeys))
                    await claimNowait(rejected.candidate.id, true)
                    await claimNowait(retained.candidate.id, false)
                    return result
                  }
                if (name === 'communityArtifactSubject')
                  return new Proxy(transaction.communityArtifactSubject, {
                    get(delegate, method): unknown {
                      if (method !== 'findMany') return Reflect.get(delegate, method)
                      return async (
                        args: Prisma.CommunityArtifactSubjectFindManyArgs
                      ) => {
                        if (
                          args.where?.artifact_id === rejected.candidate.id &&
                          ++subjectReads === 2 &&
                          reason === 'changed-subjects'
                        ) {
                          await observer.query(
                            'UPDATE "CommunityArtifactSubject" SET generation=generation+1 WHERE artifact_kind=\'outbox\' AND artifact_id=$1',
                            [rejected.candidate.id]
                          )
                        }
                        return delegate.findMany(args)
                      }
                    },
                  })
                return Reflect.get(transaction, name)
              },
            })
            return body(wrapped)
          }, options)
      },
    })
    try {
      const Repository = repositoryClass()
      expect(await new Repository(instrumented).append()).toBe(1)
      expect(observed).toBe(1)
      const event = await prisma.communityStreamEvent.findMany()
      expect(event.map((row) => row.source_outbox_id)).toEqual([retained.candidate.id])
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
          reason,
          backendPid,
          before,
          after,
          rejectedRowNowait: 'acquired',
          retainedRowNowait: '55P03',
          observed,
        })
      )
    } finally {
      await blocker.query('ROLLBACK')
    }
  })
})
