// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off their mock object, which is the established pattern for these suites. */
import type { Prisma, PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
import {
  buildMutationKey,
  CapsuleTelemetryOutbox,
  type CapsuleClaimDescriptor,
} from './wardrobe-capsule.outbox.js'

const descriptor: CapsuleClaimDescriptor = {
  ownerUserId: 'user-1',
  capsuleId: 'capsule-1',
  revision: 4,
  eventName: 'wardrobe_capsule_updated',
}

const MUTATION_KEY = 'capsule-1:4:wardrobe_capsule_updated'

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claim-1',
    mutation_key: MUTATION_KEY,
    delivered_at: null,
    payload: { event: 'wardrobe_capsule_updated' },
    ...overrides,
  }
}

function createHarness() {
  const capsuleTelemetryClaim = {
    create: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(claimRow()),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  }
  const analyticsClient = { capture: vi.fn() } as unknown as AnalyticsClient
  const prisma = { capsuleTelemetryClaim } as unknown as PrismaClient

  return {
    capsuleTelemetryClaim,
    analyticsClient,
    outbox: new CapsuleTelemetryOutbox(prisma, analyticsClient),
  }
}

describe('buildMutationKey', () => {
  /**
   * The unique constraint on this value is what makes delivery exactly-once, so
   * two different events for the same revision must not collapse into one key.
   */
  it('identifies a claim by capsule, revision, and event', () => {
    expect(buildMutationKey(descriptor)).toBe(MUTATION_KEY)
    expect(
      buildMutationKey({ ...descriptor, eventName: 'wardrobe_capsule_deleted' })
    ).not.toBe(MUTATION_KEY)
  })
})

describe('CapsuleTelemetryOutbox.persistClaim', () => {
  it('writes the claim through the caller transaction so it shares its fate', async () => {
    const create = vi.fn()
    const tx = {
      capsuleTelemetryClaim: { create },
    } as unknown as Prisma.TransactionClient

    await CapsuleTelemetryOutbox.persistClaim(tx, descriptor, {
      event: 'wardrobe_capsule_updated',
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        user_id: 'user-1',
        capsule_id: 'capsule-1',
        revision: 4,
        event_name: 'wardrobe_capsule_updated',
        mutation_key: MUTATION_KEY,
        payload: { event: 'wardrobe_capsule_updated' },
      },
    })
  })
})

