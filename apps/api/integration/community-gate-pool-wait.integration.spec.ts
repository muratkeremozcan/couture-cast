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

  it('waits for the connection another request holds and authorizes the read', async () => {
    let released = 0
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(0.3)`
        released = performance.now()
      },
      { timeout: 5_000 }
    )
    // Let the holder take the only connection first.
    await new Promise((resolve) => setTimeout(resolve, 50))

    await expect(
      assertCommunityReadEligibility(prisma, member, new CommunityAuthorizationBudget())
    ).resolves.toBeUndefined()
    await holder
    expect(released).toBeGreaterThan(0)
  }, 30_000)

  it('still answers unavailable once the budget runs out', async () => {
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(0.6)`
      },
      { timeout: 5_000 }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    await expect(
      assertCommunityReadEligibility(
        prisma,
        member,
        new CommunityAuthorizationBudget(performance.now() + 250)
      )
    ).rejects.toMatchObject({ status: 503 })
    await holder
  }, 30_000)
})
