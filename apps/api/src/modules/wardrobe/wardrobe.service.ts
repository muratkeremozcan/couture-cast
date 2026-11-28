// Story 4.2 Task 5 step 1 owner: implement suggestGarmentTags and updateGarmentTags service methods in apps/api/src/modules/wardrobe/wardrobe.service.ts
// Story 4.1 Task 5 step 2 owner: implement HMAC upload tokens, checksum validation, and garment commit logic in `apps/api/src/modules/wardrobe/wardrobe.service.ts`
import { createHash, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Prisma, PrismaClient, type GarmentItem } from '@prisma/client'
import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  GARMENT_TAGS_CHANGED_MESSAGE,
  garmentTagSuggestionSnapshotSchema,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
  type GarmentTagSuggestionSnapshot,
  type CreateGarmentItemInput,
  type CreateGarmentUploadUrlInput,
  type FlatLayConfirmation,
  type FlatLayTags,
  type GarmentColorFamilyContract,
  type GarmentItemResponse,
  type SuggestGarmentTagsResponse,
  type UpdateGarmentTagsInput,
} from '@couture/api-client/contracts/http'
import {
  buildGarmentObjectPath,
  buildWardrobeStagingObjectPath,
  colorFamilyFromHex,
  garmentSubtypeMatchesCategory,
  isWardrobePathSegment,
  type GarmentSubtype,
} from '@couture/utils'

import { createBaseLogger } from '../../logger/pino.config'
import type { ApiRole } from '../auth/security.types'
import { GuardianService } from '../guardian/guardian.service'
import { RitualService } from '../personalization/ritual.service'
import {
  TelemetryService,
  type TelemetryPropertiesMap,
} from '../telemetry/telemetry.service'
import {
  GarmentImageValidationError,
  MAX_GARMENT_IMAGE_BYTES,
  type GarmentImageDeclaration,
  type GarmentMimeType,
  verifyGarmentImage,
} from './wardrobe-image-validation'
import {
  WardrobeObjectDeletionOutbox,
  type WardrobeDeletionReason,
} from './wardrobe-object-deletion.outbox'
import { TAGGING_MANUAL_MODE_CODE } from './garment-tagging.engine'
import { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { handOffGarmentProcessing } from './wardrobe-processing-handoff'
import {
  SupabaseWardrobeStorageAdapter,
  type WardrobeUploadSession,
} from './wardrobe-storage.adapter'
import {
  isOwnGarmentObject,
  logUntrustedUploadSession,
  objectExtensionFor,
  uploadPathInvalid,
  uploadSessionKeys,
  type UploadSessionKeys,
} from './wardrobe-upload-paths'
import {
  nextCleanupHorizon,
  unfinishedPublicationDeadline,
  uploadInProgress,
} from './wardrobe-publication'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

const UPLOAD_EXPIRY_SECONDS = 900
const READ_URL_EXPIRY_SECONDS = 900
const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 5

type UploadUrlResult = {
  replayed: boolean
  response: {
    data: {
      garmentId: string
      uploadSessionId: string
      uploadUrl: string
      uploadToken: string
      requiredHeaders: { 'content-type': GarmentMimeType }
      expiresAt: string
    }
  }
}

type CommitResult = {
  replayed: boolean
  response: GarmentItemResponse
}

/**
 * The session's staging and final keys, derived from the row's own ids and checked against the
 * stored path (see `uploadSessionKeys`). A row that fails is answered as an expired session
 * before any storage call: the id and path columns were member-writable before the 2026-11-19
 * revoke migration, and the service role would otherwise act on whatever they named.
 */
function garmentKeys(garment: GarmentItem, operation: string): UploadSessionKeys {
  const keys = uploadSessionKeys({
    kind: 'garment',
    userId: garment.user_id,
    objectId: garment.id,
    uploadSessionId: garment.upload_session_id,
    mimeType: garment.mime_type,
    storedObjectPath: garment.object_path,
  })
  if (!keys) {
    logUntrustedUploadSession({ operation, kind: 'garment', rowId: garment.id })
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
  return keys
}

function allocationMatches(
  garment: GarmentItem,
  input: CreateGarmentUploadUrlInput
): boolean {
  return (
    garment.file_size_bytes === input.fileSizeBytes &&
    garment.mime_type === input.mimeType &&
    garment.content_sha256 === input.sha256 &&
    garment.width_px === input.widthPx &&
    garment.height_px === input.heightPx
  )
}

/** A same-key allocation replays only for the same declaration and a session still open. */
function assertReplayableAllocation(
  garment: GarmentItem,
  input: CreateGarmentUploadUrlInput
): void {
  if (!allocationMatches(garment, input)) {
    throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
  }
  if (
    garment.retention_status !== 'active' ||
    garment.upload_status !== 'pending_upload' ||
    garment.upload_ended_at !== null ||
    !garment.upload_expires_at ||
    garment.upload_expires_at <= new Date()
  ) {
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
}

function commitPayloadHash(input: CreateGarmentItemInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        garmentId: input.garmentId,
        uploadSessionId: input.uploadSessionId,
        hasCropping: input.hasCropping,
        hasBgCleanup: input.hasBgCleanup,
      })
    )
    .digest('hex')
}

function declarationFromGarment(garment: GarmentItem): GarmentImageDeclaration {
  if (
    !garment.file_size_bytes ||
    !garment.mime_type ||
    !garment.content_sha256 ||
    !garment.width_px ||
    !garment.height_px
  ) {
    throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
  }
  return {
    fileSizeBytes: garment.file_size_bytes,
    mimeType: garment.mime_type as GarmentMimeType,
    sha256: garment.content_sha256,
    widthPx: garment.width_px,
    heightPx: garment.height_px,
  }
}

