// Story 5.4 Task 5/6: the palette advisor's single owner of PaletteProfile
// and AdvisorRecommendationState reads and writes, mirroring
// wardrobe-silhouette.service.ts's upload lifecycle shape and
// premium-theme.service.ts's flag/entitlement resolution shape.
import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { PrismaClient, type PaletteProfile } from '@prisma/client'
import {
  ADVISOR_RULES,
  advisorRecommendationCardSchema,
  type AdvisorRuleEntry,
  type AdvisorSlot,
  type CommitPaletteSelfieInput,
  type CreatePaletteSelfieUploadUrlInput,
  type CreatePaletteSelfieUploadUrlResponse,
  paletteAdvisorProfileSchema,
  paletteAnalysisSchema,
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  type PaletteAdvisorProfile,
  type SkinDepth,
  type SkinUndertone,
  type UpdateAdvisorRecommendationInput,
} from '../../contracts/http.js'
import { buildPaletteSelfieObjectPath } from '@couture/utils'
import { createBaseLogger } from '../../logger/pino.config.js'
import type { ApiRole } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { GuardianService } from '../guardian/guardian.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  GarmentImageValidationError,
  verifyGarmentImage,
  type GarmentMimeType,
} from '../wardrobe/wardrobe-image-validation.js'
import { SupabaseWardrobeStorageAdapter } from '../wardrobe/wardrobe-storage.adapter.js'
import {
  generateUploadToken,
  requireUploadTokenSecret,
  verifyUploadToken,
} from '../wardrobe/wardrobe-upload-token.js'
import { AffiliateOfferService } from './affiliate-offer.service.js'
import { PaletteAnalysisProcessingQueue } from './palette-analysis-processing.queue.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'

const UPLOAD_EXPIRY_SECONDS = 900

/**
 * Consent is current when `consent_granted_at` is set and `consent_revoked_at`
 * is null or earlier than it (Decision 5).
 */
function hasCurrentConsent(
  profile: Pick<PaletteProfile, 'consent_granted_at' | 'consent_revoked_at'> | null
): boolean {
  if (!profile?.consent_granted_at) {
    return false
  }
  if (!profile.consent_revoked_at) {
    return true
  }
  return profile.consent_revoked_at.getTime() < profile.consent_granted_at.getTime()
}

function consentAuditState(
  profile: PaletteProfile | null
): 'none' | 'granted' | 'revoked' {
  if (!profile) {
    return 'none'
  }
  return hasCurrentConsent(profile) ? 'granted' : 'revoked'
}

function deriveObjectExtension(mimeType: GarmentMimeType): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  return 'webp'
}

function mapImageValidationError(error: GarmentImageValidationError): never {
  if (
    error.code === 'IMAGE_CHECKSUM_MISMATCH' ||
    error.code === 'IMAGE_DIMENSIONS_INVALID'
  ) {
    throw new BadRequestException(error.code)
  }
  if (error.code === 'UNSUPPORTED_IMAGE_TYPE') {
    throw new UnsupportedMediaTypeException(error.code)
  }
  throw new BadRequestException('IMAGE_DECODE_FAILED')
}

type UploadUrlResult = {
  replayed: boolean
  response: CreatePaletteSelfieUploadUrlResponse
}
type CommitResult = { replayed: boolean; response: { data: PaletteAdvisorProfile } }

