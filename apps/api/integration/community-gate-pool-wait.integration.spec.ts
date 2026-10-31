// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertCommunityReadEligibility } from '../src/modules/community/community-access.service.js'
import { CommunityAuthorizationBudget } from '../src/modules/community/community-availability.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

/**
 * The community read gate under pool pressure. A burst of requests can take every
 * pooled connection for a moment; the gate must wait for one within its own
 * authorization budget (1950 ms) and answer, rather than give up after a fixed
 * 100 ms and report "access could not be verified". k6 smoke caught this: its
 * band-filtered feed read lost the race for a connection at start-up and got 503.
 */
describe('community read gate while the pool is busy', () => {
  const database = isolatedCommunityDatabase()
  let prisma: PrismaClient
  let member: string

  beforeAll(async () => {
    await database.migrate()
    const url = new URL(database.url)
    // One connection, so a single held transaction exhausts the pool.
    url.searchParams.set('connection_limit', '1')
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    const user = await prisma.user.create({
      data: {
        email: `community-gate-pool-${randomUUID()}@synthetic.test`,
        profile: {
          create: {
            birthdate: new Date('1990-01-01T00:00:00Z'),
            preferences: { compliance: { accountStatus: 'active' } },
          },
        },
      },
    })
    member = user.id
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await database.drop()
  })

  /** Holds the pool's only connection for `ms`; resolves `holding` once it has it. */
  function holdTheConnection(ms: number) {
    let signal: () => void = () => undefined
    const holding = new Promise<void>((resolve) => (signal = resolve))
    let releasedAt = 0
    const done = prisma.$transaction(
      async (tx) => {
        // The callback runs on the connection, so the pool has none left now.
        signal()
        await tx.$executeRaw`SELECT pg_sleep(${ms / 1000})`
        releasedAt = performance.now()
      },
      { timeout: 5_000 }
    )
    return { holding, done, releasedAt: () => releasedAt }
  }

  it('waits for the connection another request holds and authorizes the read', async () => {
    const holder = holdTheConnection(300)
    await holder.holding

    await expect(
      assertCommunityReadEligibility(prisma, member, new CommunityAuthorizationBudget())
    ).resolves.toBeUndefined()
    const authorizedAt = performance.now()
    await holder.done
    // It waited for the release: it could only have run once the holder let go.
    expect(holder.releasedAt()).toBeGreaterThan(0)
    expect(authorizedAt).toBeGreaterThanOrEqual(holder.releasedAt())
  }, 30_000)

  it('still answers unavailable once the budget runs out', async () => {
    const holder = holdTheConnection(600)
    await holder.holding

    await expect(
      assertCommunityReadEligibility(
        prisma,
        member,
        new CommunityAuthorizationBudget(performance.now() + 250)
      )
    ).rejects.toMatchObject({ status: 503 })
    await holder.done
  }, 30_000)
})
