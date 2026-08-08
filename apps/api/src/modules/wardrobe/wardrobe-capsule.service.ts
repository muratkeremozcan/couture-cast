import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import {
  type CreateOutfitCapsuleInput,
  type FavoriteOutfitCapsuleInput,
  type ListOutfitCapsulesQuery,
  type OutfitCapsuleContract,
  type UpdateOutfitCapsuleInput,
  outfitCapsuleSchema,
  trackWardrobeCapsuleCreated,
  trackWardrobeCapsuleDeleted,
  trackWardrobeCapsuleFavoriteChanged,
  trackWardrobeCapsuleUpdated,
} from '@couture/api-client'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { RitualService } from '../personalization/ritual.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeAccessService } from './wardrobe-access.service.js'
import {
  WardrobeCapsuleRepository,
  type CapsuleWithGarmentJoins,
} from './wardrobe-capsule.repository.js'
import {
  canonicalizeDescription,
  canonicalizeName,
  sortOccasions,
} from './wardrobe-capsule.normalize.js'
import { CapsuleTelemetryOutbox } from './wardrobe-capsule.outbox.js'
import {
  SupabaseWardrobeStorageAdapter,
  type WardrobeStorage,
} from './wardrobe-storage.adapter.js'

/**
 * Response shapes are derived from the canonical Zod contract rather than the
 * generated SDK models. The generated `OutfitCapsuleResponse` shares its name
 * with the contract type and models `imageAccess` as non-nullable, which the
 * contract does not.
 */
type CapsuleResponse = { data: OutfitCapsuleContract }
type CapsuleListResponse = {
  data: OutfitCapsuleContract[]
  total: number
  limit: number
  offset: number
}

const READ_URL_EXPIRY_SECONDS = 900

/** Bounds concurrent storage signing so one large page cannot open hundreds of
 * simultaneous connections to Supabase. */
const SIGN_CONCURRENCY = 8

/** The strong entity tag this API issues and accepts: `"capsule:<id>:<revision>"`. */
export function formatCapsuleETag(capsuleId: string, revision: number): string {
  return `"capsule:${capsuleId}:${revision}"`
}

/**
 * Parses `If-Match` against the ETag this API actually issues.
 *
 * Returns the expected revision, or `null` for `*` which per RFC 9110 matches
 * the resource in any current state. A weak validator is not usable with
 * `If-Match`, and an entity tag naming a different capsule is not a statement
 * about this resource, so both are rejected as a failed precondition.
 */
export function parseIfMatchHeader(
  ifMatchHeader: string | undefined,
  capsuleId: string
): number | null {
  if (!ifMatchHeader || ifMatchHeader.trim().length === 0) {
    throw new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
  }

  const raw = ifMatchHeader.trim()
  if (raw === '*') {
    return null
  }

  const candidates = raw.split(',').map((entry) => entry.trim())

  for (const candidate of candidates) {
    if (/^W\//i.test(candidate)) {
      continue
    }

    const match = /^"capsule:(.+):(\d+)"$/.exec(candidate)
    if (!match) {
      continue
    }

    const [, taggedCapsuleId, revisionText] = match
    if (taggedCapsuleId !== capsuleId) {
      continue
    }

    const revision = Number(revisionText)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      continue
    }

    return revision
  }

  throw new PreconditionFailedException('CAPSULE_REVISION_MISMATCH')
}

/**
 * Hashes the canonical form of a create payload so that Unicode-equivalent and
 * key-order-equivalent requests replay the same capsule. Normalization here must
 * match what the repository persists, or a replay would hash differently than
 * the row it is meant to match.
 */
