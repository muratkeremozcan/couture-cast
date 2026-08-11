import { vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

/**
 * A Prisma test double that models the surface the real client actually exposes.
 *
 * Hand-rolled object literals were how Story 4.3 shipped a `FOR UPDATE` lock
 * against tables that do not exist: the production code guarded on
 * `typeof tx.$executeRaw === 'function'`, the mock had no such method, and the
 * lock was therefore never executed by a single test. Every delegate and raw
 * helper is defined here so that omitting one is impossible rather than silent.
 *
 * This is still a unit-test double. Constraints, row locks, RLS, and isolation
 * are only provable against a real database; see
 * `integration/wardrobe-capsules.integration.spec.ts`.
 */

type Delegate = {
  findFirst: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
  findMany: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  createMany: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  updateMany: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
}

function createDelegate(): Delegate {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  }
}

const MODEL_NAMES = [
  'user',
  'userProfile',
  'comfortPreferences',
  'garmentItem',
  'paletteInsights',
  'outfitCapsule',
  'outfitCapsuleGarment',
  'outfitRecommendation',
  'capsuleTelemetryClaim',
  'auditLog',
  'guardianConsent',
  'forecastSegment',
  'weatherSnapshot',
  'telemetryEvent',
  // Story 5.1 commerce.
  'commercePartner',
  'commercePreference',
  'affiliateOffer',
  'affiliateClick',
  'affiliateConversion',
] as const

export type MockPrisma = Record<(typeof MODEL_NAMES)[number], Delegate> & {
  $transaction: ReturnType<typeof vi.fn>
  $queryRaw: ReturnType<typeof vi.fn>
  $executeRaw: ReturnType<typeof vi.fn>
  $queryRawUnsafe: ReturnType<typeof vi.fn>
  $executeRawUnsafe: ReturnType<typeof vi.fn>
  asPrismaClient: () => PrismaClient
}

export function createMockPrisma(): MockPrisma {
  const delegates = Object.fromEntries(
    MODEL_NAMES.map((name) => [name, createDelegate()])
  ) as Record<(typeof MODEL_NAMES)[number], Delegate>

  const client = {
    ...delegates,
    /**
     * Raw helpers resolve rather than being absent. `SELECT ... FOR UPDATE`
     * returns no rows, which is what the lock helpers expect.
     */
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  } as unknown as MockPrisma

  /** Interactive transactions receive the same client, so writes are observable. */
  client.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function'
      ? await (arg as (tx: MockPrisma) => Promise<unknown>)(client)
      : await Promise.all(arg as Promise<unknown>[])
  )

  client.asPrismaClient = () => client as unknown as PrismaClient

  return client
}
