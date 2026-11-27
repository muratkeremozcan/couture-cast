// Story CC-7.2: Account-backed saved looks service (ownership, idempotency, ETag/If-Match, derived status).
import { createHash } from 'node:crypto'
import { Prisma, PrismaClient, type SavedLook } from '@prisma/client'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import {
  savedLookAnchorSnapshotSchema,
  savedLookComfortSchema,
  savedLookCompositionSlotInputSchema,
  savedLookSchema,
  weatherConditionSchema,
  type ListSavedLooksQuery,
  type ParsedCreateSavedLookInput,
  type SavedLookAvailabilityStatus,
  type SavedLookContract,
  type SavedLookNeedsReviewReason,
} from '@couture/api-client/contracts/http'
import {
  doesSavedLookResolve,
  SAMPLE_CATALOG,
  type ComfortRange,
  type SampleGarmentCategory,
} from '@couture/utils'
import { z } from 'zod'
import { createBaseLogger } from '../../logger/pino.config.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { isOwnGarmentObject } from './wardrobe-upload-paths.js'
import {
  SupabaseWardrobeStorageAdapter,
  type WardrobeStorage,
} from './wardrobe-storage.adapter.js'

const READ_URL_EXPIRY_SECONDS = 900
const SIGN_CONCURRENCY = 8

type StoredSlot = z.infer<typeof savedLookCompositionSlotInputSchema>
type StoredAnchorSnapshot = z.infer<typeof savedLookAnchorSnapshotSchema>
type StoredComfort = z.infer<typeof savedLookComfortSchema>

type GarmentProjection = {
  id: string
  user_id: string
  category: string | null
  comfort_range: string | null
  upload_status: string
  retention_status: string
  object_path: string | null
}

const storedCompositionSchema = z.array(savedLookCompositionSlotInputSchema)
const storedSwapsSchema = z.record(z.string(), z.string())

/** Strong entity tag for a saved look: `"saved-look:<id>:<revision>"`. */
export function formatSavedLookETag(savedLookId: string, revision: number): string {
  return `"saved-look:${savedLookId}:${revision}"`
}

/**
 * Parses `If-Match` against the strong ETag issued for a saved look.
 * Returns all matching strong candidate revisions for `savedLookId`, or `null` for `*`.
 */
export function parseSavedLookIfMatchHeader(
  ifMatchHeader: string | undefined,
  savedLookId: string
): number[] | null {
  if (!ifMatchHeader || ifMatchHeader.trim().length === 0) {
    throw new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
  }

  const raw = ifMatchHeader.trim()
  if (raw === '*') {
    return null
  }

  const revisions: number[] = []
  const candidates = raw.split(',').map((entry) => entry.trim())
  for (const candidate of candidates) {
    if (/^W\//i.test(candidate)) {
      continue
    }
    const match = /^"saved-look:(.+):(\d+)"$/.exec(candidate)
    if (!match) {
      continue
    }
    const [, taggedId, revisionText] = match
    if (taggedId !== savedLookId) {
      continue
    }
    const revision = Number(revisionText)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      continue
    }
    revisions.push(revision)
  }

  if (revisions.length > 0) {
    return Array.from(new Set(revisions))
  }

  throw new PreconditionFailedException('SAVED_LOOK_REVISION_MISMATCH')
}

