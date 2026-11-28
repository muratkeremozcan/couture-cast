// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DatabaseLookIdeaBudget,
  LOOK_IDEA_DEADLINE_MS,
} from '../src/modules/personalization/look-ideas.budget.js'
import type { LookIdeaProvider } from '../src/modules/personalization/look-ideas.provider.js'
import { LookIdeasService } from '../src/modules/personalization/look-ideas.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { deleteMembers } from './helpers/privacy-guards.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const budget = new DatabaseLookIdeaBudget(prisma)
const generate = vi.fn<LookIdeaProvider['generate']>()
const service = new LookIdeasService({ generate }, budget)
const INPUT = { weather: 'mild-dry', profile: null } as const
const MEMBER_A = 'synthetic-look-ideas-budget-a'
const MEMBER_B = 'synthetic-look-ideas-budget-b'

beforeAll(async () => {
  await database.migrate()
  await prisma.user.createMany({
    data: [MEMBER_A, MEMBER_B].map((id) => ({ id, email: `${id}@example.com` })),
  })
}, 60_000)

afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

beforeEach(async () => {
  generate.mockReset().mockImplementation(({ candidates }) =>
    Promise.resolve({
      ideas: candidates.map(({ lookId }) => ({
        lookId,
        description: 'A simple mix for a mild day.',
      })),
    })
  )
  await prisma.lookIdeaDailyQuota.deleteMany()
  await prisma.lookIdeaBudget.update({ where: { id: 1 }, data: { dispatch_count: 0 } })
})

describe('CC-7.23 persistent look-ideas budgets', () => {
  it('makes no dispatch when the deployment budget row is unavailable', async () => {
    await prisma.lookIdeaBudget.delete({ where: { id: 1 } })
    try {
      await expect(service.generate(MEMBER_A, INPUT)).resolves.toBeNull()
      await expect(
        prisma.lookIdeaDailyQuota.findUnique({ where: { user_id: MEMBER_A } })
      ).resolves.toBeNull()
      expect(generate).not.toHaveBeenCalled()
    } finally {
      await prisma.lookIdeaBudget.create({ data: { id: 1 } })
    }
  })

  it('keeps both counters unchanged when a reservation starts after cancellation', async () => {
    const request = new AbortController()
    request.abort()
    await expect(
      budget.reserve(MEMBER_A, {
        at: performance.now() + LOOK_IDEA_DEADLINE_MS,
        signal: request.signal,
      })
    ).resolves.toBe('unavailable')
    await expect(
      prisma.lookIdeaDailyQuota.findUnique({ where: { user_id: MEMBER_A } })
    ).resolves.toBeNull()
    await expect(
      prisma.lookIdeaBudget.findUnique({ where: { id: 1 } })
    ).resolves.toMatchObject({ dispatch_count: 0 })
  })

  it('deletes the account quota with its member and keeps aggregate spend', async () => {
    const member = await prisma.user.create({
      data: { email: 'synthetic-quota-erasure@example.com' },
    })
    await expect(service.generate(member.id, INPUT)).resolves.toHaveLength(3)
    await expect(
      prisma.lookIdeaDailyQuota.findUnique({ where: { user_id: member.id } })
    ).resolves.toMatchObject({ dispatch_count: 1 })

    await deleteMembers(prisma, { id: member.id })

    await expect(prisma.user.findUnique({ where: { id: member.id } })).resolves.toBeNull()
    await expect(
      prisma.lookIdeaDailyQuota.findUnique({ where: { user_id: member.id } })
    ).resolves.toBeNull()
    await expect(
      prisma.lookIdeaBudget.findUnique({ where: { id: 1 } })
    ).resolves.toMatchObject({ dispatch_count: 1 })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('reserves at most three concurrent dispatches per account per UTC day', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.generate(MEMBER_A, INPUT))
    )

    expect(results.filter((result) => result !== null)).toHaveLength(3)
    expect(generate).toHaveBeenCalledTimes(3)
    await expect(
      prisma.lookIdeaDailyQuota.findUnique({ where: { user_id: MEMBER_A } })
    ).resolves.toMatchObject({ dispatch_count: 3 })
    await expect(
      prisma.lookIdeaBudget.findUnique({ where: { id: 1 } })
    ).resolves.toMatchObject({ dispatch_count: 3 })
    await expect(service.generate(MEMBER_B, INPUT)).resolves.toHaveLength(3)

    await prisma.lookIdeaDailyQuota.update({
      where: { user_id: MEMBER_A },
      data: { utc_day: new Date('2000-01-01T00:00:00.000Z') },
    })
    await expect(service.generate(MEMBER_A, INPUT)).resolves.toHaveLength(3)
    await expect(
      prisma.lookIdeaDailyQuota.findUnique({ where: { user_id: MEMBER_A } })
    ).resolves.toMatchObject({ dispatch_count: 1 })
    expect(generate).toHaveBeenCalledTimes(5)
  })

  it('shares the final deployment reservation across accounts', async () => {
    await prisma.lookIdeaBudget.update({
      where: { id: 1 },
      data: { dispatch_count: 499 },
    })

    const results = await Promise.all([
      service.generate(MEMBER_A, INPUT),
      service.generate(MEMBER_B, INPUT),
    ])

    expect(results.filter((result) => result !== null)).toHaveLength(1)
    expect(generate).toHaveBeenCalledTimes(1)
    const recreatedService = new LookIdeasService(
      { generate },
      new DatabaseLookIdeaBudget(prisma)
    )
    await expect(recreatedService.generate(MEMBER_A, INPUT)).resolves.toBeNull()
    await expect(recreatedService.generate(MEMBER_B, INPUT)).resolves.toBeNull()
    expect(generate).toHaveBeenCalledTimes(1)
    await expect(
      prisma.lookIdeaBudget.findUnique({ where: { id: 1 } })
    ).resolves.toMatchObject({ dispatch_count: 500 })
  })
})
