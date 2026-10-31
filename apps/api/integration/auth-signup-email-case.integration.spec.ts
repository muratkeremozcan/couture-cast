// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 owner: one application account per email, whatever its case.
//
// Verified-email identity mapping treats case-variant accounts as ambiguous and denies
// both, so a second signup that differs only in case would lock both people out.
import { PrismaClient } from '@prisma/client'
import { BadRequestException } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { AuthService } from '../src/modules/auth/auth.service.js'
import type { AnalyticsClient } from '../src/analytics/analytics.service.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const service = new AuthService(
  { capture: () => undefined } as unknown as AnalyticsClient,
  prisma,
  { captureEvent: () => Promise.resolve() } as unknown as TelemetryService
)
const adult = { birthdate: '1990-01-01' }

beforeAll(async () => {
  await database.migrate()
}, 60_000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

describe('signup email uniqueness ignores case', () => {
  it('rejects a case-variant duplicate with the existing conflict', async () => {
    const first = await service.signUp({ email: 'Case.Variant@Example.com', ...adult })
    const duplicate = service.signUp({ email: 'case.variant@example.COM', ...adult })
    await expect(duplicate).rejects.toBeInstanceOf(BadRequestException)
    await expect(duplicate).rejects.toThrow('Email already registered')
    const accounts = await prisma.user.findMany({
      where: { email: { equals: 'case.variant@example.com', mode: 'insensitive' } },
    })
    expect(accounts.map((account) => account.id)).toEqual([first.userId])
    // The stored address is the one the person typed.
    expect(accounts[0]!.email).toBe('Case.Variant@Example.com')
  })

  it('admits exactly one of two concurrent case-variant signups', async () => {
    const outcomes = await Promise.allSettled([
      service.signUp({ email: 'Race@Example.com', ...adult }),
      service.signUp({ email: 'race@example.com', ...adult }),
      service.signUp({ email: 'RACE@EXAMPLE.COM', ...adult }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    for (const outcome of outcomes.filter((outcome) => outcome.status === 'rejected'))
      expect(outcome.reason).toBeInstanceOf(BadRequestException)
    expect(
      await prisma.user.count({
        where: { email: { equals: 'race@example.com', mode: 'insensitive' } },
      })
    ).toBe(1)
  })

  it('still admits distinct addresses', async () => {
    await expect(
      service.signUp({ email: 'one@example.com', ...adult })
    ).resolves.toBeDefined()
    await expect(
      service.signUp({ email: 'two@example.com', ...adult })
    ).resolves.toBeDefined()
  })
})
