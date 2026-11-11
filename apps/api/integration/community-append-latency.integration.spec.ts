// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
//
// Production 2026-11-11: community append had never succeeded. From the hosted worker each
// statement costs about 31 ms, and one candidate took about 16 round trips, so every batch ran
// out of its own 500 ms transaction budget, even at batch limit 1, and retried forever. This
// spec runs the real appender through a proxy that adds production's round trip.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { latencyProxy } from './helpers/latency-proxy.js'
import {
  appendFailure,
  CommunityStreamRepository,
} from '../src/modules/community/community-stream.repository.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
// 15.5 ms each way is the 31 ms production round trip.
const proxy = latencyProxy(database.url, 15.5)
let remote: PrismaClient

beforeAll(async () => {
  await database.migrate()
  remote = new PrismaClient({ datasources: { db: { url: await proxy.listen() } } })
  await remote.$queryRaw`SELECT 1`
}, 30_000)
beforeEach(async () => {
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
})
afterAll(async () => {
  await remote?.$disconnect()
  await proxy.close()
  await prisma.$disconnect()
  await database.drop()
})

async function publishPosts(count: number) {
  const user = await prisma.user.create({
    data: { email: `append-latency-${randomUUID()}@synthetic.test` },
  })
  await prisma.lookbookPost.createMany({
    data: Array.from({ length: count }, () =>
      buildLookbookPostCreateInput(
        createLookbookPost({ userId: user.id, status: 'published' })
      )
    ),
  })
}

describe('community append at production database latency', () => {
  it('6.5-INT-030: the proxy adds one production round trip per statement', async () => {
    const started = performance.now()
    for (let i = 0; i < 5; i++) await remote.$queryRaw`SELECT 1`
    const perStatement = (performance.now() - started) / 5
    expect(perStatement).toBeGreaterThanOrEqual(30)
    expect(perStatement).toBeLessThan(60)
  })

  it('6.5-INT-031: append makes progress within its budgets at a 31 ms round trip', async () => {
    await publishPosts(30)
    const pending = await prisma.communityDomainOutbox.count({
      where: { appended_at: null },
    })
    expect(pending).toBeGreaterThan(0)
    const repository = new CommunityStreamRepository(remote)
    const outcomes: string[] = []
    // The product's append loop: up to 12 deferrals in a row before it gives up on a batch.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!(await prisma.communityDomainOutbox.count({ where: { appended_at: null } })))
        break
      try {
        outcomes.push(`appended ${(await repository.appendWithReport()).count}`)
      } catch (error) {
        outcomes.push(appendFailure(error))
      }
    }
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } }),
      outcomes.join(', ')
    ).toBe(0)
    expect(await prisma.communityStreamEvent.count()).toBe(pending)
    expect(
      outcomes.filter((outcome) => outcome === 'budget_pressure').length
    ).toBeLessThan(3)
  }, 120_000)
})