@Injectable()
export class PaletteAdvisorService {
  private readonly logger = createBaseLogger().child({ feature: 'palette-advisor' })
  private readonly uploadTokenSecret: string

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService,
    @Inject(FeatureFlagsService) private readonly featureFlags: FeatureFlagsService,
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(AffiliateOfferService)
    private readonly affiliateOffers: AffiliateOfferService,
    @Inject(PaletteAnalysisProcessingQueue)
    private readonly processingQueue: PaletteAnalysisProcessingQueue,
    // Constructor-injected, mirroring WardrobeSilhouetteService: it makes the
    // storage adapter substitutable in unit tests, the same reason that
    // service never instantiates it inline either.
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter
  ) {
    this.uploadTokenSecret = requireUploadTokenSecret()
  }

  // --- Reads -----------------------------------------------------------

  /**
   * Deliberately NOT entitlement- or flag-gated: every signed-in caller
   * needs an answer to render the locked or unavailable state cleanly.
   */
  async getProfile(
    userId: string,
    acceptLanguage?: string,
    requestedLocale?: string
  ): Promise<PaletteAdvisorProfile> {
    const [isEntitled, analysisEnabled, profile] = await Promise.all([
      this.entitlements.hasPremiumAccess(userId),
      this.resolveAnalysisEnabled(userId),
      this.prisma.paletteProfile.findUnique({ where: { user_id: userId } }),
    ])

    const analysis = this.toAnalysis(profile)
    const recommendations =
      analysis?.status === 'ready'
        ? await this.resolveRecommendations(
            userId,
            analysis.undertone,
            analysis.depth,
            acceptLanguage,
            requestedLocale
          )
        : []

    return paletteAdvisorProfileSchema.parse({
      profileId: profile?.id ?? null,
      isEntitled,
      analysisEnabled,
      hasConsent: hasCurrentConsent(profile),
      analysis,
      recommendations,
    })
  }

  private toAnalysis(profile: PaletteProfile | null): PaletteAdvisorProfile['analysis'] {
    if (!profile?.status) {
      return null
    }
    return paletteAnalysisSchema.parse({
      status: profile.status,
      failureReason: profile.failure_reason,
      source: profile.source,
      undertone: profile.undertone,
      depth: profile.depth,
      confidence: profile.confidence,
      analysisVersion: profile.analysis_version,
      analyzedAt: profile.analyzed_at?.toISOString() ?? null,
    })
  }

  private async resolveRecommendations(
    userId: string,
    undertone: SkinUndertone,
    depth: SkinDepth | null,
    acceptLanguage?: string,
    requestedLocale?: string
  ): Promise<PaletteAdvisorProfile['recommendations']> {
    const rules = ADVISOR_RULES[undertone]
    const foundation = depth
      ? rules.foundation.withDepth[depth]
      : rules.foundation.withoutDepth
    const cardSpecs: { slot: AdvisorSlot; entry: AdvisorRuleEntry }[] = [
      { slot: 'foundation', entry: foundation },
      { slot: 'blush', entry: rules.blush[0] },
      { slot: 'blush', entry: rules.blush[1] },
      { slot: 'jewelry', entry: rules.jewelry },
      { slot: 'bag', entry: rules.bag },
      { slot: 'eyewear', entry: rules.eyewear },
    ]

    const states = await this.prisma.advisorRecommendationState.findMany({
      where: {
        user_id: userId,
        item_key: { in: cardSpecs.map((spec) => spec.entry.itemKey) },
      },
      select: { item_key: true, action: true },
    })
    const stateByItemKey = new Map(states.map((state) => [state.item_key, state.action]))

    // Dismissed cards are omitted entirely (AC 6): they must not reappear on
    // the next read.
    const surviving = cardSpecs.filter(
      (spec) => stateByItemKey.get(spec.entry.itemKey) !== 'dismissed'
    )

    const distinctSlots = [...new Set(surviving.map((spec) => spec.slot))]
    const offers = await this.affiliateOffers.resolveAdvisorOffers({
      userId,
      slots: distinctSlots,
      undertone,
      acceptLanguage,
      requestedLocale,
    })

    return surviving.map((spec) =>
      advisorRecommendationCardSchema.parse({
        slot: spec.slot,
        itemKey: spec.entry.itemKey,
        labelKey: spec.entry.labelKey,
        swatchHex: spec.entry.swatchHex,
        saved: stateByItemKey.get(spec.entry.itemKey) === 'saved',
        sponsored: offers.get(spec.slot) ?? null,
      })
    )
  }

  private async resolveAnalysisEnabled(userId: string): Promise<boolean> {
    return Boolean(
      await this.featureFlags.getFeatureFlag('color_analysis_enabled', userId)
    )
  }

  private async assertAnalysisEnabled(userId: string): Promise<void> {
    if (!(await this.resolveAnalysisEnabled(userId))) {
      throw new ServiceUnavailableException(PALETTE_ANALYSIS_DISABLED_MESSAGE)
    }
  }

  /**
   * Precedence, stated once (Decision 10): consent is checked BEFORE the
   * flag, so an entitled-but-unconsented caller always sees
   * `PALETTE_CONSENT_REQUIRED_MESSAGE` and never observes the kill switch.
   * Returns the current row so callers do not re-query it.
   */
  private async assertConsent(userId: string): Promise<PaletteProfile> {
    const profile = await this.prisma.paletteProfile.findUnique({
      where: { user_id: userId },
    })
    if (!hasCurrentConsent(profile)) {
      throw new ForbiddenException(PALETTE_CONSENT_REQUIRED_MESSAGE)
    }
    return profile!
  }

  // --- Consent -----------------------------------------------------------

  async setConsent(userId: string, granted: boolean): Promise<PaletteAdvisorProfile> {
    await this.assertAnalysisEnabled(userId)

    if (!granted) {
      // Revoking runs the exact same erase path as DELETE (Decision 5/9).
      return this.erase(userId)
    }

    const existing = await this.prisma.paletteProfile.findUnique({
      where: { user_id: userId },
    })
    const from = consentAuditState(existing)

    await this.prisma.$transaction([
      this.prisma.paletteProfile.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          consent_granted_at: new Date(),
          consent_revoked_at: null,
        },
        update: { consent_granted_at: new Date(), consent_revoked_at: null },
      }),
      this.prisma.auditLog.create({
        data: {
          user_id: userId,
          event_type: 'palette_analysis_consent_changed',
          event_data: { from, to: 'granted', source: 'user' },
          ip_address: null,
        },
      }),
    ])

    return this.getProfile(userId)
  }

  // --- Wardrobe analysis ---------------------------------------------------

  async analyzeWardrobe(userId: string): Promise<PaletteAdvisorProfile> {
    const profile = await this.assertConsent(userId)
    await this.assertAnalysisEnabled(userId)

    if (profile.status === 'processing') {
      throw new ConflictException(PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE)
    }

    await this.prisma.paletteProfile.update({
      where: { user_id: userId },
      data: {
        source: 'wardrobe',
        status: 'processing',
        failure_reason: null,
        undertone: null,
        depth: null,
        confidence: null,
        analysis_version: null,
        analyzed_at: null,
        revision: { increment: 1 },
      },
    })

    const correlationId = randomUUID()
    try {
      await this.processingQueue.enqueue(profile.id, correlationId)
    } catch (error) {
      await this.prisma.paletteProfile
        .updateMany({
          where: { id: profile.id, status: 'processing' },
          data: { status: null, source: null },
        })
        .catch(() => undefined)
      throw error
    }

    return this.getProfile(userId)
  }

  // --- Selfie upload lifecycle, mirroring wardrobe-silhouette.service.ts ---

  async createSelfieUploadUrl(
    userId: string,
    role: ApiRole,
    input: CreatePaletteSelfieUploadUrlInput,
    idempotencyKey: string
  ): Promise<UploadUrlResult> {
    await this.assertConsent(userId)
    await this.assertAnalysisEnabled(userId)
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('palette_profile:' || ${userId}))`

      const existing = await tx.paletteProfile.findUnique({ where: { user_id: userId } })

      if (
        existing?.selfie_upload_idempotency_key === idempotencyKey &&
        existing.status === 'pending_upload'
      ) {
        if (
          !existing.selfie_upload_expires_at ||
          existing.selfie_upload_expires_at <= new Date()
        ) {
          throw new ConflictException('UPLOAD_SESSION_EXPIRED')
        }
        return {
          replayed: true,
          profile: existing,
          staleObjectPath: null as string | null,
        }
      }
      if (existing?.selfie_upload_idempotency_key === idempotencyKey) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }

      const uploadSessionId = randomUUID()
      const objectPath = buildPaletteSelfieObjectPath(
        userId,
        uploadSessionId,
        deriveObjectExtension(input.mimeType)
      )
      const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)
      const staleObjectPath =
        existing?.selfie_object_path && existing.selfie_object_path !== objectPath
          ? existing.selfie_object_path
          : null

      const updated = await tx.paletteProfile.update({
        where: { user_id: userId },
        data: {
          selfie_object_path: objectPath,
          selfie_upload_session_id: uploadSessionId,
          selfie_upload_idempotency_key: idempotencyKey,
          selfie_commit_idempotency_key: null,
          selfie_commit_payload_hash: null,
          selfie_file_size_bytes: input.fileSizeBytes,
          selfie_mime_type: input.mimeType,
          selfie_content_sha256: input.sha256,
          selfie_width_px: input.widthPx,
          selfie_height_px: input.heightPx,
          selfie_upload_expires_at: expiresAt,
          selfie_committed_at: null,
          selfie_purged_at: null,
          status: 'pending_upload',
          failure_reason: null,
        },
      })

      return { replayed: false, profile: updated, staleObjectPath }
    })

    if (outcome.staleObjectPath) {
      await this.storage.remove([outcome.staleObjectPath]).catch(() => undefined)
    }

    return {
      replayed: outcome.replayed,
      response: this.uploadUrlResponse(outcome.profile),
    }
  }

  private uploadUrlResponse(
    profile: PaletteProfile
  ): CreatePaletteSelfieUploadUrlResponse {
    if (
      !profile.selfie_upload_session_id ||
      !profile.selfie_upload_expires_at ||
      !profile.selfie_mime_type
    ) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    return {
      data: {
        uploadSessionId: profile.selfie_upload_session_id,
        uploadUrl: `${this.publicApiUrl()}/api/v1/commerce/premium/palette/selfie/uploads/${profile.selfie_upload_session_id}`,
        uploadToken: generateUploadToken(
          profile.selfie_upload_session_id,
          profile.user_id,
          profile.selfie_upload_expires_at.toISOString(),
          this.uploadTokenSecret
        ),
        requiredHeaders: { 'content-type': profile.selfie_mime_type as GarmentMimeType },
        expiresAt: profile.selfie_upload_expires_at.toISOString(),
      },
    }
  }

  private publicApiUrl(): string {
    return (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
  }

  private assertUploadableSession(
    profile: PaletteProfile | null,
    userId: string,
    uploadSessionId: string,
    uploadToken: string
  ): asserts profile is PaletteProfile {
    if (!profile) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }
    if (profile.user_id !== userId) {
      throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
    }
    if (profile.status !== 'pending_upload') {
      throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
    }
    if (
      !profile.selfie_upload_expires_at ||
      profile.selfie_upload_expires_at <= new Date()
    ) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    if (
      !verifyUploadToken(
        uploadToken,
        uploadSessionId,
        userId,
        profile.selfie_upload_expires_at.toISOString(),
        this.uploadTokenSecret
      )
    ) {
      throw new ForbiddenException('INVALID_UPLOAD_TOKEN')
    }
  }

  private resolveDeclaration(
    profile: PaletteProfile,
    mimeType: GarmentMimeType
  ): {
    fileSizeBytes: number
    mimeType: GarmentMimeType
    sha256: string
    widthPx: number
    heightPx: number
  } {
    if (
      !profile.selfie_file_size_bytes ||
      !profile.selfie_mime_type ||
      !profile.selfie_content_sha256 ||
      !profile.selfie_width_px ||
      !profile.selfie_height_px
    ) {
      throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
    }
    if (mimeType !== profile.selfie_mime_type) {
      throw new BadRequestException('INVALID_UPLOAD_BODY')
    }
    return {
      fileSizeBytes: profile.selfie_file_size_bytes,
      mimeType,
      sha256: profile.selfie_content_sha256,
      widthPx: profile.selfie_width_px,
      heightPx: profile.selfie_height_px,
    }
  }

  async uploadSelfieBytes(
    uploadSessionId: string,
    uploadToken: string,
    userId: string,
    role: ApiRole,
    mimeType: GarmentMimeType,
    contentLength: number | undefined,
    body: Buffer
  ): Promise<void> {
    await this.assertAnalysisEnabled(userId)

    const profile = await this.prisma.paletteProfile.findUnique({
      where: { selfie_upload_session_id: uploadSessionId },
    })
    this.assertUploadableSession(profile, userId, uploadSessionId, uploadToken)

    if (contentLength === undefined || contentLength !== body.length) {
      throw new BadRequestException('INVALID_UPLOAD_BODY')
    }
    const declaration = this.resolveDeclaration(profile, mimeType)

    try {
      await verifyGarmentImage(body, declaration)
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        mapImageValidationError(error)
      }
      throw error
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    await this.storage.upload(profile.selfie_object_path!, body, declaration.mimeType)

    const updated = await this.prisma.paletteProfile.updateMany({
      where: {
        id: profile.id,
        selfie_upload_session_id: uploadSessionId,
        status: 'pending_upload',
      },
      data: { status: 'bytes_uploaded' },
    })
    if (updated.count !== 1) {
      await this.storage.remove([profile.selfie_object_path!]).catch(() => undefined)
      throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
    }
  }

  async commitSelfie(
    userId: string,
    role: ApiRole,
    input: CommitPaletteSelfieInput,
    idempotencyKey: string
  ): Promise<CommitResult> {
    await this.assertConsent(userId)
    await this.assertAnalysisEnabled(userId)

    const profile = await this.prisma.paletteProfile.findUnique({
      where: { user_id: userId },
    })
    if (!profile || profile.selfie_upload_session_id !== input.uploadSessionId) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }

    if (
      profile.status === 'processing' ||
      profile.status === 'ready' ||
      profile.status === 'failed'
    ) {
      if (profile.selfie_commit_idempotency_key === idempotencyKey) {
        return { replayed: true, response: { data: await this.getProfile(userId) } }
      }
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
    }
    if (profile.status !== 'bytes_uploaded') {
      throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const updated = await this.prisma.paletteProfile.updateMany({
      where: { id: profile.id, status: 'bytes_uploaded' },
      data: {
        status: 'processing',
        source: 'selfie',
        selfie_committed_at: new Date(),
        selfie_commit_idempotency_key: idempotencyKey,
        revision: { increment: 1 },
      },
    })
    if (updated.count !== 1) {
      throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
    }

    // See wardrobe-silhouette.service.ts's commitMyForm for why the upload
    // session identity is cleared on a compensating release, not only the
    // status/commit fields: it forces a retry to reallocate a genuinely
    // fresh session (and job id) rather than recomputing an identical one
    // that BullMQ would silently no-op on.
    try {
      await this.processingQueue.enqueue(profile.id, input.uploadSessionId)
    } catch (error) {
      await this.prisma.paletteProfile
        .updateMany({
          where: { id: profile.id, status: 'processing' },
          data: {
            status: 'bytes_uploaded',
            source: null,
            selfie_committed_at: null,
            selfie_commit_idempotency_key: null,
            selfie_upload_session_id: null,
            selfie_upload_idempotency_key: null,
          },
        })
        .catch(() => undefined)
      throw error
    }

    return { replayed: false, response: { data: await this.getProfile(userId) } }
  }

  // --- Recommendations -----------------------------------------------------

  async updateRecommendation(
    userId: string,
    input: UpdateAdvisorRecommendationInput
  ): Promise<PaletteAdvisorProfile> {
    if (input.action === null) {
      await this.prisma.advisorRecommendationState.deleteMany({
        where: { user_id: userId, slot: input.slot, item_key: input.itemKey },
      })
    } else {
      await this.prisma.advisorRecommendationState.upsert({
        where: {
          user_id_slot_item_key: {
            user_id: userId,
            slot: input.slot,
            item_key: input.itemKey,
          },
        },
        create: {
          user_id: userId,
          slot: input.slot,
          item_key: input.itemKey,
          action: input.action,
        },
        update: { action: input.action },
      })
      await this.emitRecommendationActed(userId, input.slot, input.action)
    }

    return this.getProfile(userId)
  }

  private async emitRecommendationActed(
    userId: string,
    slot: AdvisorSlot,
    action: 'saved' | 'dismissed'
  ): Promise<void> {
    try {
      await this.telemetry.captureEvent(userId, 'advisor_recommendation_acted', {
        slot,
        action,
      })
    } catch (error) {
      this.logger.warn(
        { error, userId },
        'advisor_recommendation_acted telemetry emission failed (fail-open)'
      )
    }
  }

  // --- Erasure ---------------------------------------------------------

  /**
   * Decision 9: `DELETE` clears the derived scalars, revokes consent,
   * deletes `AdvisorRecommendationState` rows, purges any retained selfie
   * object, and writes the `AuditLog` row. `PaletteProfile` is one row per
   * user and is NOT deleted -- it survives with nulled scalars and a set
   * `consent_revoked_at`, so a revocation is a fact rather than an absence.
   * Deliberately NOT entitlement-gated: a lapsed subscriber must always be
   * able to erase their data (enforced by the controller mounting no
   * `PremiumEntitlementGuard` on this route).
   */
  async erase(userId: string): Promise<PaletteAdvisorProfile> {
    const existing = await this.prisma.paletteProfile.findUnique({
      where: { user_id: userId },
    })
    const from = consentAuditState(existing)
    const selfieObjectPath = existing?.selfie_object_path ?? null

    await this.prisma.$transaction([
      this.prisma.advisorRecommendationState.deleteMany({ where: { user_id: userId } }),
      this.prisma.paletteProfile.upsert({
        where: { user_id: userId },
        create: { user_id: userId, consent_revoked_at: new Date() },
        update: {
          consent_revoked_at: new Date(),
          source: null,
          undertone: null,
          depth: null,
          confidence: null,
          analysis_version: null,
          analyzed_at: null,
          status: null,
          failure_reason: null,
          selfie_object_path: null,
          selfie_upload_session_id: null,
          selfie_upload_idempotency_key: null,
          selfie_commit_idempotency_key: null,
          selfie_commit_payload_hash: null,
          selfie_file_size_bytes: null,
          selfie_mime_type: null,
          selfie_content_sha256: null,
          selfie_width_px: null,
          selfie_height_px: null,
          selfie_upload_expires_at: null,
          selfie_committed_at: null,
          selfie_purged_at: null,
          revision: { increment: 1 },
        },
      }),
      this.prisma.auditLog.create({
        data: {
          user_id: userId,
          event_type: 'palette_analysis_consent_changed',
          event_data: { from, to: 'revoked', source: 'user' },
          ip_address: null,
        },
      }),
    ])

    if (selfieObjectPath) {
      await this.storage.remove([selfieObjectPath]).catch(() => undefined)
    }

    return this.getProfile(userId)
  }
}