function canonicalizeSwaps(
  swaps: Record<string, string | undefined> | undefined
): Record<string, string> {
  const entries = Object.entries(swaps ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(entries)
}

function canonicalizeComposition(slots: readonly StoredSlot[]): StoredSlot[] {
  return [...slots]
    .sort((left, right) => left.slotIndex - right.slotIndex)
    .map((slot) => ({
      slotIndex: slot.slotIndex,
      category: slot.category,
      kind: slot.kind,
      itemId: slot.itemId,
      label: slot.label ?? null,
    }))
}

/**
 * Hashes the canonical create payload so retries with the same Idempotency-Key
 * match deterministically regardless of JSON key ordering.
 */
export function computeSavedLookPayloadHash(input: ParsedCreateSavedLookInput): string {
  const normalized = {
    source: input.source,
    lookId: input.lookId,
    weather: input.weather,
    ...(input.wornOn ? { wornOn: input.wornOn } : {}),
    title: input.title ?? null,
    anchorGarmentId: input.anchorGarmentId ?? null,
    anchorSnapshot: input.anchorSnapshot
      ? {
          garmentId: input.anchorSnapshot.garmentId,
          category: input.anchorSnapshot.category,
          comfortRange: input.anchorSnapshot.comfortRange,
        }
      : null,
    composition: canonicalizeComposition(input.composition),
    swaps: canonicalizeSwaps(input.swaps),
    collection: input.collection ?? null,
    comfort: input.comfort
      ? {
          runsColdWarm: input.comfort.runsColdWarm,
          windTolerance: input.comfort.windTolerance,
          precipPreparedness: input.comfort.precipPreparedness,
        }
      : null,
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002'
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/** Every member garment a saved look holds: its anchor plus its composition's garment slots. */
function collectGarmentIdsFromRow(
  row: Pick<SavedLook, 'anchor_garment_id' | 'composition'>
): string[] {
  const ids = new Set<string>()
  if (row.anchor_garment_id) {
    ids.add(row.anchor_garment_id)
  }
  const parsed = storedCompositionSchema.safeParse(row.composition)
  if (parsed.success) {
    for (const slot of parsed.data) {
      if (slot.kind === 'garment') {
        ids.add(slot.itemId)
      }
    }
  }
  return Array.from(ids)
}

function savedLookResponseOrigin(row: Pick<SavedLook, 'source' | 'worn_on'>) {
  return {
    source: row.source === 'today' ? 'home_sample' : row.source,
    ...(row.worn_on ? { wornOn: row.worn_on.toISOString().slice(0, 10) } : {}),
  }
}

@Injectable()
export class WardrobeSavedLookService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-saved-look' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SupabaseWardrobeStorageAdapter) private readonly storage: WardrobeStorage,
    @Inject(GuardianConsentStateService)
    private readonly guardianConsentStateService: GuardianConsentStateService
  ) {}

  private async canAccessGarmentPhotos(
    actor: RequestAuthContext,
    source: SavedLook['source']
  ): Promise<boolean> {
    if (actor.role !== 'teen') return true
    if (source === 'today') {
      return this.guardianConsentStateService.canTeenViewPrivateGarmentPhotos(
        actor.userId
      )
    }
    return this.guardianConsentStateService.canTeenAccess(actor.userId)
  }

  private isGarmentAvailable(garment: GarmentProjection | undefined): boolean {
    return (
      garment !== undefined &&
      garment.upload_status === 'ready' &&
      garment.retention_status === 'active'
    )
  }

  private isSignableGarment(garment: GarmentProjection): boolean {
    if (isOwnGarmentObject(garment)) return true
    this.logger.error(
      { garmentId: garment.id },
      'saved_look_garment_path_not_own_skipped'
    )
    return false
  }

  private async signReadUrls(objectPaths: string[]): Promise<Map<string, string>> {
    const distinct = Array.from(new Set(objectPaths))
    const signed = new Map<string, string>()

    for (let start = 0; start < distinct.length; start += SIGN_CONCURRENCY) {
      const batch = distinct.slice(start, start + SIGN_CONCURRENCY)
      const results = await Promise.all(
        batch.map(async (objectPath) => {
          try {
            return {
              objectPath,
              url: await this.storage.signReadUrl(objectPath, READ_URL_EXPIRY_SECONDS),
            }
          } catch (error: unknown) {
            this.logger.warn(
              {
                objectPath,
                message: 'saved_look_image_signing_failed',
                error: error instanceof Error ? error.message : 'unknown error',
              },
              'Failed to sign saved look garment image URL; serving without photo'
            )
            return { objectPath, url: null }
          }
        })
      )
      for (const result of results) {
        if (result.url !== null) {
          signed.set(result.objectPath, result.url)
        }
      }
    }

    return signed
  }

  private async formatSavedLooks(
    actor: RequestAuthContext,
    rows: SavedLook[]
  ): Promise<SavedLookContract[]> {
    if (rows.length === 0) return []

    const garmentIds = Array.from(
      new Set(rows.flatMap((row) => collectGarmentIdsFromRow(row)))
    )

    const garments =
      garmentIds.length > 0
        ? await this.prisma.garmentItem.findMany({
            where: {
              user_id: actor.userId,
              id: { in: garmentIds },
            },
            select: {
              id: true,
              user_id: true,
              category: true,
              comfort_range: true,
              upload_status: true,
              retention_status: true,
              object_path: true,
            },
          })
        : []

    const garmentById = new Map<string, GarmentProjection>(
      garments.map((garment) => [garment.id, garment])
    )

    const idsFor = (today: boolean) =>
      rows
        .filter((row) => (row.source === 'today') === today)
        .flatMap(collectGarmentIdsFromRow)
    const todayIds = idsFor(true)
    const legacyIds = idsFor(false)
    const [allowTodayPhotos, allowLegacyPhotos] = await Promise.all([
      todayIds.length > 0 && this.canAccessGarmentPhotos(actor, 'today'),
      legacyIds.length > 0 && this.canAccessGarmentPhotos(actor, 'style_piece'),
    ])
    const allowedIds = new Set([
      ...(allowLegacyPhotos ? legacyIds : []),
      ...(allowTodayPhotos ? todayIds : []),
    ])
    const objectPaths = garments
      .filter(
        (garment) =>
          allowedIds.has(garment.id) &&
          this.isGarmentAvailable(garment) &&
          garment.object_path &&
          this.isSignableGarment(garment)
      )
      .map((garment) => garment.object_path as string)

    const signedAtMs = Date.now()
    const signedUrls =
      objectPaths.length > 0
        ? await this.signReadUrls(objectPaths)
        : new Map<string, string>()
    const expiresAt = new Date(signedAtMs + READ_URL_EXPIRY_SECONDS * 1000).toISOString()

    return rows.map((row) => {
      const storedSlots = canonicalizeComposition(
        storedCompositionSchema.parse(row.composition)
      )
      const storedSwaps = storedSwapsSchema.safeParse(row.swaps)
      const parsedSnapshot =
        row.anchor_snapshot === null
          ? null
          : savedLookAnchorSnapshotSchema.parse(row.anchor_snapshot)
      const parsedComfort: StoredComfort | null =
        row.comfort === null ? null : savedLookComfortSchema.parse(row.comfort)

      const missingGarmentIds = new Set<string>()
      const composition = storedSlots.map((slot) => {
        if (slot.kind !== 'garment') {
          return {
            slotIndex: slot.slotIndex,
            category: slot.category,
            kind: slot.kind,
            itemId: slot.itemId,
            label: slot.label ?? null,
            missing: false,
            imageAccess: null,
          }
        }
        const live = garmentById.get(slot.itemId)
        if (!this.isGarmentAvailable(live)) {
          missingGarmentIds.add(slot.itemId)
          return {
            slotIndex: slot.slotIndex,
            category: slot.category,
            kind: slot.kind,
            itemId: slot.itemId,
            label: slot.label ?? null,
            missing: true,
            imageAccess: null,
          }
        }
        const allowPhoto = row.source === 'today' ? allowTodayPhotos : allowLegacyPhotos
        const url =
          allowPhoto && live?.object_path ? signedUrls.get(live.object_path) : undefined
        return {
          slotIndex: slot.slotIndex,
          category: slot.category,
          kind: slot.kind,
          itemId: slot.itemId,
          label: slot.label ?? null,
          missing: false,
          imageAccess: url ? { url, expiresAt } : null,
        }
      })

      if (row.anchor_garment_id) {
        const anchorLive = garmentById.get(row.anchor_garment_id)
        if (!this.isGarmentAvailable(anchorLive)) {
          missingGarmentIds.add(row.anchor_garment_id)
        }
      }

      const anchorLive = row.anchor_garment_id
        ? garmentById.get(row.anchor_garment_id)
        : undefined
      const needsReviewReasons = this.deriveNeedsReviewReasons({
        row,
        missingCount: missingGarmentIds.size,
        parsedSnapshot,
        anchorLive,
      })

      const isUnresolved =
        missingGarmentIds.size === 0 &&
        !doesSavedLookResolve({
          source: row.source,
          lookId: row.look_id,
          weather: row.weather,
          anchorCategory:
            (anchorLive?.category as SampleGarmentCategory | null | undefined) ?? null,
          anchorComfortRange:
            (anchorLive?.comfort_range as ComfortRange | null | undefined) ?? null,
          swaps: storedSwaps.success ? storedSwaps.data : {},
          collection: row.collection,
          comfort: parsedComfort,
          composition: storedSlots,
        })

      const availabilityStatus: SavedLookAvailabilityStatus =
        missingGarmentIds.size > 0
          ? 'missing_garment'
          : needsReviewReasons.length > 0 || isUnresolved
            ? 'needs_review'
            : 'ready'

      return savedLookSchema.parse({
        id: row.id,
        ownerUserId: row.user_id,
        ...savedLookResponseOrigin(row),
        lookId: row.look_id,
        weather: row.weather,
        title: row.title,
        anchorGarmentId: row.anchor_garment_id,
        anchorSnapshot: parsedSnapshot,
        composition,
        swaps: storedSwaps.success ? storedSwaps.data : {},
        collection: row.collection,
        comfort: parsedComfort,
        availabilityStatus,
        missingGarmentIds: Array.from(missingGarmentIds),
        needsReviewReasons,
        revision: row.revision,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })
    })
  }

  private deriveNeedsReviewReasons(params: {
    row: SavedLook
    missingCount: number
    parsedSnapshot: StoredAnchorSnapshot | null
    anchorLive: GarmentProjection | undefined
  }): SavedLookNeedsReviewReason[] {
    const { row, missingCount, parsedSnapshot, anchorLive } = params
    if (
      missingCount > 0 ||
      row.source !== 'style_piece' ||
      !row.anchor_garment_id ||
      !parsedSnapshot ||
      !anchorLive
    ) {
      return []
    }
    const reasons: SavedLookNeedsReviewReason[] = []
    if (anchorLive.category !== parsedSnapshot.category) {
      reasons.push('category_changed')
    }
    if (anchorLive.comfort_range !== parsedSnapshot.comfortRange) {
      reasons.push('comfort_range_changed')
    }
    return reasons
  }

  private async findIdempotentReplay(
    actor: RequestAuthContext,
    idempotencyKey: string,
    payloadHash: string
  ): Promise<{ data: SavedLookContract; isReplay: true } | null> {
    const existing = await this.prisma.savedLook.findUnique({
      where: {
        user_id_idempotency_key: {
          user_id: actor.userId,
          idempotency_key: idempotencyKey,
        },
      },
    })
    if (!existing) return null
    if (existing.deleted_at !== null) {
      throw new ConflictException('SAVED_LOOK_ALREADY_REMOVED')
    }
    if (existing.idempotency_payload_hash !== payloadHash) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD')
    }
    const [formatted] = await this.formatSavedLooks(actor, [existing])
    return { data: formatted!, isReplay: true }
  }

  private collectReferencedGarmentIds(
    input: ParsedCreateSavedLookInput,
    canonicalSlots: readonly StoredSlot[]
  ): string[] {
    const ids = new Set<string>()
    if (input.anchorGarmentId) {
      ids.add(input.anchorGarmentId)
    }
    for (const slot of canonicalSlots) {
      if (slot.kind === 'garment') {
        ids.add(slot.itemId)
      }
    }
    return Array.from(ids)
  }

  private async verifyOwnedGarmentsAndSnapshot(
    actor: RequestAuthContext,
    input: ParsedCreateSavedLookInput,
    ids: string[]
  ): Promise<StoredAnchorSnapshot | null> {
    if (ids.length === 0) return null

    const ownedGarments = await this.prisma.garmentItem.findMany({
      where: {
        user_id: actor.userId,
        id: { in: ids },
        upload_status: 'ready',
        retention_status: 'active',
        ...(input.source === 'today' ? { deletion_requested_at: null } : {}),
      },
      select: {
        id: true,
        category: true,
        comfort_range: true,
      },
    })
    if (ownedGarments.length !== ids.length) {
      throw new NotFoundException('GARMENT_NOT_FOUND')
    }
    if (input.source === 'today') {
      const categoryById = new Map(ownedGarments.map((item) => [item.id, item.category]))
      if (
        input.composition.some(
          (slot) =>
            slot.kind === 'garment' && categoryById.get(slot.itemId) !== slot.category
        )
      ) {
        throw new NotFoundException('GARMENT_NOT_FOUND')
      }
    }
    if (input.source !== 'style_piece' || !input.anchorGarmentId) {
      return null
    }
    const anchorRow = ownedGarments.find((item) => item.id === input.anchorGarmentId)
    if (!anchorRow || !anchorRow.category || !anchorRow.comfort_range) {
      throw new NotFoundException('GARMENT_NOT_FOUND')
    }
    return savedLookAnchorSnapshotSchema.parse({
      garmentId: anchorRow.id,
      category: anchorRow.category,
      comfortRange: anchorRow.comfort_range,
    })
  }

  private buildSavedLookCreateData(params: {
    userId: string
    input: ParsedCreateSavedLookInput
    authoritativeSnapshot: StoredAnchorSnapshot | null
    canonicalSlots: StoredSlot[]
    canonicalSwaps: Record<string, string>
    idempotencyKey?: string
    payloadHash: string
  }): Prisma.SavedLookUncheckedCreateInput {
    const {
      userId,
      input,
      authoritativeSnapshot,
      canonicalSlots,
      canonicalSwaps,
      idempotencyKey,
      payloadHash,
    } = params
    return {
      user_id: userId,
      source: input.source,
      look_id: input.lookId,
      weather: input.weather,
      ...(input.wornOn ? { worn_on: new Date(`${input.wornOn}T00:00:00Z`) } : {}),
      title: input.title ?? null,
      anchor_garment_id: input.anchorGarmentId ?? null,
      anchor_snapshot:
        authoritativeSnapshot === null
          ? Prisma.JsonNull
          : (authoritativeSnapshot as Prisma.InputJsonValue),
      composition: canonicalSlots as unknown as Prisma.InputJsonValue,
      swaps: canonicalSwaps as Prisma.InputJsonValue,
      collection: input.collection ?? null,
      comfort:
        input.comfort == null
          ? Prisma.JsonNull
          : (input.comfort as Prisma.InputJsonValue),
      revision: 0,
      idempotency_key: idempotencyKey ?? null,
      idempotency_payload_hash: idempotencyKey ? payloadHash : null,
    }
  }

  async createSavedLook(
    actor: RequestAuthContext,
    input: ParsedCreateSavedLookInput,
    idempotencyKey?: string
  ): Promise<{ data: SavedLookContract; isReplay: boolean }> {
    const payloadHash = computeSavedLookPayloadHash(input)
    const canonicalSlots = canonicalizeComposition(input.composition)
    const canonicalSwaps = canonicalizeSwaps(input.swaps)
    const referencedGarmentIds = this.collectReferencedGarmentIds(input, canonicalSlots)

    if (
      (input.source === 'style_piece' || referencedGarmentIds.length > 0) &&
      !(await this.canAccessGarmentPhotos(actor, input.source))
    ) {
      throw new ForbiddenException('Guardian consent required before continuing')
    }

    if (idempotencyKey) {
      const replay = await this.findIdempotentReplay(actor, idempotencyKey, payloadHash)
      if (replay) return replay
    }

    if (
      input.source === 'today' &&
      canonicalSlots.some(
        (slot) =>
          slot.kind === 'catalog' &&
          !SAMPLE_CATALOG.garments.some(
            (piece) => piece.id === slot.itemId && piece.category === slot.category
          )
      )
    ) {
      throw new BadRequestException('Invalid Today catalog slot')
    }
    if (
      input.source === 'today' &&
      !weatherConditionSchema.safeParse(input.weather).success
    ) {
      throw new BadRequestException('Invalid Today weather condition')
    }

    const authoritativeSnapshot = await this.verifyOwnedGarmentsAndSnapshot(
      actor,
      input,
      referencedGarmentIds
    )

    try {
      const created = await this.prisma.savedLook.create({
        data: this.buildSavedLookCreateData({
          userId: actor.userId,
          input,
          authoritativeSnapshot,
          canonicalSlots,
          canonicalSwaps,
          idempotencyKey,
          payloadHash,
        }),
      })

      const [formatted] = await this.formatSavedLooks(actor, [created])
      return { data: formatted!, isReplay: false }
    } catch (error) {
      if (idempotencyKey && isUniqueConstraintError(error)) {
        const replay = await this.findIdempotentReplay(actor, idempotencyKey, payloadHash)
        if (replay) return replay
      }
      throw error
    }
  }

  /**
   * Story CC-7.6 D2: how many of the member's saved looks (not deleted) hold the garment, as
   * the anchor or in a composition slot. Read by the garment usage route before a delete.
   */
  async countSavedLooksUsingGarment(userId: string, garmentId: string): Promise<number> {
    // Counted in SQL: a member's saved looks have no cap. Same slots as
    // `collectGarmentIdsFromRow`: the anchor, or a composition slot of kind `garment` whose
    // `itemId` is the garment; `swaps` never count. A look holding it twice counts once.
    const slot = JSON.stringify([{ kind: 'garment', itemId: garmentId }])
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "SavedLook"
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
        AND (anchor_garment_id = ${garmentId} OR composition @> ${slot}::jsonb)
    `)
    return Number(rows[0]?.count ?? 0)
  }

  async listSavedLooks(
    actor: RequestAuthContext,
    query: ListSavedLooksQuery
  ): Promise<{
    data: SavedLookContract[]
    total: number
    limit: number
    offset: number
  }> {
    const source: Prisma.SavedLookWhereInput['source'] =
      query.includeToday && query.source === 'home_sample'
        ? { in: ['home_sample', 'today'] }
        : (query.source ?? (query.includeToday ? undefined : { not: 'today' }))
    const where: Prisma.SavedLookWhereInput = {
      user_id: actor.userId,
      deleted_at: null,
      ...(source ? { source } : {}),
      ...(query.anchorGarmentId ? { anchor_garment_id: query.anchorGarmentId } : {}),
    }

    const [rows, total] = await Promise.all([
      this.prisma.savedLook.findMany({
        where,
        // Story CC-7.12 D3: the Looks tab asks for newest saved first.
        orderBy:
          query.sort === 'created_desc'
            ? [{ created_at: 'desc' }, { id: 'asc' }]
            : [{ updated_at: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.savedLook.count({ where }),
    ])

    const data = await this.formatSavedLooks(actor, rows)
    return {
      data,
      total,
      limit: query.limit,
      offset: query.offset,
    }
  }

  async getSavedLook(
    actor: RequestAuthContext,
    savedLookId: string
  ): Promise<{ data: SavedLookContract }> {
    const row = await this.prisma.savedLook.findFirst({
      where: {
        id: savedLookId,
        user_id: actor.userId,
        deleted_at: null,
      },
    })
    if (!row) {
      throw new NotFoundException('SAVED_LOOK_NOT_FOUND')
    }
    const [formatted] = await this.formatSavedLooks(actor, [row])
    return { data: formatted! }
  }

  async restoreSavedLook(
    actor: RequestAuthContext,
    savedLookId: string
  ): Promise<{ data: SavedLookContract }> {
    const existing = await this.prisma.savedLook.findFirst({
      where: {
        id: savedLookId,
        user_id: actor.userId,
      },
    })
    if (!existing) {
      throw new NotFoundException('SAVED_LOOK_NOT_FOUND')
    }

    if (existing.deleted_at !== null) {
      await this.prisma.savedLook.updateMany({
        where: {
          id: savedLookId,
          user_id: actor.userId,
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          revision: { increment: 1 },
        },
      })
      const restored = await this.prisma.savedLook.findFirst({
        where: {
          id: savedLookId,
          user_id: actor.userId,
          deleted_at: null,
        },
      })
      if (!restored) {
        throw new NotFoundException('SAVED_LOOK_NOT_FOUND')
      }
      const [formatted] = await this.formatSavedLooks(actor, [restored])
      return { data: formatted! }
    }

    const [formatted] = await this.formatSavedLooks(actor, [existing])
    return { data: formatted! }
  }

  async deleteSavedLook(
    actor: RequestAuthContext,
    savedLookId: string,
    ifMatchHeader: string | undefined
  ): Promise<void> {
    const expectedRevisions = parseSavedLookIfMatchHeader(ifMatchHeader, savedLookId)

    const existing = await this.prisma.savedLook.findFirst({
      where: {
        id: savedLookId,
        user_id: actor.userId,
        deleted_at: null,
      },
      select: {
        id: true,
        revision: true,
      },
    })
    if (!existing) {
      throw new NotFoundException('SAVED_LOOK_NOT_FOUND')
    }
    if (expectedRevisions !== null && !expectedRevisions.includes(existing.revision)) {
      throw new PreconditionFailedException('SAVED_LOOK_REVISION_MISMATCH')
    }

    const result = await this.prisma.savedLook.updateMany({
      where: {
        id: savedLookId,
        user_id: actor.userId,
        deleted_at: null,
        ...(expectedRevisions !== null ? { revision: { in: expectedRevisions } } : {}),
      },
      data: {
        deleted_at: new Date(),
        revision: { increment: 1 },
      },
    })

    if (result.count === 0) {
      const remaining = await this.prisma.savedLook.findFirst({
        where: { id: savedLookId, user_id: actor.userId, deleted_at: null },
        select: { id: true },
      })
      if (remaining) {
        throw new PreconditionFailedException('SAVED_LOOK_REVISION_MISMATCH')
      }
      throw new NotFoundException('SAVED_LOOK_NOT_FOUND')
    }
  }
}