describe('CapsuleTelemetryOutbox', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    harness = createHarness()
  })

  describe('dispatchAfterCommit', () => {
    it('captures the claimed payload and marks it delivered', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness

      await outbox.dispatchAfterCommit(descriptor)

      expect(analyticsClient.capture).toHaveBeenCalledWith({
        event: 'wardrobe_capsule_updated',
      })
      expect(capsuleTelemetryClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: { delivered_at: expect.any(Date) as unknown, last_error: null },
      })
    })

    /** A redelivery attempt must not emit the same analytics event twice. */
    it('emits nothing when the claim was already delivered', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness
      capsuleTelemetryClaim.findUnique.mockResolvedValue(
        claimRow({ delivered_at: new Date() })
      )

      await outbox.dispatchAfterCommit(descriptor)

      expect(analyticsClient.capture).not.toHaveBeenCalled()
      expect(capsuleTelemetryClaim.update).not.toHaveBeenCalled()
    })

    /** No-op patches and idempotent replays never write a claim. */
    it('emits nothing when no claim exists for the descriptor', async () => {
      const { outbox, analyticsClient } = harness
      harness.capsuleTelemetryClaim.findUnique.mockResolvedValue(null)

      await outbox.dispatchAfterCommit(descriptor)

      expect(analyticsClient.capture).not.toHaveBeenCalled()
    })

    /**
     * Delivery is deliberately fail-open: the caller already earned its CRUD
     * response, and the durable claim is what guarantees eventual delivery.
     */
    it('swallows a database failure while looking the claim up', async () => {
      const { outbox } = harness
      harness.capsuleTelemetryClaim.findUnique.mockRejectedValue(new Error('db down'))

      await expect(outbox.dispatchAfterCommit(descriptor)).resolves.toBeUndefined()
    })

    it('leaves the claim undelivered and records the error when capture throws', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness
      vi.mocked(analyticsClient.capture).mockImplementation(() => {
        throw new Error('posthog unreachable')
      })

      await expect(outbox.dispatchAfterCommit(descriptor)).resolves.toBeUndefined()

      expect(capsuleTelemetryClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: {
          attempts: { increment: 1 },
          last_error: 'posthog unreachable',
        },
      })
    })

    /** Recording the failure is best effort; the claim already survives. */
    it('stays silent when even recording the delivery failure fails', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness
      vi.mocked(analyticsClient.capture).mockImplementation(() => {
        throw new Error('posthog unreachable')
      })
      capsuleTelemetryClaim.update.mockRejectedValue(new Error('db down'))

      await expect(outbox.dispatchAfterCommit(descriptor)).resolves.toBeUndefined()
    })

    /** `last_error` is a bounded column; an enormous provider message must not overflow it. */
    it('truncates an oversized provider error before storing it', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness
      vi.mocked(analyticsClient.capture).mockImplementation(() => {
        throw new Error('x'.repeat(900))
      })

      await outbox.dispatchAfterCommit(descriptor)

      const data = capsuleTelemetryClaim.update.mock.calls[0]?.[0] as {
        data: { last_error: string }
      }
      expect(data.data.last_error).toHaveLength(500)
    })

    /** A thrown non-Error must still produce a storable reason. */
    it('records a non-Error rejection with a fallback reason', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness
      vi.mocked(analyticsClient.capture).mockImplementation(() => {
        // Throwing a non-Error is precisely the case this test pins down.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string failure'
      })

      await outbox.dispatchAfterCommit(descriptor)

      expect(capsuleTelemetryClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ last_error: 'unknown error' }) as unknown,
        })
      )
    })
  })

  describe('sweepUndelivered', () => {
    it('delivers every pending claim and reports the tally', async () => {
      const { outbox, capsuleTelemetryClaim } = harness
      capsuleTelemetryClaim.findMany.mockResolvedValue([
        claimRow({ id: 'claim-1' }),
        claimRow({ id: 'claim-2' }),
      ])

      await expect(outbox.sweepUndelivered()).resolves.toEqual({
        delivered: 2,
        failed: 0,
      })
      expect(capsuleTelemetryClaim.findMany).toHaveBeenCalledWith({
        where: { delivered_at: null },
        orderBy: { claimed_at: 'asc' },
        take: 100,
      })
    })

    /** A sweep that hits a dead provider must report failures, not crash the job. */
    it('counts failures separately and keeps sweeping', async () => {
      const { outbox, analyticsClient, capsuleTelemetryClaim } = harness
      capsuleTelemetryClaim.findMany.mockResolvedValue([
        claimRow({ id: 'claim-1' }),
        claimRow({ id: 'claim-2' }),
      ])
      vi.mocked(analyticsClient.capture)
        .mockImplementationOnce(() => {
          throw new Error('posthog unreachable')
        })
        .mockImplementationOnce(() => undefined)

      await expect(outbox.sweepUndelivered()).resolves.toEqual({
        delivered: 1,
        failed: 1,
      })
    })

    /** An unbounded sweep would load the entire backlog into memory. */
    it('caps the batch at the sweep maximum however large a limit is requested', async () => {
      const { outbox, capsuleTelemetryClaim } = harness

      await outbox.sweepUndelivered(5_000)

      expect(capsuleTelemetryClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      )
    })

    it('honours a smaller requested limit', async () => {
      const { outbox, capsuleTelemetryClaim } = harness

      await outbox.sweepUndelivered(10)

      expect(capsuleTelemetryClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      )
    })
  })
})
