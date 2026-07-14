import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  PrismaWeatherAlertProcessingRepository,
  type WeatherAlertEventCandidate,
} from '../src/modules/alerts/weather-alert-processing.repository'

const describeRealDatabase =
  process.env.ALERT_COOLDOWN_REAL_DB_INTEGRATION === 'true'
    ? describe.sequential
    : describe.skip

const HOUR_MS = 60 * 60 * 1_000

describeRealDatabase('Weather alert rolling cooldown Prisma integration', () => {
  let prisma: PrismaClient
  let repository: PrismaWeatherAlertProcessingRepository
  let testPrefix: string

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

  beforeEach(async () => {
    testPrefix = `rolling-cooldown-${randomUUID()}`
    prisma = new PrismaClient()
    await prisma.$connect()
    repository = new PrismaWeatherAlertProcessingRepository(prisma)
  })

  afterEach(async () => {
    await prisma.eventEnvelope.deleteMany({
      where: { id: { startsWith: `${testPrefix}-event-` } },
    })
    await prisma.alertCooldownReservation.deleteMany({
      where: { deduplication_key: { startsWith: `${testPrefix}-key-` } },
    })
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
