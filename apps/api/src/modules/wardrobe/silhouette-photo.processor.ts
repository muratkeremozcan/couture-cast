// Story 4.4 Task 4 step 3 owner: implement the moderation-review worker consumer in apps/api/src/modules/wardrobe/silhouette-photo.processor.ts
// Story 4.4 Task 4: BullMQ processor for "My Form" photo moderation,
// mirroring wardrobe-color.processor.ts's shape.
import { type Prisma, type PrismaClient, type SilhouetteProfile } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config'
import type { SilhouettePhotoModerationEngine } from './silhouette-photo-moderation.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'
import { isOwnSessionObject } from './wardrobe-upload-paths'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { resolveGuardianConsentPolicy } from '../auth/guardian-consent-policy.js'

type ProcessableSilhouetteProfile = SilhouetteProfile & { my_form_object_path: string }

type GuardianNotificationContext = {
  guardianEmails: string[]
  teen: { email: string }
}

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

  /**
   * Every write is fenced on the session the job was enqueued for (and the processing status),
   * so a job that finishes after the member replaced the photo cannot stamp the newer session.
   */
  private processingGuard(profile: ProcessableSilhouetteProfile) {
    return {
      id: profile.id,
      user_id: profile.user_id,
      my_form_object_path: profile.my_form_object_path,
      my_form_upload_session_id: profile.my_form_upload_session_id,
      my_form_status: 'processing' as const,
    }
  }

  /**
   * `uploadSessionId` is the session the job was enqueued for, read from its deterministic job id
   * (`silhouetteSessionFromJobId`), so a job from before the payload carried it still names its
   * own. A job whose session is unknown, or is not the one the profile is processing, exits
   * without writing anything.
   */
  async process(
    silhouetteProfileId: string,
    uploadSessionId: string | null
  ): Promise<void> {
    const startedAt = Date.now()
    const profile = await this.prisma.silhouetteProfile.findUnique({
      where: { id: silhouetteProfileId },
    })
    if (!isProcessableProfile(profile)) {
      return
    }
    if (!uploadSessionId || profile.my_form_upload_session_id !== uploadSessionId) {
      // The member replaced the photo since this job was enqueued; its own job handles that.
      this.logCompletion(profile.id, startedAt, 'superseded', false)
      return
    }
    // The path column was member-writable before the 2026-11-19 revoke migration: never read
    // an object that is not this member's own My Form photo for this very session.
    if (
      !isOwnSessionObject(
        profile.my_form_object_path,
        profile.user_id,
        'silhouette',
        profile.my_form_upload_session_id
      )
    ) {
      this.logger.error({ silhouetteProfileId }, 'silhouette_object_path_not_own')
      await this.markFailed(profile.id, 'storage_error', uploadSessionId)
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

    // Read the guardian context before opening the transaction so the
    // transaction itself stays short, then commit the status flip and the
    // guardian notification together. Marking the profile `failed` in one
    // statement and notifying in a second left a window where a crash between
    // them lost the notification permanently: the retry re-reads a profile
    // whose status is no longer `processing`, returns early, and never
    // notifies. One transaction makes the retry replay both or neither.
    // Bound to a local const: TypeScript drops property narrowing inside a
    // closure, so `verdict.outcome` would widen back to include `'ready'`
    // inside the transaction callback and no longer match the failure enum.
    const failureReason = verdict.outcome
    const guardianContext =
      failureReason === 'privacy_violation'
        ? await this.loadGuardianNotificationContext(profile)
        : null

    const applied = await interactiveTransaction(this.prisma, async (tx) => {
      const result = await tx.silhouetteProfile.updateMany({
        where: this.processingGuard(profile),
        data: {
          my_form_status: 'failed',
          my_form_failure_reason: failureReason,
          my_form_moderation_flagged_at:
            failureReason === 'privacy_violation' ? new Date() : undefined,
          revision: { increment: 1 },
        },
      })
      if (result.count === 1 && guardianContext) {
        await this.writeGuardianNotification(tx, profile, guardianContext)
      }
      return result
    })
    this.logCompletion(profile.id, startedAt, failureReason, applied.count === 1)
  }

  /**
   * Decision 6 is scoped to teen actors (its literal scope): an actor with no
   * active `GuardianConsent` row gets the failure marked on the profile alone,
   * with no ModerationEvent and no notification, so this returns `null` and the
   * caller writes nothing. While guardian consent is off no row counts as active.
   */
  private async loadGuardianNotificationContext(
    profile: ProcessableSilhouetteProfile
  ): Promise<GuardianNotificationContext | null> {
    // Guardian consent off: granted rows stay for audit and reach no guardian (TEA F-3).
    if (resolveGuardianConsentPolicy() === 'off') {
      return null
    }
    const activeConsents = await this.prisma.guardianConsent.findMany({
      where: { teen_id: profile.user_id, status: 'granted', revoked_at: null },
      include: { guardian: true },
    })
    if (activeConsents.length === 0) {
      return null
    }

    const teen = await this.prisma.user.findUnique({ where: { id: profile.user_id } })
    if (!teen) {
      return null
    }

    return { guardianEmails: activeConsents.map((c) => c.guardian.email), teen }
  }

  /**
   * Decision 6: writes exactly one `ModerationEvent` and enqueues one
   * durable guardian-notification `EventEnvelope` per currently active
   * guardian, mirroring `guardian.service.ts`'s existing
   * `email.guardian-invitation` outbox pattern rather than sending email
   * synchronously. Runs inside the caller's transaction so the notification
   * and the terminal `failed` status commit atomically.
   */
  private async writeGuardianNotification(
    tx: Prisma.TransactionClient,
    profile: ProcessableSilhouetteProfile,
    context: GuardianNotificationContext
  ): Promise<void> {
    const moderationEvent = await tx.moderationEvent.create({
      data: {
        silhouette_profile_id: profile.id,
        action: 'flagged',
        reason: 'privacy_violation',
      },
    })

    const flaggedAt = new Date().toISOString()
    await tx.eventEnvelope.createMany({
      data: context.guardianEmails.map((guardianEmail) => ({
        channel: 'email.guardian-silhouette-flag',
        user_id: profile.user_id,
        payload: {
          to: guardianEmail,
          teenId: profile.user_id,
          teenEmail: context.teen.email,
          silhouetteProfileId: profile.id,
          moderationEventId: moderationEvent.id,
          reason: 'privacy_violation',
          flaggedAt,
        },
      })),
    })
  }

  /**
   * Two-argument signature, distinct from `WardrobeColorProcessor.markFailed
   * (garmentId)`: `GarmentItem.failure_code` is free-form text, this profile
   * has a closed `SilhouettePhotoFailureReason` enum (decision 5).
   */
  async markFailed(
    silhouetteProfileId: string,
    reason: 'timeout' | 'storage_error',
    uploadSessionId: string | null
  ): Promise<void> {
    // Fenced on the job's own session: retry exhaustion of an old job must not fail a newer
    // one, and a job whose session is unknown fails nothing.
    if (!uploadSessionId) return
    await this.prisma.silhouetteProfile.updateMany({
      where: {
        id: silhouetteProfileId,
        my_form_status: 'processing',
        my_form_upload_session_id: uploadSessionId,
      },
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
