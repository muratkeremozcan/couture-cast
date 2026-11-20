// Story 5.4 Task 5 step 1 owner: own consent, wardrobe analysis, recommendation state, offer resolution and erasure in `apps/api/src/modules/commerce/palette-advisor.service.ts`
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
  UnprocessableEntityException,
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
import {
  buildPaletteSelfieObjectPath,
  buildWardrobeStagingObjectPath,
  isWardrobePathSegment,
} from '@couture/utils'
import { createBaseLogger } from '../../logger/pino.config.js'
import type { ApiRole } from '../auth/security.types.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { GuardianService } from '../guardian/guardian.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  GarmentImageValidationError,
  MAX_GARMENT_IMAGE_BYTES,
  verifyGarmentImage,
  type GarmentMimeType,
} from '../wardrobe/wardrobe-image-validation.js'
import { WardrobeObjectDeletionOutbox } from '../wardrobe/wardrobe-object-deletion.outbox.js'
import {
  SupabaseWardrobeStorageAdapter,
  type WardrobeUploadSession,
} from '../wardrobe/wardrobe-storage.adapter.js'
import {
  logUntrustedUploadSession,
  objectExtensionFor,
  ownSessionObjectsToRemove,
  uploadPathInvalid,
  uploadSessionKeys,
  type UploadSessionKeys,
} from '../wardrobe/wardrobe-upload-paths.js'
import {
  ambiguousPublicationHorizon,
  nextCleanupHorizon,
  staleClaimCutoff,
  unfinishedPublicationDeadline,
  uploadInProgress,
  type PublicationClaim,
} from '../wardrobe/wardrobe-publication.js'
import { handOffPaletteAnalysis } from '../wardrobe/wardrobe-processing-handoff.js'
import { AffiliateOfferService } from './affiliate-offer.service.js'
import { PaletteAnalysisProcessingQueue } from './palette-analysis-processing.queue.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

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

/**
 * The session's staging and final keys, derived from the row's own ids and checked against the
 * stored path; a row that fails is answered as an expired session before any storage call.
 */
