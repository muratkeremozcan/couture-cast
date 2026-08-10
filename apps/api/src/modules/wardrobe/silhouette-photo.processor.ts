// Story 4.4 Task 4: BullMQ processor for "My Form" photo moderation,
// mirroring wardrobe-color.processor.ts's shape.
import { type PrismaClient, type SilhouetteProfile } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config'
import type { SilhouettePhotoModerationEngine } from './silhouette-photo-moderation.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'

type ProcessableSilhouetteProfile = SilhouetteProfile & { my_form_object_path: string }

function isProcessableProfile(
  profile: SilhouetteProfile | null
): profile is ProcessableSilhouetteProfile {
  return Boolean(profile?.my_form_object_path) && profile?.my_form_status === 'processing'
}

export class SilhouettePhotoProcessor {
  private readonly logger = createBaseLogger().child({
    feature: 'silhouette-photo-processing',
  })

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: WardrobeStorage,
    private readonly moderationEngine: SilhouettePhotoModerationEngine
  ) {}

  private processingGuard(profile: ProcessableSilhouetteProfile) {
    return {
      id: profile.id,
      user_id: profile.user_id,
      my_form_object_path: profile.my_form_object_path,
      my_form_status: 'processing' as const,
    }
  }

  async process(silhouetteProfileId: string): Promise<void> {
    const startedAt = Date.now()
    const profile = await this.prisma.silhouetteProfile.findUnique({
      where: { id: silhouetteProfileId },
    })
    if (!isProcessableProfile(profile)) {
      return
    }

    // A genuine storage/timeout fault propagates here so BullMQ's existing
    // 3-attempt exponential backoff retries the job (decision 5). This
    // deliberately does not try/catch download failures.
    const bytes = await this.storage.download(profile.my_form_object_path)

    // contrast and privacy_violation are terminal business outcomes decided
    // by the pluggable engine (decision 9), never a queue fault.
    const verdict = await this.moderationEngine.moderate(bytes)

    if (verdict.outcome === 'ready') {
      const applied = await this.prisma.silhouetteProfile.updateMany({
        where: this.processingGuard(profile),
        data: {
          my_form_status: 'ready',
          my_form_failure_reason: null,
          mode: 'my_form',
          revision: { increment: 1 },
        },
      })
      this.logCompletion(profile.id, startedAt, 'ready', applied.count === 1)
      return
    }

    const applied = await this.prisma.silhouetteProfile.updateMany({
      where: this.processingGuard(profile),
      data: {
        my_form_status: 'failed',
        my_form_failure_reason: verdict.outcome,
        my_form_moderation_flagged_at:
          verdict.outcome === 'privacy_violation' ? new Date() : undefined,
        revision: { increment: 1 },
      },
    })
    this.logCompletion(profile.id, startedAt, verdict.outcome, applied.count === 1)

    if (verdict.outcome === 'privacy_violation' && applied.count === 1) {
      await this.notifyGuardiansOfPrivacyViolation(profile)
    }
  }

  /**
   * Decision 6: writes exactly one `ModerationEvent` and enqueues one
   * durable guardian-notification `EventEnvelope` per currently active
   * guardian, mirroring `guardian.service.ts`'s existing
   * `email.guardian-invitation` outbox pattern rather than sending email
   * synchronously. Scoped to teen actors only (decision 6's literal scope):
   * an actor with no active `GuardianConsent` row gets the failure marked on
   * the profile alone, with no ModerationEvent or notification.
   */
  private async notifyGuardiansOfPrivacyViolation(
    profile: ProcessableSilhouetteProfile
  ): Promise<void> {
    const activeConsents = await this.prisma.guardianConsent.findMany({
      where: { teen_id: profile.user_id, status: 'granted', revoked_at: null },
      include: { guardian: true },
    })
    if (activeConsents.length === 0) {
      return
    }

    const teen = await this.prisma.user.findUnique({ where: { id: profile.user_id } })
    if (!teen) {
      return
    }

    await this.prisma.$transaction(async (tx) => {
      const moderationEvent = await tx.moderationEvent.create({
        data: {
          silhouette_profile_id: profile.id,
          action: 'flagged',
          reason: 'privacy_violation',
        },
      })

      for (const consent of activeConsents) {
        await tx.eventEnvelope.create({
          data: {
            channel: 'email.guardian-silhouette-flag',
            user_id: profile.user_id,
            payload: {
              to: consent.guardian.email,
              teenId: profile.user_id,
              teenEmail: teen.email,
              silhouetteProfileId: profile.id,
              moderationEventId: moderationEvent.id,
              reason: 'privacy_violation',
              flaggedAt: new Date().toISOString(),
            },
          },
        })
      }
    })
  }

  /**
   * Two-argument signature, distinct from `WardrobeColorProcessor.markFailed
   * (garmentId)`: `GarmentItem.failure_code` is free-form text, this profile
   * has a closed `SilhouettePhotoFailureReason` enum (decision 5).
   */
  async markFailed(
    silhouetteProfileId: string,
    reason: 'timeout' | 'storage_error'
  ): Promise<void> {
    await this.prisma.silhouetteProfile.updateMany({
      where: { id: silhouetteProfileId, my_form_status: 'processing' },
      data: {
        my_form_status: 'failed',
        my_form_failure_reason: reason,
        revision: { increment: 1 },
      },
    })
  }

  private logCompletion(
    silhouetteProfileId: string,
    startedAt: number,
    outcome: string,
    applied: boolean
  ): void {
    const logContext = {
      applied,
      durationMs: Date.now() - startedAt,
      outcome,
      silhouetteProfileId,
    }
    if (applied) {
      this.logger.info(logContext, 'Silhouette photo processing completed')
    } else {
      this.logger.warn(logContext, 'Silhouette photo processing completed')
    }
  }
}
