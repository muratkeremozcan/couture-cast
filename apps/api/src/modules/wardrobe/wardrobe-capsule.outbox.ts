import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  InjectAnalyticsClient,
  type AnalyticsCaptureEvent,
  type AnalyticsClient,
} from '../../analytics/analytics.service.js'
import { createBaseLogger } from '../../logger/pino.config.js'

export type CapsuleMutationEventName =
  | 'wardrobe_capsule_created'
  | 'wardrobe_capsule_updated'
  | 'wardrobe_capsule_favorite_changed'
  | 'wardrobe_capsule_deleted'

export interface CapsuleClaimDescriptor {
  ownerUserId: string
  capsuleId: string
  /** The committed revision. For a delete this is the final accepted revision. */
  revision: number
  eventName: CapsuleMutationEventName
}

/**
 * Identifies one logical analytics event. The database unique constraint on this
 * value is what makes delivery exactly-once: a retry or a concurrent caller
 * producing the same key cannot create a second claim.
 */
export function buildMutationKey(descriptor: CapsuleClaimDescriptor): string {
  return `${descriptor.capsuleId}:${descriptor.revision}:${descriptor.eventName}`
}

const MAX_SWEEP_BATCH = 100

/**
 * Durable telemetry for capsule mutations.
 *
 * The claim row is written inside the mutation transaction by the repository, so
 * it commits atomically with the state change it describes. Delivery happens
 * after commit and is deliberately fail-open: a failed dispatch is logged and
 * left undelivered for {@link sweepUndelivered} to retry, and never changes the
 * CRUD response the caller already earned.
 *
 * No-op patches, no-op favorite requests, stale preconditions, and idempotent
 * creation replays never reach the repository write path, so they never produce
 * a claim.
 */
@Injectable()
export class CapsuleTelemetryOutbox {
  private readonly logger = createBaseLogger().child({
    feature: 'wardrobe-capsule-outbox',
  })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient
  ) {}

  /**
   * Persists the claim. Called by the repository from inside the mutation
   * transaction, so the claim and the state change share a fate.
   */
  static async persistClaim(
    tx: Prisma.TransactionClient,
    descriptor: CapsuleClaimDescriptor,
    payload: Prisma.InputJsonObject
  ): Promise<void> {
    await tx.capsuleTelemetryClaim.create({
      data: {
        user_id: descriptor.ownerUserId,
        capsule_id: descriptor.capsuleId,
        revision: descriptor.revision,
        event_name: descriptor.eventName,
        mutation_key: buildMutationKey(descriptor),
        payload,
      },
    })
  }

  /**
   * Delivers a single claim immediately after its transaction committed. Any
   * failure is swallowed after logging; the claim stays undelivered and the
   * sweeper picks it up.
   */
  async dispatchAfterCommit(descriptor: CapsuleClaimDescriptor): Promise<void> {
    const mutationKey = buildMutationKey(descriptor)

    try {
      const claim = await this.prisma.capsuleTelemetryClaim.findUnique({
        where: { mutation_key: mutationKey },
      })

      if (!claim || claim.delivered_at !== null) {
        return
      }

      await this.deliver(claim.id, mutationKey, claim.payload)
    } catch (error: unknown) {
      this.logger.error(
        {
          mutationKey,
          message: 'capsule_telemetry_dispatch_failed',
          error: error instanceof Error ? error.message : 'unknown error',
        },
        'Capsule telemetry dispatch failed; claim remains durable for retry'
      )
    }
  }

  /**
   * Retries claims that were never delivered. Intended for a scheduled sweep so
   * a process killed between commit and delivery still emits its events.
   */
  async sweepUndelivered(
    limit = MAX_SWEEP_BATCH
  ): Promise<{ delivered: number; failed: number }> {
    const pending = await this.prisma.capsuleTelemetryClaim.findMany({
      where: { delivered_at: null },
      orderBy: { claimed_at: 'asc' },
      take: Math.min(limit, MAX_SWEEP_BATCH),
    })

    let delivered = 0
    let failed = 0

    for (const claim of pending) {
      const ok = await this.deliver(claim.id, claim.mutation_key, claim.payload)
      if (ok) {
        delivered += 1
      } else {
        failed += 1
      }
    }

    return { delivered, failed }
  }

  private async deliver(
    claimId: string,
    mutationKey: string,
    payload: Prisma.JsonValue
  ): Promise<boolean> {
    try {
      this.analyticsClient.capture(payload as unknown as AnalyticsCaptureEvent)

      await this.prisma.capsuleTelemetryClaim.update({
        where: { id: claimId },
        data: { delivered_at: new Date(), last_error: null },
      })
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error'

      this.logger.error(
        { mutationKey, message: 'capsule_telemetry_delivery_failed', error: message },
        'Capsule telemetry delivery failed; will retry from the durable claim'
      )

      await this.prisma.capsuleTelemetryClaim
        .update({
          where: { id: claimId },
          data: { attempts: { increment: 1 }, last_error: message.slice(0, 500) },
        })
        .catch(() => {
          // Recording the failure is best effort; the claim already survives.
        })

      return false
    }
  }
}
