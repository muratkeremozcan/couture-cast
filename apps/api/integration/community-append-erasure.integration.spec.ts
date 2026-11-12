// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
//
// community_append_batch takes its locks in the order community_privacy_guards uses for erasure
// and the push send guard (member guards, then post guards, each in sorted hashtext order), and
// it never waits: every guard is tried, the outbox row is locked SKIP LOCKED and the head NOWAIT.
// Erasure waits only on the shared guard an append holds, and an append waits on nothing erasure
// holds, so no wait cycle exists. This spec races both on the same members through production
// paths and reads the server's own deadlock counter.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { latencyProxy } from './helpers/latency-proxy.js'
import {
  appendFailure,
  CommunityStreamRepository,
} from '../src/modules/community/community-stream.repository.js'
import {
  communityPrivacyTransaction,
  forgetCommunitySubject,
  guardCommunitySubject,
} from '../src/modules/community/community-privacy.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const proxy = latencyProxy(database.url, 15.5)
let remote: PrismaClient

async function deadlocks(): Promise<number> {
  await prisma.$executeRaw`SELECT pg_stat_force_next_flush()`
  await prisma.$executeRaw`SELECT pg_stat_clear_snapshot()`
  const [row] = await prisma.$queryRaw<{ deadlocks: bigint }[]>`
    SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`
  return Number(row!.deadlocks)
}

beforeAll(async () => {
  await database.migrate()
  remote = new PrismaClient({ datasources: { db: { url: await proxy.listen() } } })
  await remote.$queryRaw`SELECT 1`
}, 30_000)
afterAll(async () => {
  await remote?.$disconnect()
  await proxy.close()
  await prisma.$disconnect()
  await database.drop()
})

describe('community append racing account erasure', () => {
  it.each([
    ['local', 0],
    ['production round trip', 15.5],
  ] as const)(
    '6.5-INT-032: append and erasure on the same members never deadlock (%s)',
    async (_label, oneWayMs) => {
      const appendClient = oneWayMs ? remote : prisma
      const members = await Promise.all(
        Array.from({ length: 8 }, () =>
          prisma.user.create({ data: { email: `race-${randomUUID()}@synthetic.test` } })
        )
      )
      for (const member of members)
        await prisma.lookbookPost.createMany({
          data: Array.from({ length: 4 }, () =>
            buildLookbookPostCreateInput(
              createLookbookPost({ userId: member.id, status: 'published' })
            )
          ),
        })
      const before = await deadlocks()
      const outcomes: string[] = []
      const repository = new CommunityStreamRepository(appendClient)
      let erasing = true
      // Once erasure ends, append must drain the outbox; 50 attempts in a row after it that append
      // nothing fail the case with what happened instead of waiting out its timeout. Deferrals
      // while erasure holds the guards are expected and never count.
      let stalled = 0
      const appending = (async () => {
        for (;;) {
          const backlog = await prisma.communityDomainOutbox.count({
            where: { appended_at: null },
          })
          if (!erasing && !backlog) return
          if (!erasing && stalled >= 50)
            throw new Error(
              `append stopped progressing with ${backlog} rows left: ${outcomes.join(', ')}`
            )
          const counted = !erasing
          try {
            const appended = await repository.append()
            outcomes.push(`appended ${appended}`)
            if (appended) stalled = 0
            else if (counted) stalled++
          } catch (error) {
            outcomes.push(appendFailure(error))
            if (counted) stalled++
          }
        }
      })()
      const erasures = await Promise.allSettled(
        members.map(async (member, index) => {
          await new Promise((resolve) => setTimeout(resolve, index * 7))
          await communityPrivacyTransaction(prisma, async (tx) => {
            await guardCommunitySubject(tx, member.id)
            await forgetCommunitySubject(tx, member.id, true)
          })
        })
      )
      erasing = false
      await appending
      expect(erasures.filter((result) => result.status === 'rejected')).toEqual([])
      expect(outcomes, outcomes.join(', ')).not.toContain('dependency_unavailable')
      expect(await deadlocks()).toBe(before)
      expect(
        await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
      ).toBe(0)
      // Erasure leaves no event linked to an erased member, whichever side won each race.
      expect(
        await prisma.communityArtifactSubject.count({
          where: { artifact_kind: 'event', member_id: { in: members.map((m) => m.id) } },
        })
      ).toBe(0)
      console.info(
        JSON.stringify({ evidence: '6.5-INT-032', oneWayMs, outcomes: outcomes.length })
      )
    },
    120_000
  )
})
