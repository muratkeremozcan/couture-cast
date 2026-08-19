// Learning path Step 17: Weather alert rules and notification pipeline.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-17-weather-alert-rules-and-notification-pipeline
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  PrismaWeatherAlertProcessingRepository,
  type WeatherAlertEventCandidate,
} from '../src/modules/alerts/weather-alert-processing.repository'

/**
 * Gated on a reachable schema, the way every sibling suite in this directory is,
 * rather than on an opt-in environment variable.
 *
 * `ALERT_COOLDOWN_REAL_DB_INTEGRATION` was the previous gate and no workflow, npm
 * script, or documented command ever set it. The suite therefore never executed
 * anywhere, which is how it came to sit broken: every candidate it builds carries a
 * `userId` with no `User` row behind it, so the first `createEvents` died on
 * `EventEnvelope_user_id_fkey` (P2003) before asserting anything. A gate nobody can
 * satisfy reports the same green as a passing suite, so the breakage was invisible.
 *
 * The probe below gives the same courtesy the variable was reaching for — a developer
 * with no database still gets a clean skip with a reason — while a machine that does
 * have one actually runs the tests.
 *
 * THE PROBE ERROR IS REPORTED, NEVER SWALLOWED. A bare `catch {}` makes every cause
 * look alike: no server listening, a server with no migrations applied, and bad
 * credentials all print the same sentence, so the reader cannot tell which one to fix.
 * The caught error's message rides along in the warning instead.
 */
const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const HOUR_MS = 60 * 60 * 1_000

let schemaReady = false

async function probeSchema(): Promise<void> {
  const probe = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    await probe.$queryRaw`SELECT 1 FROM "EventEnvelope" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    const cause = error instanceof Error ? error.message : String(error)
    // eslint-disable-next-line no-console
    console.warn(
      '[weather-alert-cooldown.integration] Skipped: no reachable PostgreSQL with the ' +
        'EventEnvelope schema. Run `npm run db:reset` to execute this suite. ' +
        `Probe error: ${cause}`
    )
  } finally {
    await probe.$disconnect()
  }
}

describe.sequential('Weather alert rolling cooldown Prisma integration', () => {
  let prisma: PrismaClient
  let repository: PrismaWeatherAlertProcessingRepository
  let testPrefix: string

  beforeAll(probeSchema)

  function buildCandidate(
    deduplicationKey: string,
    createdAt: Date,
    idSuffix: string = randomUUID()
  ): WeatherAlertEventCandidate {
    const userId = `${testPrefix}-user`

    return {
      id: `${testPrefix}-event-${idSuffix}`,
      channel: 'alert:weather',
      userId,
      createdAt,
      deduplicationKey,
      payload: {
        version: '1',
        timestamp: createdAt.toISOString(),
        userId,
        data: {
          alertType: 'temperature',
          location: 'Chicago, IL',
          message: 'Temperature will rise above your configured threshold.',
          severity: 'warning',
        },
      },
    }
  }

  beforeEach(async (context) => {
    if (!schemaReady) {
      context.skip()
      return
    }
    testPrefix = `rolling-cooldown-${randomUUID()}`
    // Same explicitly resolved URL the probe used, so the suite can never assert
    // against a different database than the one it declared ready.
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await prisma.$connect()
    // Every candidate this suite builds carries `${testPrefix}-user` as its
    // `userId`, and `EventEnvelope.user_id` is a real foreign key onto `User`.
    // Without this row the very first `createEvents` call dies on
    // `EventEnvelope_user_id_fkey` (P2003) and all three tests fail before
    // asserting anything about cooldown behaviour. Nothing reported it because
    // nothing ever ran the suite; see the gate note at the top of this file.
    await prisma.user.create({
      data: { id: `${testPrefix}-user`, email: `${testPrefix}@couture-cast.test` },
    })
    repository = new PrismaWeatherAlertProcessingRepository(prisma)
  })

  afterEach(async () => {
    await prisma.eventEnvelope.deleteMany({
      where: { id: { startsWith: `${testPrefix}-event-` } },
    })
    await prisma.alertCooldownReservation.deleteMany({
      where: { deduplication_key: { startsWith: `${testPrefix}-key-` } },
    })
    // Last, and only after the envelopes above: the outbox rows cascade from the
    // envelopes and the envelopes cascade from the user, so deleting the user
    // first would take the rows this cleanup is auditing with it.
    await prisma.user.deleteMany({ where: { id: `${testPrefix}-user` } })
    await prisma.$disconnect()
  })

  it('suppresses the same fingerprint across an hour boundary and stale replays', async () => {
    const deduplicationKey = `${testPrefix}-key-rise`
    const distinctKey = `${testPrefix}-key-drop`
    const firstAt = new Date('2026-07-13T14:59:00.000Z')
    const boundaryAt = new Date('2026-07-13T15:00:00.000Z')
    const eligibleAt = new Date(firstAt.getTime() + HOUR_MS)

    await expect(
      repository.createEvents([buildCandidate(deduplicationKey, firstAt, 'first')])
    ).resolves.toHaveLength(1)
    await expect(
      repository.createEvents([buildCandidate(deduplicationKey, boundaryAt, 'boundary')])
    ).resolves.toEqual([])
    await expect(
      repository.createEvents([buildCandidate(distinctKey, boundaryAt, 'distinct')])
    ).resolves.toHaveLength(1)
    await expect(
      repository.createEvents([buildCandidate(deduplicationKey, eligibleAt, 'eligible')])
    ).resolves.toHaveLength(1)
    await expect(
      repository.createEvents([buildCandidate(deduplicationKey, firstAt, 'replay')])
    ).resolves.toEqual([])

    const reservation = await prisma.alertCooldownReservation.findUniqueOrThrow({
      where: { deduplication_key: deduplicationKey },
    })
    expect(reservation.next_eligible_at).toEqual(new Date(eligibleAt.getTime() + HOUR_MS))
  })

  it('atomically admits one event when identical reservations race', async () => {
    const deduplicationKey = `${testPrefix}-key-race`
    const triggeredAt = new Date('2026-07-13T16:10:00.000Z')
    const candidates = Array.from({ length: 8 }, (_, index) =>
      buildCandidate(deduplicationKey, triggeredAt, `race-${index}`)
    )

    const results = await Promise.all(
      candidates.map((candidate) => repository.createEvents([candidate]))
    )

    expect(results.flat()).toHaveLength(1)
    await expect(
      prisma.alertDeliveryOutbox.count({
        where: { deduplication_key: deduplicationKey },
      })
    ).resolves.toBe(1)
  })

  it('rolls back a reservation when envelope persistence fails', async () => {
    const deduplicationKey = `${testPrefix}-key-rollback`
    const triggeredAt = new Date('2026-07-13T17:20:00.000Z')
    const collidingId = `${testPrefix}-event-collision`

    await prisma.eventEnvelope.create({
      data: {
        id: collidingId,
        channel: 'test:collision',
        payload: {},
        created_at: triggeredAt,
      },
    })

    await expect(
      repository.createEvents([
        buildCandidate(deduplicationKey, triggeredAt, 'collision'),
      ])
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      repository.createEvents([
        buildCandidate(deduplicationKey, triggeredAt, 'after-rollback'),
      ])
    ).resolves.toHaveLength(1)
  })
})