export function computeCapsulePayloadHash(input: {
  name: string
  description?: string | null
  occasions: string[]
  garmentIds: string[]
  isFavorite?: boolean
}): string {
  const normalized = {
    name: canonicalizeName(input.name),
    description: canonicalizeDescription(input.description),
    occasions: sortOccasions(input.occasions),
    garmentIds: [...input.garmentIds],
    isFavorite: input.isFavorite ?? false,
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

@Injectable()
export class WardrobeCapsuleService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-capsule' })

  constructor(
    private readonly repository: WardrobeCapsuleRepository,
    private readonly accessService: WardrobeAccessService,
    private readonly outbox: CapsuleTelemetryOutbox,
    private readonly ritualService: RitualService,
    @Inject(SupabaseWardrobeStorageAdapter) private readonly storage: WardrobeStorage,
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient
  ) {}

  /**
   * Signs each distinct object path once for the whole response and bounds
   * concurrency. Formatting per garment would issue one signing call per join,
   * which is up to 1,000 serial calls for a full page of capsules.
   */
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
            this.logger.error(
              {
                objectPath,
                message: 'capsule_image_signing_failed',
                error: error instanceof Error ? error.message : 'unknown error',
              },
              'Failed to sign capsule garment image URL'
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

  /**
   * Clears the owner's cached ritual payloads after a committed capsule change.
   * This is a latency optimization only: the capsule revision stamped into both
   * the Redis payload and the persisted recommendation is what actually
   * guarantees freshness, so a Redis failure here must not fail the mutation or
   * serve stale capsules.
   */
  private async invalidateRitualCache(ownerUserId: string): Promise<void> {
    try {
      const invalidated = await this.ritualService.invalidateUserCache(ownerUserId)
      if (!invalidated) {
        this.logger.warn(
          { ownerUserId, message: 'capsule_ritual_cache_invalidation_failed' },
          'Ritual cache clear failed after capsule mutation; revision check remains authoritative'
        )
      }
    } catch (error: unknown) {
      this.logger.warn(
        {
          ownerUserId,
          message: 'capsule_ritual_cache_invalidation_failed',
          error: error instanceof Error ? error.message : 'unknown error',
        },
        'Ritual cache clear threw after capsule mutation; revision check remains authoritative'
      )
    }
  }

  private isGarmentAvailable(
    garment: CapsuleWithGarmentJoins['garment_joins'][number]['garment']
  ): boolean {
    return (
      garment !== null &&
      garment !== undefined &&
      garment.upload_status === 'ready' &&
      garment.retention_status === 'active'
    )
  }

  /**
   * Formats capsules and validates each against the canonical response schema.
   * Parsing here is what stops a row that violates a contract invariant, such as
   * an empty name, from reaching a client that will refuse to parse it.
   *
   * Unavailable garments are reported only as a count. Their details are
   * excluded so a purged garment's metadata is not served back to the client.
   */
  private async formatCapsules(
    capsules: CapsuleWithGarmentJoins[]
  ): Promise<OutfitCapsuleContract[]> {
    const objectPaths = capsules.flatMap((capsule) =>
      capsule.garment_joins
        .filter(
          (join) => this.isGarmentAvailable(join.garment) && join.garment?.object_path
        )
        .map((join) => join.garment.object_path as string)
    )
    const signedUrls = await this.signReadUrls(objectPaths)
    const expiresAt = new Date(Date.now() + READ_URL_EXPIRY_SECONDS * 1000).toISOString()

    return capsules.map((capsule) => {
      const availableJoins = capsule.garment_joins.filter((join) =>
        this.isGarmentAvailable(join.garment)
      )
      const unavailableGarmentCount = capsule.garment_joins.length - availableJoins.length

      const garments = availableJoins.map((join) => {
        const objectPath = join.garment.object_path
        const url = objectPath ? signedUrls.get(objectPath) : undefined

        return {
          id: join.garment_id,
          category: join.garment.category,
          material: join.garment.material,
          comfortRange: join.garment.comfort_range,
          imageAccess: url ? { url, expiresAt } : null,
          availabilityStatus: 'ready' as const,
          garmentOrder: join.garment_order,
        }
      })

      return outfitCapsuleSchema.parse({
        id: capsule.id,
        ownerUserId: capsule.user_id,
        name: capsule.name,
        description: capsule.description,
        occasions: sortOccasions(capsule.occasions),
        isFavorite: capsule.is_favorite,
        revision: capsule.revision,
        availabilityStatus: unavailableGarmentCount === 0 ? 'ready' : 'needs_repair',
        unavailableGarmentCount,
        garments,
        createdAt: capsule.created_at.toISOString(),
        updatedAt: capsule.updated_at.toISOString(),
      })
    })
  }

  private async formatCapsule(
    capsule: CapsuleWithGarmentJoins
  ): Promise<OutfitCapsuleContract> {
    const [formatted] = await this.formatCapsules([capsule])
    if (!formatted) {
      throw new NotFoundException('NOT_FOUND')
    }
    return formatted
  }

  async createCapsule(
    actor: RequestAuthContext,
    ownerUserId: string,
    input: CreateOutfitCapsuleInput,
    idempotencyKey?: string
  ): Promise<{ data: OutfitCapsuleContract; isReplay: boolean }> {
    const access = await this.accessService.assertWriteAccess(actor, ownerUserId)
    const payloadHash = idempotencyKey ? computeCapsulePayloadHash(input) : undefined
    const auditActor =
      access.actorRole !== 'owner'
        ? { actorUserId: actor.userId, actorRole: access.actorRole }
        : undefined

    const result = await this.repository.createCapsule(
      ownerUserId,
      input,
      idempotencyKey,
      payloadHash,
      auditActor,
      {
        eventName: 'wardrobe_capsule_created',
        buildPayload: (capsule) =>
          trackWardrobeCapsuleCreated({
            analyticsSubjectId: ownerUserId,
            capsuleId: capsule.id,
            garmentCount: capsule.garment_joins.length,
            occasions: sortOccasions(capsule.occasions),
            isFavorite: capsule.is_favorite,
            actorRole: access.actorRole,
          }) as unknown as Prisma.InputJsonObject,
      }
    )

    /** An idempotent replay reuses the winner's claim and emits nothing new. */
    if (!result.isReplay) {
      await this.invalidateRitualCache(ownerUserId)
      await this.outbox.dispatchAfterCommit({
        ownerUserId,
        capsuleId: result.capsule.id,
        revision: result.capsule.revision,
        eventName: 'wardrobe_capsule_created',
      })
    }

    const formatted = await this.formatCapsule(result.capsule)
    return { data: formatted, isReplay: result.isReplay }
  }

  async listCapsules(
    actor: RequestAuthContext,
    ownerUserId: string,
    query: ListOutfitCapsulesQuery
  ): Promise<CapsuleListResponse> {
    await this.accessService.assertReadAccess(actor, ownerUserId)
    const { items, total } = await this.repository.listCapsules(ownerUserId, query)
    const data = await this.formatCapsules(items)

    return {
      data,
      total,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    }
  }

  async getCapsule(
    actor: RequestAuthContext,
    ownerUserId: string,
    capsuleId: string
  ): Promise<CapsuleResponse> {
    await this.accessService.assertReadAccess(actor, ownerUserId)
    const capsule = await this.repository.findCapsuleById(ownerUserId, capsuleId)
    if (!capsule) {
      throw new NotFoundException('NOT_FOUND')
    }

    return { data: await this.formatCapsule(capsule) }
  }

  async updateCapsule(
    actor: RequestAuthContext,
    ownerUserId: string,
    capsuleId: string,
    ifMatchHeader: string | undefined,
    input: UpdateOutfitCapsuleInput
  ): Promise<CapsuleResponse> {
    const access = await this.accessService.assertWriteAccess(actor, ownerUserId)
    const expectedRevision = parseIfMatchHeader(ifMatchHeader, capsuleId)
    const auditActor =
      access.actorRole !== 'owner'
        ? { actorUserId: actor.userId, actorRole: access.actorRole }
        : undefined

    const result = await this.repository.updateCapsule(
      ownerUserId,
      capsuleId,
      expectedRevision,
      input,
      auditActor,
      {
        eventName: 'wardrobe_capsule_updated',
        buildPayload: (capsule, changedFields) =>
          trackWardrobeCapsuleUpdated({
            analyticsSubjectId: ownerUserId,
            capsuleId: capsule.id,
            changedFields,
            garmentCount: capsule.garment_joins.length,
            occasions: sortOccasions(capsule.occasions),
            isFavorite: capsule.is_favorite,
            actorRole: access.actorRole,
          }) as unknown as Prisma.InputJsonObject,
      }
    )

    /** A canonical no-op writes nothing, so there is no claim to dispatch. */
    if (!result.isNoOp) {
      await this.invalidateRitualCache(ownerUserId)
      await this.outbox.dispatchAfterCommit({
        ownerUserId,
        capsuleId: result.capsule.id,
        revision: result.capsule.revision,
        eventName: 'wardrobe_capsule_updated',
      })
    }

    return { data: await this.formatCapsule(result.capsule) }
  }

  async setFavoriteStatus(
    actor: RequestAuthContext,
    ownerUserId: string,
    capsuleId: string,
    ifMatchHeader: string | undefined,
    input: FavoriteOutfitCapsuleInput
  ): Promise<CapsuleResponse> {
    const access = await this.accessService.assertWriteAccess(actor, ownerUserId)
    const expectedRevision = parseIfMatchHeader(ifMatchHeader, capsuleId)
    const auditActor =
      access.actorRole !== 'owner'
        ? { actorUserId: actor.userId, actorRole: access.actorRole }
        : undefined

    const result = await this.repository.setFavoriteStatus(
      ownerUserId,
      capsuleId,
      expectedRevision,
      input.isFavorite,
      auditActor,
      {
        eventName: 'wardrobe_capsule_favorite_changed',
        buildPayload: (capsule) =>
          trackWardrobeCapsuleFavoriteChanged({
            analyticsSubjectId: ownerUserId,
            capsuleId: capsule.id,
            requestedState: input.isFavorite,
            actorRole: access.actorRole,
          }) as unknown as Prisma.InputJsonObject,
      }
    )

    if (!result.isNoOp) {
      await this.invalidateRitualCache(ownerUserId)
      await this.outbox.dispatchAfterCommit({
        ownerUserId,
        capsuleId: result.capsule.id,
        revision: result.capsule.revision,
        eventName: 'wardrobe_capsule_favorite_changed',
      })
    }

    return { data: await this.formatCapsule(result.capsule) }
  }

  async deleteCapsule(
    actor: RequestAuthContext,
    ownerUserId: string,
    capsuleId: string,
    ifMatchHeader: string | undefined
  ): Promise<void> {
    const access = await this.accessService.assertWriteAccess(actor, ownerUserId)
    const expectedRevision = parseIfMatchHeader(ifMatchHeader, capsuleId)
    const auditActor =
      access.actorRole !== 'owner'
        ? { actorUserId: actor.userId, actorRole: access.actorRole }
        : undefined

    const { acceptedRevision } = await this.repository.deleteCapsule(
      ownerUserId,
      capsuleId,
      expectedRevision,
      auditActor,
      {
        eventName: 'wardrobe_capsule_deleted',
        buildPayload: () =>
          trackWardrobeCapsuleDeleted({
            analyticsSubjectId: ownerUserId,
            capsuleId,
            actorRole: access.actorRole,
          }) as unknown as Prisma.InputJsonObject,
      }
    )

    await this.invalidateRitualCache(ownerUserId)
    await this.outbox.dispatchAfterCommit({
      ownerUserId,
      capsuleId,
      revision: acceptedRevision,
      eventName: 'wardrobe_capsule_deleted',
    })
  }
}
