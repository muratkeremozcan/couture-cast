import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { HttpException, PreconditionFailedException } from '@nestjs/common'
import {
  formatOnboardingETag,
  WardrobeOnboardingService,
} from '../src/modules/wardrobe/wardrobe-onboarding.service.js'
import type { AnalyticsClient } from '../src/analytics/analytics.service.js'

/**
 * Real-PostgreSQL coverage for the onboarding state machine.
 *
 * Story 4.3's review found that a mock-only integration suite let a
 * non-functional real-database path ship, and that the revision/If-Match
 * precondition must be proven against a real database, not a separate
 * pre-check read followed by an unconditional write (Risk 4.4-R02). This
 * suite uses two real Postgres connections for the concurrent-PATCH cases.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prismaA = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const prismaB = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prismaA.$queryRaw`SELECT 1`
    await prismaA.$queryRaw`SELECT 1 FROM "WardrobeOnboardingState" LIMIT 1`
    await prismaA.$queryRaw`SELECT "started_telemetry_emitted_at" FROM "WardrobeOnboardingState" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-onboarding.integration] Skipped: PostgreSQL is missing the Story 4.4 schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

function createAnalyticsStub(): { client: AnalyticsClient; events: unknown[] } {
  const events: unknown[] = []
  return {
    client: { capture: vi.fn((event) => void events.push(event)) },
    events,
  }
}

describe('4.4 wardrobe onboarding state machine against real PostgreSQL', () => {
  const namespace = `onboarding-it-${randomUUID().slice(0, 8)}`
  let userId: string
  let serviceA: WardrobeOnboardingService
  let serviceB: WardrobeOnboardingService
  let analyticsA: ReturnType<typeof createAnalyticsStub>
  let analyticsB: ReturnType<typeof createAnalyticsStub>

  beforeAll(async () => {
    await probeSchema()
  })

  beforeEach(async () => {
    if (!schemaReady) return

    const user = await prismaA.user.create({
      data: { email: `${namespace}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    userId = user.id

    analyticsA = createAnalyticsStub()
    analyticsB = createAnalyticsStub()
    serviceA = new WardrobeOnboardingService(prismaA, analyticsA.client)
    serviceB = new WardrobeOnboardingService(prismaB, analyticsB.client)
  })

  afterAll(async () => {
    if (!schemaReady) {
      await prismaA.$disconnect()
      await prismaB.$disconnect()
      return
    }

    await prismaA.wardrobeOnboardingState.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.garmentItem.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.user.deleteMany({ where: { email: { contains: namespace } } })
    await prismaA.$disconnect()
    await prismaB.$disconnect()
  })

  it('4.4-INT-01 returns the virtual not_started default with no persisted row', async (context) => {
    if (!requireSchema(context)) return

    const { response, etag } = await serviceA.getState(userId)

    expect(response.data).toEqual({
      status: 'not_started',
      currentStep: 'permission',
      usedStarterWardrobe: false,
      garmentsCapturedCount: 0,
      startedAt: null,
      completedAt: null,
      revision: 0,
    })
    expect(etag).toBe(formatOnboardingETag(userId, 0))

    const row = await prismaA.wardrobeOnboardingState.findUnique({
      where: { user_id: userId },
    })
    expect(row).toBeNull()
  })

  it('4.4-INT-02 advances the full happy path and captures garments at the silhouette transition', async (context) => {
    if (!requireSchema(context)) return

    const started = await serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
      targetStep: 'capture',
    })
    expect(started.response.data).toMatchObject({
      status: 'in_progress',
      currentStep: 'capture',
      revision: 1,
    })
    expect(started.isNoOp).toBe(false)

    await prismaA.garmentItem.create({
      data: {
        user_id: userId,
        object_path: `${namespace}/${randomUUID()}.png`,
        category: 'top',
        material: 'cotton',
        comfort_range: 'mild',
        upload_status: 'ready',
        retention_status: 'active',
      },
    })

    const tagging = await serviceA.advanceStep(userId, formatOnboardingETag(userId, 1), {
      targetStep: 'tagging',
    })
    expect(tagging.response.data.currentStep).toBe('tagging')

    const silhouette = await serviceA.advanceStep(
      userId,
      formatOnboardingETag(userId, 2),
      {
        targetStep: 'silhouette',
      }
    )
    expect(silhouette.response.data).toMatchObject({
      currentStep: 'silhouette',
      garmentsCapturedCount: 1,
    })

    const complete = await serviceA.advanceStep(userId, formatOnboardingETag(userId, 3), {
      targetStep: 'complete',
    })
    expect(complete.response.data).toMatchObject({
      status: 'completed',
      currentStep: 'complete',
      revision: 4,
    })
    expect(complete.response.data.completedAt).not.toBeNull()

    // wardrobe_onboarding_started fires exactly once, at the very first transition.
    const startedEvents = analyticsA.events.filter(
      (event) => (event as { event: string }).event === 'wardrobe_onboarding_started'
    )
    expect(startedEvents).toHaveLength(1)

    const completedEvents = analyticsA.events.filter(
      (event) => (event as { event: string }).event === 'wardrobe_onboarding_completed'
    )
    expect(completedEvents).toHaveLength(1)
    expect(
      (completedEvents[0] as { properties: Record<string, unknown> }).properties
    ).toMatchObject({
      used_starter_wardrobe: false,
      garment_count: 1,
      silhouette_mode: 'default_mannequin',
    })
  })

  it('4.4-INT-03 takes the starter-wardrobe skip path without creating synthetic garments', async (context) => {
    if (!requireSchema(context)) return

    await serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
      targetStep: 'capture',
    })
    const skip = await serviceA.advanceStep(userId, formatOnboardingETag(userId, 1), {
      targetStep: 'silhouette',
      usedStarterWardrobe: true,
    })

    expect(skip.response.data).toMatchObject({
      currentStep: 'silhouette',
      usedStarterWardrobe: true,
      garmentsCapturedCount: 0,
    })

    const garments = await prismaA.garmentItem.findMany({ where: { user_id: userId } })
    expect(garments).toHaveLength(0)
  })

  it('4.4-INT-04 rejects a transition that is not forward-reachable', async (context) => {
    if (!requireSchema(context)) return

    await expect(
      serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
        targetStep: 'silhouette',
      })
    ).rejects.toMatchObject({ message: 'INVALID_STEP_TRANSITION' })

    await serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
      targetStep: 'capture',
    })
    // capture -> tagging cannot coexist with usedStarterWardrobe: true.
    await expect(
      serviceA.advanceStep(userId, formatOnboardingETag(userId, 1), {
        targetStep: 'tagging',
        usedStarterWardrobe: true,
      })
    ).rejects.toMatchObject({ message: 'INVALID_STEP_TRANSITION' })
  })

  it('4.4-INT-05 requires If-Match and rejects a stale revision', async (context) => {
    if (!requireSchema(context)) return

    await expect(
      serviceA.advanceStep(userId, undefined, { targetStep: 'capture' })
    ).rejects.toBeInstanceOf(HttpException)

    await serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
      targetStep: 'capture',
    })

    await expect(
      serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
        targetStep: 'tagging',
      })
    ).rejects.toBeInstanceOf(PreconditionFailedException)
  })

  it('4.4-INT-06 treats an identical replay as a safe no-op that does not bump revision or telemetry', async (context) => {
    if (!requireSchema(context)) return

    await serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
      targetStep: 'capture',
    })
    const replay = await serviceA.advanceStep(userId, formatOnboardingETag(userId, 1), {
      targetStep: 'capture',
    })

    expect(replay.isNoOp).toBe(true)
    expect(replay.response.data.revision).toBe(1)

    const row = await prismaA.wardrobeOnboardingState.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.revision).toBe(1)

    const startedEvents = analyticsA.events.filter(
      (event) => (event as { event: string }).event === 'wardrobe_onboarding_started'
    )
    expect(startedEvents).toHaveLength(1)
  })

  /**
   * Risk 4.4-R02. Two concurrent first-ever PATCH calls race the "no row
   * exists yet" branch, which a plain `SELECT ... FOR UPDATE` cannot lock
   * (there is no row to lock). The advisory transaction lock is what
   * serializes them; without it both could insert and violate the unique
   * constraint, or worse, silently double-count.
   */
  it('4.4-INT-07 serializes two concurrent first-ever transitions with no lost update', async (context) => {
    if (!requireSchema(context)) return

    const results = await Promise.allSettled([
      serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
        targetStep: 'capture',
      }),
      serviceB.advanceStep(userId, formatOnboardingETag(userId, 0), {
        targetStep: 'capture',
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)

    const row = await prismaA.wardrobeOnboardingState.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.revision).toBe(1)
    expect(row.current_step).toBe('capture')

    // Regardless of how many callers "won" the no-op-replay path, the started
    // event was captured by only one underlying row creation.
    const rows = await prismaA.wardrobeOnboardingState.findMany({
      where: { user_id: userId },
    })
    expect(rows).toHaveLength(1)
  })

  /**
   * Risk 4.4-R02, existing-row variant: two callers holding the same ETag
   * race an update. Exactly one must win; the loser must see 412, and the
   * final revision must reflect exactly one applied change, never two.
   */
  it('4.4-INT-08 rejects the loser of a concurrent update against an existing row', async (context) => {
    if (!requireSchema(context)) return

    await serviceA.advanceStep(userId, formatOnboardingETag(userId, 0), {
      targetStep: 'capture',
    })

    const results = await Promise.allSettled([
      serviceA.advanceStep(userId, formatOnboardingETag(userId, 1), {
        targetStep: 'tagging',
      }),
      serviceB.advanceStep(userId, formatOnboardingETag(userId, 1), {
        targetStep: 'silhouette',
        usedStarterWardrobe: true,
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PreconditionFailedException
    )

    const row = await prismaA.wardrobeOnboardingState.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.revision).toBe(2)
  })
})