function mapImageValidationError(error: GarmentImageValidationError): never {
  if (error.code === 'IMAGE_SIZE_MISMATCH') {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'IMAGE_CHECKSUM_MISMATCH') {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'IMAGE_DIMENSIONS_INVALID') {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'UNSUPPORTED_IMAGE_TYPE') {
    throw new UnsupportedMediaTypeException(error.code)
  }
  throw new UnprocessableEntityException('IMAGE_DECODE_FAILED')
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

class ConcurrentTagUpdateError extends Error {}

type TagConfirmationResult = {
  updated: GarmentItem
  telemetryProperties: TelemetryPropertiesMap['garment_tagging_completed'] | null
  cacheInvalidationRequired: boolean
}

type ParsedTagSuggestion = {
  suggestion: GarmentTagSuggestionSnapshot | null
  hasMalformedSuggestion: boolean
}

/**
 * The states a commit can claim. Clients now PUT bytes straight to storage, so a session stays
 * `pending_upload` until commit finds and verifies the object; `bytes_uploaded` is a row whose
 * bytes went through the retired API relay before this deploy.
 */
const COMMITTABLE_UPLOAD_STATUSES: GarmentItem['upload_status'][] = [
  'pending_upload',
  'bytes_uploaded',
]

const COMMITTED_UPLOAD_STATUSES: ReadonlySet<GarmentItem['upload_status']> = new Set([
  'processing',
  'awaiting_tags',
  'ready',
])

const PENDING_TAGGING_STATUSES: ReadonlySet<GarmentItem['upload_status']> = new Set([
  'pending_upload',
  'bytes_uploaded',
  'processing',
])

function assertTaggableGarment(
  garment: GarmentItem | null
): asserts garment is GarmentItem {
  if (!garment) {
    throw new NotFoundException('GARMENT_NOT_FOUND')
  }
  if (garment.retention_status !== 'active') {
    throw new ConflictException('GARMENT_NOT_TAGGABLE')
  }
  if (PENDING_TAGGING_STATUSES.has(garment.upload_status)) {
    throw new ConflictException('GARMENT_ANALYSIS_PENDING')
  }
  if (garment.upload_status === 'failed') {
    throw new ConflictException('GARMENT_NOT_TAGGABLE')
  }
}

function resolveTargetMaterial(
  garment: GarmentItem,
  input: UpdateGarmentTagsInput
): GarmentMaterial | null {
  return input.material === undefined
    ? (garment.material as GarmentMaterial | null)
    : input.material
}

function normalizedStoredSubtype({
  category,
  subtype,
}: Pick<GarmentItem, 'category' | 'subtype'>): GarmentSubtype | null {
  return garmentSubtypeMatchesCategory(category, subtype) ? subtype : null
}

function resolveTargetSubtype(
  storedSubtype: GarmentSubtype | null,
  { category, subtype }: UpdateGarmentTagsInput
): GarmentSubtype | null {
  if (subtype === undefined) {
    return garmentSubtypeMatchesCategory(category, storedSubtype) ? storedSubtype : null
  }
  if (subtype !== null && !garmentSubtypeMatchesCategory(category, subtype)) {
    throw new BadRequestException(
      'Invalid garment tags: subtype: Subtype must match the garment category'
    )
  }
  return subtype
}

function isUnchangedTagConfirmation(
  garment: GarmentItem,
  input: UpdateGarmentTagsInput,
  targetMaterial: GarmentMaterial | null,
  targetSubtype: GarmentSubtype | null
): boolean {
  return (
    garment.upload_status === 'ready' &&
    garment.category === input.category &&
    normalizedStoredSubtype(garment) === targetSubtype &&
    garment.material === targetMaterial &&
    garment.comfort_range === input.comfortRange
  )
}

function parseTagSuggestion(garment: GarmentItem): ParsedTagSuggestion {
  if (!garment.tag_suggestions) {
    return { suggestion: null, hasMalformedSuggestion: false }
  }
  const parsed = garmentTagSuggestionSnapshotSchema.safeParse(garment.tag_suggestions)
  return parsed.success
    ? { suggestion: parsed.data, hasMalformedSuggestion: false }
    : { suggestion: null, hasMalformedSuggestion: true }
}

function buildOverrideFields(
  suggestion: GarmentTagSuggestionSnapshot | null,
  input: UpdateGarmentTagsInput,
  targetMaterial: GarmentMaterial | null
): ('category' | 'material' | 'comfort_range')[] {
  if (!suggestion) {
    return []
  }
  const overrideFields: ('category' | 'material' | 'comfort_range')[] = []
  if (suggestion.category.value !== input.category) {
    overrideFields.push('category')
  }
  if (suggestion.material.value !== targetMaterial) {
    overrideFields.push('material')
  }
  if (suggestion.comfortRange.value !== input.comfortRange) {
    overrideFields.push('comfort_range')
  }
  return overrideFields
}

function buildTaggingTelemetryProperties(
  userId: string,
  garmentId: string,
  suggestion: GarmentTagSuggestionSnapshot | null,
  input: UpdateGarmentTagsInput,
  targetMaterial: GarmentMaterial | null
): TelemetryPropertiesMap['garment_tagging_completed'] {
  const overrideFields = buildOverrideFields(suggestion, input, targetMaterial)
  return {
    analyticsSubjectId: userId,
    garmentId,
    suggestedCategory: suggestion?.category.value ?? null,
    confirmedCategory: input.category,
    suggestedMaterial: suggestion?.material.value ?? null,
    confirmedMaterial: targetMaterial,
    suggestedComfortRange: suggestion?.comfortRange.value ?? null,
    confirmedComfortRange: input.comfortRange,
    suggestionAvailable: suggestion !== null,
    analysisVersion: suggestion?.analysisVersion ?? null,
    wasOverridden: overrideFields.length > 0,
    overrideFields,
  }
}

function isRetriableTagUpdateError(error: unknown): boolean {
  return error instanceof ConcurrentTagUpdateError || isPrismaSerializationFailure(error)
}

function isPrismaSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

function assertCommitReplayMatches(
  garment: GarmentItem,
  idempotencyKey: string,
  payloadHash: string
): void {
  if (
    garment.commit_idempotency_key !== idempotencyKey ||
    garment.commit_payload_hash !== payloadHash
  ) {
    throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
  }
}

type GarmentCommitRequest = {
  userId: string
  input: CreateGarmentItemInput
  idempotencyKey: string
  payloadHash: string
  flatLay?: { bytes: Buffer; tags: Required<FlatLayTags> }
}

type FlatLayCommit = {
  reviewId: string
  reviewItems: string[]
  expiresAt: Date
  pieces: (NonNullable<GarmentCommitRequest['flatLay']> & {
    id: string
    sha256: string
    widthPx: number
    heightPx: number
  })[]
}

const FLAT_LAY_RESERVATION_PREFIX = 'flat-lay:'

function assertMatchingFlatLayCommit(
  garment: GarmentItem,
  request: GarmentCommitRequest
) {
  const reservation =
    garment.upload_idempotency_key?.startsWith(FLAT_LAY_RESERVATION_PREFIX) === true
  if (reservation !== Boolean(request.flatLay))
    throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
  if (!request.flatLay) return
  if (!garment.upload_expires_at || garment.upload_expires_at <= new Date()) {
    throw new BadRequestException('FLAT_LAY_INVALID')
  }
  assertCommitReplayMatches(garment, request.idempotencyKey, request.payloadHash)
}

/** A commit of a session already past commit, answered with a read signed under the lock. */
type GarmentCommitReplay = {
  kind: 'replay'
  garment: GarmentItem
  response: GarmentItemResponse
}

/** What one locked read of the garment decided; see `classifyGarmentCommit`. */
type GarmentCommitDecision =
  | GarmentCommitReplay
  | { kind: 'claimable' | 'claimed'; garment: GarmentItem; keys: UploadSessionKeys }

/**
 * Locks the garment row and reads it in the caller's transaction, so a legal hold, a rejection
 * or a competing commit either landed before the read or waits for the transaction.
 */
async function lockGarmentRow(
  tx: Prisma.TransactionClient,
  garmentId: string
): Promise<GarmentItem | null> {
  await tx.$queryRaw`SELECT 1 FROM "GarmentItem" WHERE id = ${garmentId} FOR UPDATE`
  return tx.garmentItem.findUnique({ where: { id: garmentId } })
}

/**
 * A committable session that a new claim may take: not ended, not owned by another attempt's
 * live claim (409 UPLOAD_IN_PROGRESS), and, while pending, not expired. A claim released before
 * its owner wrote anything leaves the session open.
 */
function assertGarmentSessionOpen(garment: GarmentItem, now: Date): void {
  if (garment.upload_ended_at) {
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
  const liveClaim = unfinishedPublicationDeadline(
    {
      attemptId: garment.publish_attempt_id,
      startedAt: garment.publish_started_at,
      committable: true,
    },
    now
  )
  if (liveClaim) throw uploadInProgress()
  if (
    garment.upload_status === 'pending_upload' &&
    (!garment.upload_expires_at || garment.upload_expires_at <= now)
  ) {
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
}

/** A garment as the API returns it, with the image access the caller could sign. */
function garmentData(
  garment: GarmentItem,
  imageAccess: GarmentItemResponse['data']['imageAccess']
): GarmentItemResponse['data'] {
  return {
    id: garment.id,
    status: garment.upload_status,
    category: garment.category as GarmentCategory | null,
    material: garment.material as GarmentMaterial | null,
    comfortRange: garment.comfort_range as GarmentComfortRange | null,
    tagsConfirmedAt: garment.tags_confirmed_at?.toISOString() ?? null,
    fileSizeBytes: garment.file_size_bytes,
    mimeType: garment.mime_type as GarmentMimeType | null,
    retentionStatus: garment.retention_status,
    createdAt: garment.created_at.toISOString(),
    committedAt: garment.committed_at?.toISOString() ?? null,
    imageAccess,
  }
}

/** Each tag the editor sent in `expected` equals the stored tag; an omitted one is not compared. */
function storedTagsMatch(
  garment: Pick<GarmentItem, 'category' | 'material' | 'comfort_range' | 'subtype'>,
  expected: NonNullable<UpdateGarmentTagsInput['expected']>
): boolean {
  return (
    (expected.category === undefined || expected.category === garment.category) &&
    (expected.subtype === undefined ||
      expected.subtype === normalizedStoredSubtype(garment)) &&
    (expected.material === undefined || expected.material === garment.material) &&
    (expected.comfortRange === undefined ||
      expected.comfortRange === garment.comfort_range)
  )
}

export interface GarmentReadOptions {
  today?: boolean
  includeColor?: boolean
  includeSubtype?: boolean
}

export type GarmentResponseData = GarmentItemResponse['data'] & {
  colorFamily?: GarmentColorFamilyContract | null
  subtype?: GarmentSubtype | null
}

/** The family of the dominant hex the color processor stored; null when there is none. */
export function garmentColorFamily(
  garment: Pick<GarmentItem, 'color_palette'>
): GarmentColorFamilyContract | null {
  const palette = garment.color_palette
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) return null
  const dominant = (palette as Record<string, unknown>).dominant
  return colorFamilyFromHex(typeof dominant === 'string' ? dominant : null)
}

function withGarmentMetadata(
  garment: GarmentItem,
  data: GarmentItemResponse['data'],
  options: GarmentReadOptions
): GarmentResponseData {
  return {
    ...data,
    ...(options.includeColor && { colorFamily: garmentColorFamily(garment) }),
    ...(options.includeSubtype && { subtype: normalizedStoredSubtype(garment) }),
  }
}

@Injectable()
export class WardrobeService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe' })
  private readonly deletions: WardrobeObjectDeletionOutbox

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    @Inject(WardrobeProcessingQueue)
    private readonly processingQueue: WardrobeProcessingQueue,
    @Inject(RitualService)
    private readonly ritualService: RitualService
  ) {
    this.deletions = new WardrobeObjectDeletionOutbox(prisma, storage)
  }

  /**
   * A storage signed upload URL for the session's staging key. A replayed allocation signs
   * afresh for the same key, unless the caller already signed it. The window the client is
   * told is the shorter of the session and the token.
   */
  private async uploadResponse(
    garment: GarmentItem,
    signed: WardrobeUploadSession | null = null
  ): Promise<UploadUrlResult['response']> {
    if (!garment.upload_session_id || !garment.upload_expires_at || !garment.mime_type) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    const keys = garmentKeys(garment, 'allocate')
    const session = signed ?? (await this.storage.createUploadSession(keys.stagingPath))
    const expiresAt = Math.min(
      garment.upload_expires_at.getTime(),
      session.tokenExpiresAt.getTime()
    )
    return {
      data: {
        garmentId: garment.id,
        uploadSessionId: garment.upload_session_id,
        uploadUrl: session.uploadUrl,
        uploadToken: session.uploadToken,
        requiredHeaders: {
          'content-type': garment.mime_type as GarmentMimeType,
        },
        expiresAt: new Date(expiresAt).toISOString(),
      },
    }
  }

  async createUploadUrl(
    userId: string,
    role: ApiRole,
    input: CreateGarmentUploadUrlInput,
    idempotencyKey: string
  ): Promise<UploadUrlResult> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const existing = await this.prisma.garmentItem.findUnique({
      where: {
        user_id_upload_idempotency_key: {
          user_id: userId,
          upload_idempotency_key: idempotencyKey,
        },
      },
    })
    if (existing) {
      assertReplayableAllocation(existing, input)
      return { replayed: true, response: await this.uploadResponse(existing) }
    }

    if (!isWardrobePathSegment(userId)) {
      throw uploadPathInvalid({ operation: 'allocate', kind: 'garment', rowId: userId })
    }
    const garmentId = randomUUID()
    const uploadSessionId = randomUUID()
    const extension = objectExtensionFor(input.mimeType)
    const objectPath = buildGarmentObjectPath(userId, garmentId, extension)
    // Signed before the row is written, so a storage outage leaves no session behind.
    const signed = await this.storage.createUploadSession(
      buildWardrobeStagingObjectPath(userId, 'garment', uploadSessionId, extension)
    )
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)

    try {
      const created = await this.prisma.garmentItem.create({
        data: {
          id: garmentId,
          user_id: userId,
          object_path: objectPath,
          upload_session_id: uploadSessionId,
          upload_idempotency_key: idempotencyKey,
          file_size_bytes: input.fileSizeBytes,
          mime_type: input.mimeType,
          content_sha256: input.sha256,
          width_px: input.widthPx,
          height_px: input.heightPx,
          upload_status: 'pending_upload',
          retention_status: 'active',
          upload_expires_at: expiresAt,
          consent_checked_at: new Date(),
        },
      })
      return { replayed: false, response: await this.uploadResponse(created, signed) }
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
      const raced = await this.prisma.garmentItem.findUnique({
        where: {
          user_id_upload_idempotency_key: {
            user_id: userId,
            upload_idempotency_key: idempotencyKey,
          },
        },
      })
      if (!raced) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }
      assertReplayableAllocation(raced, input)
      return { replayed: true, response: await this.uploadResponse(raced) }
    }
  }

  private async toResponse(
    garment: GarmentItem,
    options: GarmentReadOptions = {}
  ): Promise<GarmentItemResponse> {
    if (!garment.object_path) {
      throw new ServiceUnavailableException('STORAGE_UNAVAILABLE')
    }
    // Parse-and-compare: this member's folder, the garment kind and this garment's own id, in any
    // extension the bucket takes. No MIME is needed, so seeded ready rows (no MIME) keep their
    // image.
    if (!isOwnGarmentObject(garment)) {
      throw uploadPathInvalid({
        operation: 'sign_read',
        kind: 'garment',
        rowId: garment.id,
      })
    }
    const readUrl = await this.storage.signReadUrl(
      garment.object_path,
      READ_URL_EXPIRY_SECONDS
    )
    return {
      data: withGarmentMetadata(
        garment,
        garmentData(garment, {
          url: readUrl,
          expiresAt: new Date(Date.now() + READ_URL_EXPIRY_SECONDS * 1000).toISOString(),
        }),
        options
      ),
    }
  }

  /**
   * One garment of a list. An image that cannot be signed (an object missing
   * from storage, a storage fault) leaves that garment without one, as the
   * contract allows and the capsule list already does, instead of failing the
   * member's whole wardrobe. A row with no object at all still fails closed.
   */
  private async toListedGarment(
    garment: GarmentItem
  ): Promise<GarmentItemResponse['data']> {
    if (!garment.object_path) {
      throw new ServiceUnavailableException('STORAGE_UNAVAILABLE')
    }
    try {
      return (await this.toResponse(garment)).data
    } catch (error) {
      // The garment id and the error's class only: the object path and the
      // storage message both carry the owner's id.
      this.logger.error(
        {
          garmentId: garment.id,
          errorClass: error instanceof Error ? error.constructor.name : typeof error,
        },
        'garment_image_signing_failed'
      )
      return garmentData(garment, null)
    }
  }

  async listGarments(
    userId: string,
    options: GarmentReadOptions = {}
  ): Promise<{ data: GarmentResponseData[] }> {
    const garments = await this.prisma.garmentItem.findMany({
      where: {
        user_id: userId,
        object_path: { not: null },
        retention_status: 'active',
        upload_status: { in: ['processing', 'awaiting_tags', 'ready', 'failed'] },
        ...(options.today ? { deletion_requested_at: null } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    })
    return {
      data: await Promise.all(
        garments.map(async (garment) =>
          withGarmentMetadata(garment, await this.toListedGarment(garment), options)
        )
      ),
    }
  }

  /**
   * Story CC-7.6 D2/D3: how many capsules hold one of the member's own ready, active garments
   * with no recorded deletion request. Anything else, another member's garment included,
   * answers 404 `GARMENT_NOT_FOUND`, so the read reveals nothing about garments the caller
   * cannot delete from the closet.
   */
  async countGarmentCapsules(
    userId: string,
    garmentId: string
  ): Promise<{ garmentId: string; capsuleCount: number }> {
    const garment = await this.prisma.garmentItem.findFirst({
      where: {
        id: garmentId,
        user_id: userId,
        object_path: { not: null },
        retention_status: 'active',
        upload_status: 'ready',
        deletion_requested_at: null,
      },
      select: { id: true },
    })
    if (!garment) {
      throw new NotFoundException('GARMENT_NOT_FOUND')
    }
    const capsuleCount = await this.prisma.outfitCapsule.count({
      where: { user_id: userId, garment_joins: { some: { garment_id: garment.id } } },
    })
    return { garmentId: garment.id, capsuleCount }
  }

  async suggestGarmentTags(
    userId: string,
    role: ApiRole,
    garmentId: string,
    includeSubtype = false
  ): Promise<SuggestGarmentTagsResponse> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const garment = await this.prisma.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
    })

    assertTaggableGarment(garment)

    if (!garment.tag_suggestions) {
      // A worker running without a model recorded a choice, not a fault: tell the client the
      // member chooses the tags. Any other empty snapshot is an inference that did not finish.
      if (garment.tagging_failure_code === TAGGING_MANUAL_MODE_CODE) {
        return { data: { mode: 'manual', garmentId: garment.id } }
      }
      throw new ServiceUnavailableException('TAGGING_INFERENCE_UNAVAILABLE')
    }

    const parsed = garmentTagSuggestionSnapshotSchema.safeParse(garment.tag_suggestions)
    if (!parsed.success) {
      this.logger.error(
        {
          garmentId: garment.id,
          issueCount: parsed.error.issues.length,
          userId,
        },
        'Stored garment tag suggestion snapshot is invalid'
      )
      throw new ServiceUnavailableException('TAGGING_INFERENCE_UNAVAILABLE')
    }

    return {
      data: {
        garmentId: garment.id,
        // The strict legacy contract pins this literal. Storage tracks the actual prompt revision.
        analysisVersion: GARMENT_TAGGING_ANALYSIS_VERSION,
        suggestions: {
          category: parsed.data.category,
          material: parsed.data.material,
          comfortRange: parsed.data.comfortRange,
          ...(includeSubtype && parsed.data.subtype && { subtype: parsed.data.subtype }),
        },
      },
    }
  }

  async updateGarmentTags(
    userId: string,
    role: ApiRole,
    garmentId: string,
    input: UpdateGarmentTagsInput,
    options: GarmentReadOptions = {}
  ): Promise<{ data: GarmentResponseData }> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    const result = await this.confirmTagsTransaction(userId, garmentId, input)

    if (result.telemetryProperties) {
      try {
        await this.telemetryService.captureEvent(
          userId,
          'garment_tagging_completed',
          result.telemetryProperties
        )
      } catch (error) {
        this.logger.error(
          { error, garmentId, userId },
          'Failed to emit garment tagging telemetry'
        )
      }
    }

    if (result.cacheInvalidationRequired) {
      try {
        const invalidated = await this.ritualService.invalidateUserCache(userId)
        if (invalidated) {
          this.logger.info(
            { garmentId, userId },
            'Invalidated Ritual cache after tag update'
          )
        } else {
          this.logger.error(
            { garmentId, userId },
            'Ritual cache invalidation failed after tag update'
          )
        }
      } catch (error) {
        this.logger.error(
          { error, garmentId, userId },
          'Ritual cache invalidation failed after tag update'
        )
      }
    }

    // The tags are committed: a photo that cannot be signed right now leaves the answer without
    // one, as the list does, instead of reporting a failed save for a committed edit.
    const data = await this.toListedGarment(result.updated)
    return { data: withGarmentMetadata(result.updated, data, options) }
  }

  private async confirmTagsTransaction(
    userId: string,
    garmentId: string,
    input: UpdateGarmentTagsInput
  ): Promise<TagConfirmationResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await interactiveTransaction(
          this.prisma,
          (tx) => this.confirmTagsInTransaction(tx, userId, garmentId, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      } catch (error) {
        if (isRetriableTagUpdateError(error)) {
          if (attempt < 3) {
            continue
          }
          throw new ConflictException('CONCURRENT_TAG_UPDATE')
        }
        throw error
      }
    }
    throw new ConflictException('CONCURRENT_TAG_UPDATE')
  }

  private async confirmTagsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    garmentId: string,
    input: UpdateGarmentTagsInput
  ): Promise<TagConfirmationResult> {
    const garment = await tx.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
    })
    assertTaggableGarment(garment)
    const targetSubtype = resolveTargetSubtype(normalizedStoredSubtype(garment), input)

    // Story CC-7.5: an editor that says which tags it saw is refused when another edit landed
    // first, so Done or Undo never overwrites a newer edit. Checked on the row this
    // serializable transaction read, before the unchanged no-op and the guarded write, so a
    // stale `expected` always answers 409, as the contract publishes.
    if (input.expected && !storedTagsMatch(garment, input.expected)) {
      throw new ConflictException(GARMENT_TAGS_CHANGED_MESSAGE)
    }

    const targetMaterial = resolveTargetMaterial(garment, input)
    if (isUnchangedTagConfirmation(garment, input, targetMaterial, targetSubtype)) {
      return {
        updated: garment,
        telemetryProperties: null,
        cacheInvalidationRequired: false,
      }
    }

    const { suggestion, hasMalformedSuggestion } = parseTagSuggestion(garment)
    const isFirstConfirmation = garment.upload_status === 'awaiting_tags'
    const shouldEmitTelemetry =
      isFirstConfirmation && garment.tagging_telemetry_emitted_at === null
    const now = new Date()
    const changed = await tx.garmentItem.updateMany({
      where: {
        id: garment.id,
        user_id: userId,
        retention_status: 'active',
        upload_status: garment.upload_status,
      },
      data: {
        category: input.category,
        subtype: targetSubtype,
        material: targetMaterial,
        comfort_range: input.comfortRange,
        upload_status: 'ready',
        tags_confirmed_at: isFirstConfirmation ? now : (garment.tags_confirmed_at ?? now),
        tagging_telemetry_emitted_at: shouldEmitTelemetry ? now : undefined,
        tag_suggestions: hasMalformedSuggestion ? Prisma.DbNull : undefined,
        tagging_model_version: hasMalformedSuggestion ? null : undefined,
        tag_suggested_at: hasMalformedSuggestion ? null : undefined,
        tagging_failure_code: hasMalformedSuggestion
          ? 'TAGGING_OUTPUT_INVALID'
          : undefined,
      },
    })
    if (changed.count !== 1) {
      throw new ConcurrentTagUpdateError('Concurrent tag update')
    }

    const updated = await tx.garmentItem.findUniqueOrThrow({
      where: { id: garment.id },
    })
    return {
      updated,
      cacheInvalidationRequired: true,
      telemetryProperties: shouldEmitTelemetry
        ? buildTaggingTelemetryProperties(
            userId,
            garment.id,
            suggestion,
            input,
            targetMaterial
          )
        : null,
    }
  }

  async commitGarment(
    userId: string,
    role: ApiRole,
    input: CreateGarmentItemInput,
    idempotencyKey: string
  ): Promise<CommitResult> {
    const payloadHash = commitPayloadHash(input)
    return this.commitGarmentRequest({ userId, input, idempotencyKey, payloadHash }, role)
  }

  async commitFlatLay(
    userId: string,
    role: ApiRole,
    review: FlatLayCommit
  ): Promise<FlatLayConfirmation> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    const requests = await this.reserveFlatLaySelection(userId, review)
    // Independent claims allow other selected pieces to finish when one publication is ambiguous.
    const results = await Promise.allSettled(
      requests.map((request) => this.commitGarmentRequest(request, role))
    )
    if (review.pieces.some(({ tags }) => tags.category !== null)) {
      await this.ritualService.invalidateUserCache(userId).catch(() => undefined)
    }
    return {
      garments: results.map((result) => {
        if (result.status === 'rejected') throw result.reason
        return result.value.response.data
      }),
    }
  }

  private async reserveFlatLaySelection(
    userId: string,
    review: FlatLayCommit
  ): Promise<GarmentCommitRequest[]> {
    if (!isWardrobePathSegment(userId)) throw new BadRequestException('FLAT_LAY_INVALID')
    const { reviewId, reviewItems, pieces, expiresAt } = review
    const selectionHash = createHash('sha256')
      .update(
        JSON.stringify(
          pieces
            .map(({ id, sha256, tags }) => ({ id, sha256, tags }))
            .sort((a, b) => a.id.localeCompare(b.id))
        )
      )
      .digest('hex')
    const prefix = `${FLAT_LAY_RESERVATION_PREFIX}${reviewId}:`
    return interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`
      if (expiresAt <= new Date()) throw new BadRequestException('FLAT_LAY_INVALID')
      const existing = await tx.garmentItem.findMany({
        where: { id: { in: reviewItems } },
      })
      const byId = new Map(existing.map((row) => [row.id, row]))
      // Even a disjoint selection is a different save once the first selection was reserved.
      if (existing.length !== 0 && existing.length !== pieces.length) {
        throw new BadRequestException('FLAT_LAY_INVALID')
      }
      const requests: GarmentCommitRequest[] = []
      for (const piece of pieces) {
        const { id, bytes, tags, sha256, widthPx, heightPx } = piece
        const idempotencyKey = `${prefix}${id}`
        const payloadHash = createHash('sha256')
          .update(JSON.stringify([selectionHash, id]))
          .digest('hex')
        const row = byId.get(id)
        if (
          existing.length &&
          (row?.user_id !== userId ||
            row.upload_idempotency_key !== idempotencyKey ||
            row.commit_idempotency_key !== idempotencyKey ||
            row.commit_payload_hash !== payloadHash)
        )
          throw new BadRequestException('FLAT_LAY_INVALID')

        const uploadSessionId = row?.upload_session_id ?? randomUUID()
        if (!row) {
          await tx.garmentItem.create({
            data: {
              id,
              user_id: userId,
              object_path: buildGarmentObjectPath(userId, id, 'webp'),
              upload_session_id: uploadSessionId,
              upload_idempotency_key: idempotencyKey,
              commit_idempotency_key: idempotencyKey,
              commit_payload_hash: payloadHash,
              file_size_bytes: bytes.length,
              mime_type: 'image/webp',
              content_sha256: sha256,
              width_px: widthPx,
              height_px: heightPx,
              upload_status: 'pending_upload',
              retention_status: 'active',
              upload_expires_at: expiresAt,
              consent_checked_at: new Date(),
            },
          })
        }
        requests.push({
          userId,
          idempotencyKey,
          payloadHash,
          input: {
            garmentId: id,
            uploadSessionId,
            hasCropping: true,
            hasBgCleanup: true,
          },
          flatLay: { bytes, tags },
        })
      }
      return requests
    })
  }

  private async commitGarmentRequest(
    request: GarmentCommitRequest,
    role: ApiRole
  ): Promise<CommitResult> {
    const { userId, input, idempotencyKey, payloadHash, flatLay } = request

    // Every decision comes from one locked read of the row (see classifyGarmentCommit): a replay
    // is answered from it, and so is everything that ends or blocks the session.
    const preflight = await this.classifyGarmentCommit(request, null)
    if (preflight.kind === 'replay') return this.finishReplay(preflight)
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    // Publication ownership comes before any storage I/O: only the attempt that claims it reads
    // staging, verifies, publishes and moves the row on. A concurrent commit of the same session
    // replays the owner's outcome or answers UPLOAD_IN_PROGRESS without touching storage, so no
    // second write of the final key can land after the owner's purge, erasure or replacement.
    const publishAttemptId = randomUUID()
    const decision = await this.classifyGarmentCommit(request, publishAttemptId)
    if (decision.kind === 'replay') return this.finishReplay(decision)
    const { garment: initial, keys } = decision

    // The client wrote staging; commit verifies those bytes and writes exactly the verified
    // buffer to the final key itself, with server-owned type and cache policy. Staging keys take
    // one write, so the verified bytes are the only ones a staging key ever holds. Staging stays
    // until the claim succeeds: a crash anywhere before it leaves a retry, once this claim's
    // lease runs out, able to verify and publish again. A legacy row's bytes went through the
    // retired relay and already sit at the final path.
    const fromStaging = !flatLay && initial.upload_status === 'pending_upload'
    let publishStarted = false
    try {
      if (flatLay) {
        publishStarted = true
        await this.storage.publish(keys.finalPath, flatLay.bytes, 'image/webp')
      } else if (fromStaging) {
        const bytes = await this.verifyStoredGarment(
          initial,
          keys.stagingPath,
          publishAttemptId
        )
        publishStarted = true
        await this.storage.publish(
          keys.finalPath,
          bytes,
          initial.mime_type as GarmentMimeType
        )
      } else {
        await this.verifyStoredGarment(initial, keys.finalPath, publishAttemptId)
      }
    } catch (error) {
      // Released only when no write of the final key was started: a publish that failed may
      // still land, so its claim stays until the lease runs out and a deletion meeting it waits.
      if (!publishStarted)
        await this.releaseGarmentPublication(initial.id, publishAttemptId)
      throw error
    }

    let committed: GarmentItem
    try {
      committed = await this.transitionGarmentToProcessing(
        initial,
        userId,
        input,
        idempotencyKey,
        payloadHash,
        publishAttemptId,
        flatLay?.tags
      )
    } catch (error) {
      const replay = await this.replayIfCommitted(request)
      if (replay) return this.finishReplay(replay)
      // The publish returned, so the write has landed; nothing of this attempt is in flight.
      await this.releaseGarmentPublication(initial.id, publishAttemptId)
      if (fromStaging || flatLay)
        await this.releaseUnclaimedFinal(initial, keys.finalPath)
      throw error
    }

    if (!flatLay) {
      await this.ensureProcessingHandoff(committed)
      if (fromStaging) {
        await this.deletions.recordAndRemove(
          [keys.stagingPath],
          'commit_staging_released'
        )
      }
      await this.emitUploadCompletionTelemetry(userId, committed)
    }

    return {
      replayed: false,
      response: await this.committedResponse(
        committed.id,
        flatLay ? { includeSubtype: true } : undefined
      ),
    }
  }

  /**
   * Classifies a commit from one fresh read of the garment, taken under its row lock, so no
   * transition (a winning commit, a legal hold, a rejection, a released claim) can fall between
   * two reads and be misread. In order: ownership, retention (before any read is signed or any
   * job enqueued), session identity, a replay of a commit that already moved the row on, the
   * ended state, a live claim of another attempt, and expiry. A session with no live claim,
   * including one whose owner released a claim before writing, is claimable and never answered
   * as expired while it is open. With `claimAttemptId`, a claimable session is claimed for it in
   * the same transaction.
   */
  private async classifyGarmentCommit(
    request: GarmentCommitRequest,
    claimAttemptId: string | null
  ): Promise<GarmentCommitDecision> {
    const { userId, input, idempotencyKey, payloadHash, flatLay } = request
    return interactiveTransaction(this.prisma, async (tx) => {
      const garment = await lockGarmentRow(tx, input.garmentId)
      if (!garment || garment.user_id !== userId) {
        throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
      }
      if (garment.retention_status !== 'active') {
        throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
      }
      if (
        garment.upload_session_id === null &&
        garment.upload_status === 'pending_upload'
      ) {
        // A session a rejection cleared before upload_ended_at existed.
        throw new ConflictException('UPLOAD_SESSION_EXPIRED')
      }
      if (garment.upload_session_id !== input.uploadSessionId) {
        throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
      }
      assertMatchingFlatLayCommit(garment, request)
      if (COMMITTED_UPLOAD_STATUSES.has(garment.upload_status)) {
        assertCommitReplayMatches(garment, idempotencyKey, payloadHash)
        return {
          kind: 'replay',
          garment,
          response: await this.toResponse(
            garment,
            flatLay ? { includeSubtype: true } : undefined
          ),
        }
      }
      if (!COMMITTABLE_UPLOAD_STATUSES.includes(garment.upload_status)) {
        throw new BadRequestException('INVALID_GARMENT_COMMIT')
      }
      const now = new Date()
      assertGarmentSessionOpen(garment, now)
      const keys = garmentKeys(garment, 'commit')
      if (!claimAttemptId) return { kind: 'claimable', garment, keys }
      // Compare-and-set on the claim as read; the row lock already keeps it from moving. The
      // cleanup horizon is recorded with the claim, before any storage I/O, and survives the
      // lease, a takeover and success: purge and deletion repeat their removal until then.
      const cleanupUntil = nextCleanupHorizon(garment.publish_cleanup_until, now)
      const claimed = await tx.garmentItem.updateMany({
        where: {
          id: garment.id,
          upload_session_id: garment.upload_session_id,
          publish_attempt_id: garment.publish_attempt_id,
        },
        data: {
          publish_attempt_id: claimAttemptId,
          publish_started_at: now,
          publish_cleanup_until: cleanupUntil,
        },
      })
      if (claimed.count !== 1) throw uploadInProgress()
      return {
        kind: 'claimed',
        garment: {
          ...garment,
          publish_attempt_id: claimAttemptId,
          publish_started_at: now,
          publish_cleanup_until: cleanupUntil,
        },
        keys,
      }
    })
  }

  /**
   * After a failed claim of the row, the commit that won it, when it already moved the row on:
   * classified from one locked read like {@link classifyGarmentCommit}, so a garment that left
   * `active` is refused before anything is signed. Null when no commit moved the row on.
   */
  private async replayIfCommitted(
    request: GarmentCommitRequest
  ): Promise<GarmentCommitReplay | null> {
    const { userId, input, idempotencyKey, payloadHash } = request
    return interactiveTransaction(this.prisma, async (tx) => {
      const garment = await lockGarmentRow(tx, input.garmentId)
      if (
        !garment ||
        garment.user_id !== userId ||
        garment.upload_session_id !== input.uploadSessionId ||
        !COMMITTED_UPLOAD_STATUSES.has(garment.upload_status)
      ) {
        return null
      }
      if (garment.retention_status !== 'active') {
        throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
      }
      assertCommitReplayMatches(garment, idempotencyKey, payloadHash)
      return {
        kind: 'replay',
        garment,
        response: await this.toResponse(
          garment,
          request.flatLay ? { includeSubtype: true } : undefined
        ),
      }
    })
  }

  /** A replay's read was signed under the row lock; a processing row still needs its job. */
  private async finishReplay(replay: GarmentCommitReplay): Promise<CommitResult> {
    if (replay.garment.upload_status === 'processing') {
      await this.ensureProcessingHandoff(replay.garment)
    }
    return { replayed: true, response: replay.response }
  }

  /**
   * The response of a commit that just moved the row on, read and signed under the row lock: a
   * garment that left `active` meanwhile is answered without image access.
   */
  private async committedResponse(
    garmentId: string,
    options: GarmentReadOptions = {}
  ): Promise<GarmentItemResponse> {
    return interactiveTransaction(this.prisma, async (tx) => {
      const garment = await lockGarmentRow(tx, garmentId)
      if (!garment) throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
      if (garment.retention_status !== 'active') {
        return { data: withGarmentMetadata(garment, garmentData(garment, null), options) }
      }
      return this.toResponse(garment, options)
    })
  }

  /** Gives the publication back when this attempt never started writing the final key. */
  private async releaseGarmentPublication(
    garmentId: string,
    attemptId: string
  ): Promise<void> {
    await this.prisma.garmentItem
      .updateMany({
        where: { id: garmentId, publish_attempt_id: attemptId },
        data: { publish_attempt_id: null, publish_started_at: null },
      })
      .catch(() => undefined)
  }

  /**
   * A published final object nothing will claim: the session was replaced or ended, or the
   * garment left `active`. A claim that failed while the row still holds this session leaves the
   * object for the member's retry, which publishes the same bytes again; the staging sweep
   * removes it if no retry comes.
   */
  private async releaseUnclaimedFinal(
    initial: GarmentItem,
    finalPath: string
  ): Promise<void> {
    const current = await this.prisma.garmentItem.findUnique({
      where: { id: initial.id },
    })
    if (
      current &&
      current.upload_session_id === initial.upload_session_id &&
      current.upload_ended_at === null &&
      current.retention_status === 'active'
    ) {
      return
    }
    await this.deletions.recordAndRemove([finalPath], 'commit_compensation')
  }

  /**
   * The server never sees the bytes in flight, so this is where they are checked: the uploaded
   * object must match the declared size, sniffed type, sha256 and dimensions. It is read through
   * a hard ceiling, so an oversized object never sits in memory whole. A mismatch is removed and
   * the session ends, so a corrected upload needs a fresh allocation and a fresh key; a validator
   * still running for this session can then only touch a dead session's key. Returns the
   * verified bytes.
   */
  private async verifyStoredGarment(
    garment: GarmentItem,
    objectPath: string,
    publishAttemptId: string
  ): Promise<Buffer> {
    const declaration = declarationFromGarment(garment)
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
        await this.rejectGarmentUpload(garment, objectPath, publishAttemptId)
        mapImageValidationError(error)
      }
      throw error
    }
  }

  /**
   * Ends the session explicitly with `upload_ended_at`, so no commit, replay or claim can take it
   * again, while the row keeps its session id: the outbox and the staging sweep still find the
   * garment a staging key belongs to, and keep it while the garment is under legal hold. The
   * update is guarded on active retention, this attempt's publication claim (the only attempt
   * that verifies the session) and the session itself, and the rejected object is recorded for
   * removal in the same transaction only when that update changed the row. A hold that landed
   * after the claim leaves the session and its staged bytes exactly as they are. The retention
   * sweep later removes the row.
   */
  private async rejectGarmentUpload(
    garment: GarmentItem,
    objectPath: string,
    publishAttemptId: string
  ): Promise<void> {
    const reason: WardrobeDeletionReason = 'upload_rejected'
    const ended = await interactiveTransaction(this.prisma, async (tx) => {
      const now = new Date()
      const changed = await tx.garmentItem.updateMany({
        where: {
          id: garment.id,
          user_id: garment.user_id,
          upload_session_id: garment.upload_session_id,
          publish_attempt_id: publishAttemptId,
          retention_status: 'active',
          upload_ended_at: null,
          upload_status: { in: COMMITTABLE_UPLOAD_STATUSES },
        },
        data: {
          upload_status: 'pending_upload',
          upload_ended_at: now,
          upload_expires_at: now,
          publish_attempt_id: null,
          publish_started_at: null,
        },
      })
      if (changed.count !== 1) return false
      await this.deletions.record(tx, [objectPath], reason)
      return true
    })
    if (!ended) {
      this.logger.warn({ garmentId: garment.id }, 'garment_rejection_left_session_open')
      return
    }
    await this.deletions.removeNow([objectPath])
  }

  private async transitionGarmentToProcessing(
    initial: GarmentItem,
    userId: string,
    input: CreateGarmentItemInput,
    idempotencyKey: string,
    payloadHash: string,
    publishAttemptId: string,
    flatLayTags?: Required<FlatLayTags>
  ): Promise<GarmentItem> {
    for (
      let attempt = 1;
      attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await interactiveTransaction(
          this.prisma,
          async (tx) => {
            const keyOwner = await tx.garmentItem.findUnique({
              where: {
                user_id_commit_idempotency_key: {
                  user_id: userId,
                  commit_idempotency_key: idempotencyKey,
                },
              },
            })
            if (keyOwner && keyOwner.id !== initial.id) {
              throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
            }

            const changed = await tx.garmentItem.updateMany({
              where: {
                id: initial.id,
                user_id: userId,
                upload_session_id: input.uploadSessionId,
                upload_status: { in: COMMITTABLE_UPLOAD_STATUSES },
                retention_status: 'active',
                // Only the attempt that owns the publication moves the row on.
                publish_attempt_id: publishAttemptId,
              },
              data: {
                upload_status: flatLayTags
                  ? flatLayTags.category
                    ? 'ready'
                    : 'awaiting_tags'
                  : 'processing',
                ...(flatLayTags && {
                  category: flatLayTags.category,
                  subtype: flatLayTags.subtype,
                  material: flatLayTags.material,
                  comfort_range: flatLayTags.comfortRange,
                  tags_confirmed_at: flatLayTags.category ? new Date() : null,
                  tagging_failure_code: TAGGING_MANUAL_MODE_CODE,
                }),
                publish_attempt_id: null,
                publish_started_at: null,
                committed_at: new Date(),
                commit_idempotency_key: idempotencyKey,
                commit_payload_hash: payloadHash,
                consent_checked_at: new Date(),
                has_cropping: input.hasCropping,
                has_bg_cleanup: input.hasBgCleanup,
              },
            })
            if (changed.count !== 1) {
              throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
            }
            return tx.garmentItem.findUniqueOrThrow({ where: { id: initial.id } })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      } catch (error) {
        if (
          attempt < MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS &&
          isPrismaSerializationFailure(error)
        ) {
          continue
        }
        throw error
      }
    }
    throw new Error('Failed to commit garment after retrying the transaction')
  }

  private async emitUploadCompletionTelemetry(
    userId: string,
    garment: GarmentItem
  ): Promise<void> {
    const telemetryClaim = await this.prisma.garmentItem.updateMany({
      where: { id: garment.id, completion_telemetry_emitted_at: null },
      data: { completion_telemetry_emitted_at: new Date() },
    })
    if (telemetryClaim.count !== 1) {
      return
    }
    try {
      await this.telemetryService.captureEvent(userId, 'garment_upload_completed', {
        garmentId: garment.id,
        fileSizeBytes: garment.file_size_bytes!,
        mimeType: garment.mime_type as GarmentMimeType,
        hasCropping: garment.has_cropping,
        hasBgCleanup: garment.has_bg_cleanup,
        durationMs: Math.max(0, Date.now() - garment.created_at.getTime()),
      })
    } catch (error) {
      this.logger.error(
        { error, garmentId: garment.id, userId },
        'Failed to emit garment upload completion telemetry'
      )
    }
  }

  private async ensureProcessingHandoff(garment: GarmentItem): Promise<void> {
    // Under the job id the row derives, so a garment a legal hold deferred is queued again
    // after its release instead of hitting the first job's retained id.
    await handOffGarmentProcessing(this.prisma, this.processingQueue, garment)
  }
}