function selfieKeys(profile: PaletteProfile, operation: string): UploadSessionKeys {
  const keys = uploadSessionKeys({
    kind: 'palette',
    userId: profile.user_id,
    objectId: profile.selfie_upload_session_id,
    uploadSessionId: profile.selfie_upload_session_id,
    mimeType: profile.selfie_mime_type,
    storedObjectPath: profile.selfie_object_path,
  })
  if (!keys) {
    logUntrustedUploadSession({ operation, kind: 'palette', rowId: profile.id })
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
  return keys
}

/**
 * Every object a replaced or erased selfie can leave: the member's own final selfie and the
 * session's staging key, each only when the row's ids can vouch for it.
 */
function selfieObjectsToRemove(profile: PaletteProfile | null): string[] {
  if (!profile) return []
  return ownSessionObjectsToRemove({
    kind: 'palette',
    rowId: profile.id,
    userId: profile.user_id,
    uploadSessionId: profile.selfie_upload_session_id,
    mimeType: profile.selfie_mime_type,
    storedObjectPath: profile.selfie_object_path,
  })
}

/**
 * Serializes every selfie lifecycle change of one member: allocation, replacement and erasure.
 * The profile row is locked too: a commit claims its publication with a row update, so that
 * claim either landed before the caller reads the row (and is seen) or waits until the caller's
 * transaction ends.
 */
async function lockPaletteProfile(
  tx: Parameters<Parameters<typeof interactiveTransaction>[1]>[0],
  userId: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('palette_profile:' || ${userId}))`
  await tx.$queryRaw`SELECT 1 FROM "PaletteProfile" WHERE user_id = ${userId} FOR UPDATE`
}

/**
 * When a commit of the profile's current selfie session still owns its publication: the moment
 * its lease runs out, or null. Replacement and erasure that meet one record the session's keys
 * for then, so a publish that lands late is removed after it lands.
 */
function selfiePublishDeadline(profile: PaletteProfile | null): Date | null {
  if (!profile) return null
  return unfinishedPublicationDeadline(selfiePublicationClaim(profile))
}

function selfiePublicationClaim(profile: PaletteProfile): PublicationClaim {
  return {
    attemptId: profile.selfie_publish_attempt_id,
    startedAt: profile.selfie_publish_started_at,
    cleanupUntil: profile.selfie_publish_cleanup_until,
    committable:
      profile.status === 'pending_upload' || profile.status === 'bytes_uploaded',
  }
}

/**
 * Until when the keys of a selfie session that a commit may still be publishing must be removed
 * again and again (see `ambiguousPublicationHorizon`), or null when no publication is in flight.
 */
function selfieRemovalHorizon(profile: PaletteProfile | null): Date | null {
  if (!profile) return null
  return ambiguousPublicationHorizon(selfiePublicationClaim(profile))
}

/** The selfie columns a cleared upload session holds. */
const CLEARED_SELFIE_SESSION = {
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
  selfie_publish_attempt_id: null,
  selfie_publish_started_at: null,
  // Reset with the session: whoever clears it recorded the old keys' repeating removal first.
  selfie_publish_cleanup_until: null,
}

/**
 * `pending_upload` until commit finds the bytes the client PUT to storage; `bytes_uploaded` is a
 * session whose bytes went through the retired API relay before this deploy.
 */
function assertCommittableSelfie(profile: PaletteProfile): void {
  if (profile.status !== 'pending_upload' && profile.status !== 'bytes_uploaded') {
    throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
  }
  if (
    profile.status === 'pending_upload' &&
    (!profile.selfie_upload_expires_at || profile.selfie_upload_expires_at <= new Date())
  ) {
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
}

function mapImageValidationError(error: GarmentImageValidationError): never {
  if (error.code === 'IMAGE_SIZE_MISMATCH') {
    throw new UnprocessableEntityException(error.code)
  }
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
  private readonly deletions: WardrobeObjectDeletionOutbox

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
    this.deletions = new WardrobeObjectDeletionOutbox(prisma, storage)
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

    await interactiveTransaction(this.prisma, async (tx) => {
      await tx.paletteProfile.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          consent_granted_at: new Date(),
          consent_revoked_at: null,
        },
        update: { consent_granted_at: new Date(), consent_revoked_at: null },
      })
      await tx.auditLog.create({
        data: {
          user_id: userId,
          event_type: 'palette_analysis_consent_changed',
          event_data: { from, to: 'granted', source: 'user' },
          ip_address: null,
        },
      })
    })

    return this.getProfile(userId)
  }

  // --- Wardrobe analysis ---------------------------------------------------

  async analyzeWardrobe(userId: string): Promise<PaletteAdvisorProfile> {
    // Early answers for the common refusals; both are checked again under the lock below.
    await this.assertConsent(userId)
    await this.assertAnalysisEnabled(userId)

    // This analysis's own attempt: its job id is `<profileId>__<attempt>`, its worker writes are
    // fenced on it, and the rollback below releases only it.
    const analysisAttemptId = randomUUID()
    // Claimed under the per-member lock erasure and selfie allocation take, from the row as it
    // stands then: an erasure that finished during the feature check has revoked consent, and a
    // selfie commit that reached processing meanwhile owns the profile. A selfie session that
    // has not reached processing is superseded, and its keys are recorded for removal under that
    // session's own identity, repeating while its publication may still write.
    const claim = await interactiveTransaction(this.prisma, async (tx) => {
      await lockPaletteProfile(tx, userId)
      const current = await tx.paletteProfile.findUnique({ where: { user_id: userId } })
      if (!current || !hasCurrentConsent(current)) {
        throw new ForbiddenException(PALETTE_CONSENT_REQUIRED_MESSAGE)
      }
      if (current.status === 'processing') {
        throw new ConflictException(PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE)
      }
      // Final review F-6: any selfie session the row still carries is superseded, a finished
      // one included (its purge may still be repeating until the session's horizon). Its keys'
      // removal is recorded under its own identity here, before the session is cleared, so the
      // obligation never depends on the profile staying a selfie analysis, and an enqueue
      // failure that rolls this analysis back cannot lose it.
      const supersedesSelfie =
        current.status === 'pending_upload' ||
        current.status === 'bytes_uploaded' ||
        current.selfie_upload_session_id !== null ||
        current.selfie_object_path !== null
      const selfieObjectPaths = supersedesSelfie ? selfieObjectsToRemove(current) : []
      const removalHorizon = supersedesSelfie ? selfieRemovalHorizon(current) : null

      const claimed = await tx.paletteProfile.updateMany({
        where: { id: current.id, status: current.status, revision: current.revision },
        data: {
          ...(supersedesSelfie ? CLEARED_SELFIE_SESSION : {}),
          source: 'wardrobe',
          status: 'processing',
          analysis_attempt_id: analysisAttemptId,
          processing_job_enqueued_at: null,
          failure_reason: null,
          undertone: null,
          depth: null,
          confidence: null,
          analysis_version: null,
          analyzed_at: null,
          revision: { increment: 1 },
        },
      })
      if (claimed.count !== 1) {
        throw new ConflictException(PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE)
      }
      await this.recordSelfieRemoval(
        tx,
        selfieObjectPaths,
        'selfie_superseded',
        removalHorizon
      )
      return { profileId: current.id, selfieObjectPaths }
    })
    await this.deletions.removeNow(claim.selfieObjectPaths)
    const profile = { id: claim.profileId }

    try {
      await this.processingQueue.enqueue(profile.id, analysisAttemptId)
    } catch (error) {
      await this.prisma.paletteProfile
        .updateMany({
          // This analysis only: a selfie commit or another analysis since then owns the row.
          where: {
            id: profile.id,
            status: 'processing',
            source: 'wardrobe',
            analysis_attempt_id: analysisAttemptId,
          },
          data: { status: null, source: null, analysis_attempt_id: null },
        })
        .catch(() => undefined)
      throw error
    }
    await this.prisma.paletteProfile.updateMany({
      where: {
        id: profile.id,
        status: 'processing',
        analysis_attempt_id: analysisAttemptId,
        processing_job_enqueued_at: null,
      },
      data: { processing_job_enqueued_at: new Date() },
    })

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

    // Signed before the transaction: a storage failure must fail before the current selfie is
    // replaced and removed. A replay leaves this one unused and signs its own key below.
    if (!isWardrobePathSegment(userId)) {
      throw uploadPathInvalid({ operation: 'allocate', kind: 'palette', rowId: userId })
    }
    const uploadSessionId = randomUUID()
    const extension = objectExtensionFor(input.mimeType)
    const objectPath = buildPaletteSelfieObjectPath(userId, uploadSessionId, extension)
    const freshSession = await this.storage.createUploadSession(
      buildWardrobeStagingObjectPath(userId, 'palette', uploadSessionId, extension)
    )

    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      await lockPaletteProfile(tx, userId)

      const existing = await tx.paletteProfile.findUnique({ where: { user_id: userId } })
      // Re-checked under the lock erasure takes: an erasure that ran since the check above has
      // revoked consent, and a session written now would outlive it.
      if (!hasCurrentConsent(existing)) {
        throw new ForbiddenException(PALETTE_CONSENT_REQUIRED_MESSAGE)
      }

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
          staleObjectPaths: [] as string[],
        }
      }
      if (existing?.selfie_upload_idempotency_key === idempotencyKey) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }

      const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)
      const staleObjectPaths = selfieObjectsToRemove(existing)
      const removalHorizon = selfieRemovalHorizon(existing)

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
          selfie_publish_attempt_id: null,
          selfie_publish_started_at: null,
          // A new session starts with no horizon; the replaced session's keys repeat below.
          selfie_publish_cleanup_until: null,
          status: 'pending_upload',
          failure_reason: null,
        },
      })

      // Recorded with the replacement, so a failed removal is retried instead of forgotten. A
      // publication still in flight for the replaced session may land later: its keys are
      // removed now and again until the horizon.
      await this.recordSelfieRemoval(
        tx,
        staleObjectPaths,
        'selfie_replaced',
        removalHorizon
      )

      return { replayed: false, profile: updated, staleObjectPaths }
    })

    await this.deletions.removeNow(outcome.staleObjectPaths)

    return {
      replayed: outcome.replayed,
      response: await this.uploadUrlResponse(
        outcome.profile,
        outcome.replayed ? null : freshSession
      ),
    }
  }

  /**
   * A storage signed upload URL for the session's staging key. A replayed allocation is signed
   * afresh, so it gets a live URL for the same key. The client is told the shorter of the
   * session and the token.
   */
  private async uploadUrlResponse(
    profile: PaletteProfile,
    signed: WardrobeUploadSession | null
  ): Promise<CreatePaletteSelfieUploadUrlResponse> {
    if (
      !profile.selfie_upload_session_id ||
      !profile.selfie_upload_expires_at ||
      !profile.selfie_mime_type
    ) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    const keys = selfieKeys(profile, 'allocate')
    const session = signed ?? (await this.storage.createUploadSession(keys.stagingPath))
    const expiresAt = Math.min(
      profile.selfie_upload_expires_at.getTime(),
      session.tokenExpiresAt.getTime()
    )
    return {
      data: {
        uploadSessionId: profile.selfie_upload_session_id,
        uploadUrl: session.uploadUrl,
        uploadToken: session.uploadToken,
        requiredHeaders: { 'content-type': profile.selfie_mime_type as GarmentMimeType },
        expiresAt: new Date(expiresAt).toISOString(),
      },
    }
  }

  private resolveDeclaration(profile: PaletteProfile): {
    fileSizeBytes: number
    mimeType: GarmentMimeType
    sha256: string
    widthPx: number
    heightPx: number
  } {
    if (
      !profile.selfie_object_path ||
      !profile.selfie_file_size_bytes ||
      !profile.selfie_mime_type ||
      !profile.selfie_content_sha256 ||
      !profile.selfie_width_px ||
      !profile.selfie_height_px
    ) {
      throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
    }
    return {
      fileSizeBytes: profile.selfie_file_size_bytes,
      mimeType: profile.selfie_mime_type as GarmentMimeType,
      sha256: profile.selfie_content_sha256,
      widthPx: profile.selfie_width_px,
      heightPx: profile.selfie_height_px,
    }
  }

  /**
   * Clients PUT the bytes straight to storage, so commit is where they are checked: the uploaded
   * object must match the declared size, sniffed type, sha256 and dimensions. It is read through
   * a hard ceiling. A mismatch is removed and the session ends, so a correction needs a fresh
   * allocation and a fresh key. Returns the verified bytes.
   */
  private async verifyStoredSelfie(
    profile: PaletteProfile,
    objectPath: string,
    publishAttemptId: string
  ): Promise<Buffer> {
    const declaration = this.resolveDeclaration(profile)
    const stored = await this.storage.downloadBounded(objectPath, MAX_GARMENT_IMAGE_BYTES)
    if (stored.status === 'missing') {
      throw new ConflictException('UPLOAD_BYTES_MISSING')
    }
    try {
      if (stored.status === 'too_large') {
        throw new GarmentImageValidationError('IMAGE_SIZE_MISMATCH')
      }
      await verifyGarmentImage(stored.bytes, declaration)
      return stored.bytes
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        // A claim this attempt took over may have started a write of the final key that can
        // still land; the cleared session takes its horizon with it, so its keys repeat here.
        const earlierHorizon = selfieRemovalHorizon(profile)
        const repeatingPaths = earlierHorizon ? selfieObjectsToRemove(profile) : []
        await interactiveTransaction(this.prisma, async (tx) => {
          const rejected = await tx.paletteProfile.updateMany({
            where: {
              id: profile.id,
              selfie_upload_session_id: profile.selfie_upload_session_id,
              selfie_publish_attempt_id: publishAttemptId,
              status: { in: ['pending_upload', 'bytes_uploaded'] },
            },
            data: { ...CLEARED_SELFIE_SESSION, status: null, failure_reason: null },
          })
          await this.deletions.record(tx, [objectPath], 'upload_rejected')
          if (rejected.count === 1 && earlierHorizon) {
            await this.deletions.recordRepeating(
              tx,
              repeatingPaths,
              'upload_rejected',
              earlierHorizon
            )
          }
        })
        await this.deletions.removeNow([objectPath, ...repeatingPaths])
        mapImageValidationError(error)
      }
      throw error
    }
  }

  /** See WardrobeSilhouetteService.placeVerifiedMyForm. */
  private async placeVerifiedSelfie(
    profile: PaletteProfile,
    keys: UploadSessionKeys,
    fromStaging: boolean,
    publishAttemptId: string
  ): Promise<void> {
    let publishStarted = false
    try {
      if (!fromStaging) {
        await this.verifyStoredSelfie(profile, keys.finalPath, publishAttemptId)
        return
      }
      const bytes = await this.verifyStoredSelfie(
        profile,
        keys.stagingPath,
        publishAttemptId
      )
      publishStarted = true
      await this.storage.publish(
        keys.finalPath,
        bytes,
        profile.selfie_mime_type as GarmentMimeType
      )
    } catch (error) {
      // Released only when no write of the final key was started; see placeVerifiedMyForm.
      if (!publishStarted)
        await this.releaseSelfiePublication(profile.id, publishAttemptId)
      throw error
    }
  }

  /** See WardrobeSilhouetteService.claimMyFormPublication. */
  private async claimSelfiePublication(
    profile: PaletteProfile,
    attemptId: string
  ): Promise<boolean> {
    const now = new Date()
    const claimed = await this.prisma.paletteProfile.updateMany({
      where: {
        id: profile.id,
        selfie_upload_session_id: profile.selfie_upload_session_id,
        OR: [
          { status: 'pending_upload', selfie_upload_expires_at: { gt: now } },
          { status: 'bytes_uploaded' },
        ],
        AND: [
          {
            OR: [
              { selfie_publish_attempt_id: null },
              { selfie_publish_started_at: null },
              { selfie_publish_started_at: { lt: staleClaimCutoff(now) } },
            ],
          },
        ],
      },
      // The cleanup horizon is recorded with the claim, before any storage I/O, and outlives
      // the lease, a takeover and success; see `ambiguousPublicationHorizon`.
      data: {
        selfie_publish_attempt_id: attemptId,
        selfie_publish_started_at: now,
        selfie_publish_cleanup_until: nextCleanupHorizon(
          profile.selfie_publish_cleanup_until,
          now
        ),
      },
    })
    return claimed.count === 1
  }

  private async releaseSelfiePublication(
    profileId: string,
    attemptId: string
  ): Promise<void> {
    await this.prisma.paletteProfile
      .updateMany({
        where: { id: profileId, selfie_publish_attempt_id: attemptId },
        data: { selfie_publish_attempt_id: null, selfie_publish_started_at: null },
      })
      .catch(() => undefined)
  }

  /** See WardrobeSilhouetteService.resolveUnclaimedMyForm. */
  private async resolveUnclaimedSelfie(
    profileId: string,
    userId: string,
    input: CommitPaletteSelfieInput,
    idempotencyKey: string
  ): Promise<CommitResult> {
    const current = await this.prisma.paletteProfile.findUnique({
      where: { id: profileId },
    })
    if (current?.selfie_upload_session_id === input.uploadSessionId) {
      if (
        current.status === 'processing' ||
        current.status === 'ready' ||
        current.status === 'failed'
      ) {
        return this.replayCommittedSelfie(current, userId, idempotencyKey)
      }
      if (selfiePublishDeadline(current)) throw uploadInProgress()
    }
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }

  /** A commit of a session already past commit: same key replays, any other is refused. */
  private async replayCommittedSelfie(
    profile: PaletteProfile,
    userId: string,
    idempotencyKey: string
  ): Promise<CommitResult> {
    if (profile.selfie_commit_idempotency_key !== idempotencyKey) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
    }
    if (profile.status === 'processing') {
      await handOffPaletteAnalysis(this.prisma, this.processingQueue, profile)
    }
    return { replayed: true, response: { data: await this.getProfile(userId) } }
  }

  /** See WardrobeSilhouetteService.resolveLostMyFormClaim. */
  private async resolveLostSelfieClaim(
    profile: PaletteProfile,
    userId: string,
    input: CommitPaletteSelfieInput,
    idempotencyKey: string,
    keys: UploadSessionKeys,
    fromStaging: boolean
  ): Promise<CommitResult> {
    const raced = await this.prisma.paletteProfile.findUnique({
      where: { id: profile.id },
    })
    if (raced?.selfie_upload_session_id === input.uploadSessionId) {
      if (
        raced.selfie_commit_idempotency_key === idempotencyKey &&
        raced.status !== 'pending_upload' &&
        raced.status !== 'bytes_uploaded'
      ) {
        return { replayed: true, response: { data: await this.getProfile(userId) } }
      }
    } else if (fromStaging) {
      // Replaced or erased meanwhile, and the publish returned, so it has landed: nothing will
      // claim the published object.
      await this.deletions.recordAndRemove([keys.finalPath], 'commit_compensation')
    }
    throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
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
      return this.replayCommittedSelfie(profile, userId, idempotencyKey)
    }
    assertCommittableSelfie(profile)

    const keys = selfieKeys(profile, 'commit')
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    // Publication ownership before any storage I/O; see WardrobeService.commitGarment. Only the
    // owning attempt verifies the staged bytes and writes exactly that buffer to the final key
    // with server-owned type and cache policy. Staging stays until the claim.
    const publishAttemptId = randomUUID()
    if (!(await this.claimSelfiePublication(profile, publishAttemptId))) {
      return this.resolveUnclaimedSelfie(profile.id, userId, input, idempotencyKey)
    }
    const fromStaging = profile.status === 'pending_upload'
    await this.placeVerifiedSelfie(profile, keys, fromStaging, publishAttemptId)

    const updated = await this.prisma.paletteProfile.updateMany({
      // Guarded on this attempt's publication claim as well as the session and status: a
      // reallocation replaces the session in place on this one-row-per-user profile.
      where: {
        id: profile.id,
        selfie_upload_session_id: input.uploadSessionId,
        selfie_publish_attempt_id: publishAttemptId,
        status: { in: ['pending_upload', 'bytes_uploaded'] },
      },
      data: {
        status: 'processing',
        source: 'selfie',
        selfie_committed_at: new Date(),
        selfie_commit_idempotency_key: idempotencyKey,
        selfie_publish_attempt_id: null,
        selfie_publish_started_at: null,
        // A selfie analysis's attempt is its session, so its job id is the one every selfie
        // job has carried.
        analysis_attempt_id: input.uploadSessionId,
        processing_job_enqueued_at: null,
        revision: { increment: 1 },
      },
    })
    if (updated.count !== 1) {
      await this.releaseSelfiePublication(profile.id, publishAttemptId)
      return this.resolveLostSelfieClaim(
        profile,
        userId,
        input,
        idempotencyKey,
        keys,
        fromStaging
      )
    }

    // Job handoff first, cleanup after; see WardrobeSilhouetteService.commitMyForm.
    const committed = await this.prisma.paletteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })
    await handOffPaletteAnalysis(this.prisma, this.processingQueue, committed)
    if (fromStaging) {
      await this.deletions.recordAndRemove([keys.stagingPath], 'commit_staging_released')
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

  /**
   * Records a replaced, erased or superseded selfie session's keys for removal in the caller's
   * transaction: once, or repeating until `removalHorizon` when a publication may still write.
   */
  private async recordSelfieRemoval(
    tx: Parameters<Parameters<typeof interactiveTransaction>[1]>[0],
    objectPaths: readonly string[],
    reason: 'selfie_replaced' | 'selfie_erased' | 'selfie_superseded',
    removalHorizon: Date | null
  ): Promise<void> {
    if (removalHorizon) {
      await this.deletions.recordRepeating(tx, objectPaths, reason, removalHorizon)
    } else {
      await this.deletions.record(tx, objectPaths, reason)
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
    // Under the per-member lock allocation takes, so a replacement cannot slip between reading
    // the paths and revoking consent: either it committed first and its keys are read here, or
    // it waits and then finds consent revoked. The keys are recorded in the same transaction, so
    // a failed storage removal is retried instead of forgotten.
    const selfieObjectPaths = await interactiveTransaction(this.prisma, async (tx) => {
      await lockPaletteProfile(tx, userId)
      const existing = await tx.paletteProfile.findUnique({ where: { user_id: userId } })
      const from = consentAuditState(existing)
      const objectPaths = selfieObjectsToRemove(existing)
      const removalHorizon = selfieRemovalHorizon(existing)

      await tx.advisorRecommendationState.deleteMany({ where: { user_id: userId } })
      await tx.paletteProfile.upsert({
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
          analysis_attempt_id: null,
          processing_job_enqueued_at: null,
          ...CLEARED_SELFIE_SESSION,
          revision: { increment: 1 },
        },
      })
      // The current final and staging keys go now. A publication still in flight for this
      // session may write the selfie after this erasure, so its keys are removed again every
      // 15 minutes until the horizon, whenever that write lands.
      await this.recordSelfieRemoval(tx, objectPaths, 'selfie_erased', removalHorizon)
      await tx.auditLog.create({
        data: {
          user_id: userId,
          event_type: 'palette_analysis_consent_changed',
          event_data: { from, to: 'revoked', source: 'user' },
          ip_address: null,
        },
      })
      return objectPaths
    })

    await this.deletions.removeNow(selfieObjectPaths)

    return this.getProfile(userId)
  }
}
