import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import { CapsuleOccasion, Prisma, PrismaClient } from '@prisma/client'
import type {
  CreateOutfitCapsuleInput,
  ListOutfitCapsulesQuery,
  UpdateOutfitCapsuleInput,
} from '@couture/api-client'
import {
  CAPSULE_ELIGIBLE_GARMENT_WHERE,
  lockCapsules,
  lockGarments,
  lockOwnerProfile,
} from './wardrobe-capsule.locks.js'
import {
  canonicalizeDescription,
  canonicalizeName,
  canonicalizeSearchTerm,
  escapeLikePattern,
} from './wardrobe-capsule.normalize.js'
import {
  CapsuleTelemetryOutbox,
  type CapsuleMutationEventName,
} from './wardrobe-capsule.outbox.js'

/**
 * Lets the caller persist its analytics claim inside the mutation transaction.
 * `buildPayload` runs after the write, so it can read the committed revision.
 */
export interface CapsuleTelemetryRequest {
  eventName: CapsuleMutationEventName
  buildPayload: (
    capsule: CapsuleWithGarmentJoins,
    changedFields: CapsuleChangedField[]
  ) => Prisma.InputJsonObject
}

export type CapsuleWithGarmentJoins = Prisma.OutfitCapsuleGetPayload<{
  include: {
    garment_joins: {
      include: {
        garment: true
      }
    }
  }
}>

export interface CapsuleAuditActor {
  actorUserId: string
  actorRole: 'guardian' | 'admin'
}

/** Canonical order required by the `wardrobe_capsule_updated` analytics event. */
export const CAPSULE_CHANGED_FIELD_ORDER = [
  'name',
  'description',
  'occasions',
  'garmentIds',
  'isFavorite',
] as const

export type CapsuleChangedField = (typeof CAPSULE_CHANGED_FIELD_ORDER)[number]

const CAPSULE_INCLUDE = {
  garment_joins: {
    orderBy: {
      garment_order: 'asc' as const,
    },
    include: {
      garment: true,
    },
  },
} as const

/**
 * Prisma reports the violated constraint in `meta.target`, either as a column
 * list or as the constraint name. Only an idempotency-key collision may be
 * reported to the client as a key reuse; every other unique violation is a
 * different bug and must not be disguised as one.
 */
function isIdempotencyKeyViolation(error: Prisma.PrismaClientKnownRequestError): boolean {
  const target = error.meta?.['target']
  if (typeof target === 'string') {
    return target.includes('idempotency_key')
  }
  if (Array.isArray(target)) {
    return target.some((column) => String(column).includes('idempotency_key'))
  }
  return false
}

function orderedGarmentIds(capsule: CapsuleWithGarmentJoins): string[] {
  return [...capsule.garment_joins]
    .sort((a, b) => a.garment_order - b.garment_order)
    .map((join) => join.garment_id)
}

@Injectable()
export class WardrobeCapsuleRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * Verifies every supplied garment belongs to the owner and is both fully
   * uploaded and retained. Must run inside the transaction, after the garment
   * rows are locked, so a concurrent retention transition cannot slip between
   * the check and the write.
   */
  private async assertGarmentsEligible(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    garmentIds: readonly string[]
  ): Promise<void> {
    const eligible = await tx.garmentItem.findMany({
      where: {
        id: { in: [...garmentIds] },
        user_id: ownerUserId,
        ...CAPSULE_ELIGIBLE_GARMENT_WHERE,
      },
      select: { id: true },
    })

    if (eligible.length !== new Set(garmentIds).size) {
      throw new ConflictException('GARMENT_NOT_CAPSULE_ELIGIBLE')
    }
  }

  /**
   * The owner's profile row is the serialization point for cache invalidation.
   * `lockOwnerProfile` has already guaranteed the row exists, so this is a plain
   * update rather than an `updateMany` whose zero-row result nobody inspects.
   */
  private async bumpProfileRevision(
    tx: Prisma.TransactionClient,
    ownerUserId: string
  ): Promise<void> {
    await tx.userProfile.update({
      where: { user_id: ownerUserId },
      data: { capsule_revision: { increment: 1 } },
    })
  }

  /**
   * Writes the telemetry claim in the same transaction as the state change, so
   * a crash before delivery cannot lose the event and a rollback cannot leave a
   * claim for a mutation that never happened.
   */
  private async persistTelemetryClaim(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    capsule: CapsuleWithGarmentJoins,
    acceptedRevision: number,
    changedFields: CapsuleChangedField[],
    telemetry?: CapsuleTelemetryRequest
  ): Promise<void> {
    if (!telemetry) {
      return
    }

    await CapsuleTelemetryOutbox.persistClaim(
      tx,
      {
        ownerUserId,
        capsuleId: capsule.id,
        revision: acceptedRevision,
        eventName: telemetry.eventName,
      },
      telemetry.buildPayload(capsule, changedFields)
    )
  }

  private async writeAuditRecord(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    capsuleId: string,
    action: 'create' | 'update' | 'favorite' | 'delete',
    acceptedRevision: number,
    auditActor?: CapsuleAuditActor
  ): Promise<void> {
    if (!auditActor) {
      return
    }

    await tx.auditLog.create({
      data: {
        user_id: ownerUserId,
        event_type: 'wardrobe_capsule_mutated',
        event_data: {
          action,
          capsuleId,
          acceptedRevision,
          actorUserId: auditActor.actorUserId,
          actorRole: auditActor.actorRole,
        },
        timestamp: new Date(),
      },
    })
  }

  private assertDistinctGarments(garmentIds: readonly string[]): void {
    if (new Set(garmentIds).size !== garmentIds.length) {
      throw new BadRequestException('garmentIds must not contain duplicates')
    }
  }

  async createCapsule(
    ownerUserId: string,
    input: CreateOutfitCapsuleInput,
    idempotencyKey?: string,
    payloadHash?: string,
    auditActor?: CapsuleAuditActor,
    telemetry?: CapsuleTelemetryRequest
  ): Promise<{ capsule: CapsuleWithGarmentJoins; isReplay: boolean }> {
    this.assertDistinctGarments(input.garmentIds)

    const name = canonicalizeName(input.name)
    const description = canonicalizeDescription(input.description)

    if (idempotencyKey) {
      const existing = await this.prisma.outfitCapsule.findFirst({
        where: { user_id: ownerUserId, idempotency_key: idempotencyKey },
        include: CAPSULE_INCLUDE,
      })

      if (existing) {
        if (existing.idempotency_payload_hash === payloadHash) {
          return { capsule: existing, isReplay: true }
        }
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }
    }

    try {
      const capsule = await this.prisma.$transaction(async (tx) => {
        await lockOwnerProfile(tx, ownerUserId)
        await lockGarments(tx, ownerUserId, input.garmentIds)
        await this.assertGarmentsEligible(tx, ownerUserId, input.garmentIds)

        /**
         * Joins are inserted separately rather than nested. `user_id` on the join
         * is shared by the `user`, `capsule`, and `garment` relations, so Prisma
         * rejects it as a scalar inside a nested create. `createMany` takes the
         * unchecked input and accepts all three scalars directly, which is also
         * how the update path replaces the join set.
         */
        const createdCapsule = await tx.outfitCapsule.create({
          data: {
            user_id: ownerUserId,
            name,
            description,
            occasions: input.occasions as CapsuleOccasion[],
            is_favorite: input.isFavorite ?? false,
            revision: 1,
            idempotency_key: idempotencyKey ?? null,
            idempotency_payload_hash: payloadHash ?? null,
          },
        })

        await tx.outfitCapsuleGarment.createMany({
          data: input.garmentIds.map((garmentId, index) => ({
            user_id: ownerUserId,
            capsule_id: createdCapsule.id,
            garment_id: garmentId,
            garment_order: index,
          })),
        })

        const created = await tx.outfitCapsule.findFirstOrThrow({
          where: { id: createdCapsule.id, user_id: ownerUserId },
          include: CAPSULE_INCLUDE,
        })

        await this.bumpProfileRevision(tx, ownerUserId)
        await this.writeAuditRecord(
          tx,
          ownerUserId,
          created.id,
          'create',
          created.revision,
          auditActor
        )
        await this.persistTelemetryClaim(
          tx,
          ownerUserId,
          created,
          created.revision,
          [],
          telemetry
        )

        return created
      })

      return { capsule, isReplay: false }
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey &&
        isIdempotencyKeyViolation(error)
      ) {
        const existing = await this.prisma.outfitCapsule.findFirst({
          where: { user_id: ownerUserId, idempotency_key: idempotencyKey },
          include: CAPSULE_INCLUDE,
        })
        if (existing && existing.idempotency_payload_hash === payloadHash) {
          return { capsule: existing, isReplay: true }
        }
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }
      throw error
    }
  }

  async listCapsules(
    ownerUserId: string,
    query: ListOutfitCapsulesQuery
  ): Promise<{ items: CapsuleWithGarmentJoins[]; total: number }> {
    const where: Prisma.OutfitCapsuleWhereInput = {
      user_id: ownerUserId,
    }

    const searchTerm = canonicalizeSearchTerm(query.q)
    if (searchTerm !== undefined) {
      const pattern = escapeLikePattern(searchTerm)
      where.OR = [
        { name: { contains: pattern, mode: 'insensitive' } },
        { description: { contains: pattern, mode: 'insensitive' } },
      ]
    }

    if (query.occasion) {
      where.occasions = { has: query.occasion as CapsuleOccasion }
    }

    if (query.isFavorite !== undefined) {
      where.is_favorite = query.isFavorite
    }

    /**
     * `garmentId` and `comfortRange` are independent filters and each may match
     * a different constituent garment, so they become separate `some` clauses
     * rather than one conjunction on a single join row. Both are restricted to
     * currently available garments: retention deliberately retains join rows,
     * and a retained unavailable join must not make a capsule match.
     */
    const joinFilters: Prisma.OutfitCapsuleGarmentWhereInput[] = []

    if (query.garmentId) {
      joinFilters.push({
        garment_id: query.garmentId,
        garment: { ...CAPSULE_ELIGIBLE_GARMENT_WHERE },
      })
    }

    if (query.comfortRange) {
      joinFilters.push({
        garment: {
          ...CAPSULE_ELIGIBLE_GARMENT_WHERE,
          comfort_range: query.comfortRange,
        },
      })
    }

    if (joinFilters.length > 0) {
      where.AND = joinFilters.map((some) => ({ garment_joins: { some } }))
    }

    const [items, total] = await Promise.all([
      this.prisma.outfitCapsule.findMany({
        where,
        include: CAPSULE_INCLUDE,
        orderBy: [{ is_favorite: 'desc' }, { updated_at: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.outfitCapsule.count({ where }),
    ])

    return { items, total }
  }

  async findCapsuleById(
    ownerUserId: string,
    capsuleId: string
  ): Promise<CapsuleWithGarmentJoins | null> {
    return this.prisma.outfitCapsule.findFirst({
      where: {
        id: capsuleId,
        user_id: ownerUserId,
      },
      include: CAPSULE_INCLUDE,
    })
  }

  /**
   * Re-reads the capsule after its row lock is held and re-asserts the caller's
   * precondition. Checking the revision before the transaction cannot prevent a
   * lost update: two callers holding the same ETag would both pass an unlocked
   * check and both commit.
   */
  private async loadForMutation(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    capsuleId: string,
    expectedRevision: number | null
  ): Promise<CapsuleWithGarmentJoins> {
    const existing = await tx.outfitCapsule.findFirst({
      where: { id: capsuleId, user_id: ownerUserId },
      include: CAPSULE_INCLUDE,
    })

    if (!existing) {
      throw new NotFoundException('NOT_FOUND')
    }

    if (expectedRevision !== null && existing.revision !== expectedRevision) {
      throw new PreconditionFailedException('CAPSULE_REVISION_MISMATCH')
    }

    return existing
  }

  async updateCapsule(
    ownerUserId: string,
    capsuleId: string,
    expectedRevision: number | null,
    input: UpdateOutfitCapsuleInput,
    auditActor?: CapsuleAuditActor,
    telemetry?: CapsuleTelemetryRequest
  ): Promise<{
    capsule: CapsuleWithGarmentJoins
    isNoOp: boolean
    changedFields: CapsuleChangedField[]
  }> {
    if (input.garmentIds !== undefined) {
      this.assertDistinctGarments(input.garmentIds)
    }

    const nextName = input.name !== undefined ? canonicalizeName(input.name) : undefined
    const nextDescription =
      input.description !== undefined
        ? canonicalizeDescription(input.description)
        : undefined

    return this.prisma.$transaction(async (tx) => {
      await lockOwnerProfile(tx, ownerUserId)
      await lockCapsules(tx, ownerUserId, [capsuleId])

      const existing = await this.loadForMutation(
        tx,
        ownerUserId,
        capsuleId,
        expectedRevision
      )

      const nextGarmentIds = input.garmentIds
      const garmentIdsToLock = nextGarmentIds
        ? Array.from(new Set([...nextGarmentIds, ...orderedGarmentIds(existing)]))
        : orderedGarmentIds(existing)
      await lockGarments(tx, ownerUserId, garmentIdsToLock)

      const existingGarmentIds = orderedGarmentIds(existing)

      const isSameName = nextName === undefined || nextName === existing.name
      const isSameDescription =
        input.description === undefined || nextDescription === existing.description
      const isSameFavorite =
        input.isFavorite === undefined || input.isFavorite === existing.is_favorite
      let isSameOccasions = true
      if (input.occasions !== undefined) {
        const currentOccasions = [...existing.occasions].sort()
        const nextOccasions = [...input.occasions].sort()
        isSameOccasions =
          currentOccasions.length === nextOccasions.length &&
          currentOccasions.every((value, index) => value === nextOccasions[index])
      }
      const isSameGarments =
        nextGarmentIds === undefined ||
        (existingGarmentIds.length === nextGarmentIds.length &&
          existingGarmentIds.every((id, index) => id === nextGarmentIds[index]))

      /**
       * Reports the fields whose canonical persisted value actually changed, not
       * the fields the client happened to send. Resending an identical name is
       * not a change and must not appear in the analytics payload.
       */
      const changedFields: CapsuleChangedField[] = CAPSULE_CHANGED_FIELD_ORDER.filter(
        (field) =>
          (field === 'name' && !isSameName) ||
          (field === 'description' && !isSameDescription) ||
          (field === 'occasions' && !isSameOccasions) ||
          (field === 'garmentIds' && !isSameGarments) ||
          (field === 'isFavorite' && !isSameFavorite)
      )

      if (changedFields.length === 0) {
        return { capsule: existing, isNoOp: true, changedFields }
      }

      /**
       * Eligibility is revalidated on every state-changing update, not only when
       * the garment list is replaced. A metadata-only edit must not be able to
       * carry a capsule that has since acquired an ineligible garment.
       */
      await this.assertGarmentsEligible(
        tx,
        ownerUserId,
        nextGarmentIds ?? existingGarmentIds
      )

      if (nextGarmentIds) {
        await tx.outfitCapsuleGarment.deleteMany({
          where: { capsule_id: capsuleId, user_id: ownerUserId },
        })

        await tx.outfitCapsuleGarment.createMany({
          data: nextGarmentIds.map((garmentId, index) => ({
            user_id: ownerUserId,
            capsule_id: capsuleId,
            garment_id: garmentId,
            garment_order: index,
          })),
        })
      }

      const res = await tx.outfitCapsule.update({
        where: { id_user_id: { id: capsuleId, user_id: ownerUserId } },
        data: {
          name: nextName,
          description: input.description !== undefined ? nextDescription : undefined,
          occasions: input.occasions ? (input.occasions as CapsuleOccasion[]) : undefined,
          is_favorite: input.isFavorite,
          revision: { increment: 1 },
          updated_at: new Date(),
        },
        include: CAPSULE_INCLUDE,
      })

      await this.bumpProfileRevision(tx, ownerUserId)
      await this.writeAuditRecord(
        tx,
        ownerUserId,
        res.id,
        'update',
        res.revision,
        auditActor
      )
      await this.persistTelemetryClaim(
        tx,
        ownerUserId,
        res,
        res.revision,
        changedFields,
        telemetry
      )

      return { capsule: res, isNoOp: false, changedFields }
    })
  }

  async setFavoriteStatus(
    ownerUserId: string,
    capsuleId: string,
    expectedRevision: number | null,
    isFavorite: boolean,
    auditActor?: CapsuleAuditActor,
    telemetry?: CapsuleTelemetryRequest
  ): Promise<{ capsule: CapsuleWithGarmentJoins; isNoOp: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerProfile(tx, ownerUserId)
      await lockCapsules(tx, ownerUserId, [capsuleId])

      const existing = await this.loadForMutation(
        tx,
        ownerUserId,
        capsuleId,
        expectedRevision
      )

      if (existing.is_favorite === isFavorite) {
        return { capsule: existing, isNoOp: true }
      }

      const res = await tx.outfitCapsule.update({
        where: { id_user_id: { id: capsuleId, user_id: ownerUserId } },
        data: {
          is_favorite: isFavorite,
          revision: { increment: 1 },
          updated_at: new Date(),
        },
        include: CAPSULE_INCLUDE,
      })

      await this.bumpProfileRevision(tx, ownerUserId)
      await this.writeAuditRecord(
        tx,
        ownerUserId,
        res.id,
        'favorite',
        res.revision,
        auditActor
      )
      await this.persistTelemetryClaim(tx, ownerUserId, res, res.revision, [], telemetry)

      return { capsule: res, isNoOp: false }
    })
  }

  async deleteCapsule(
    ownerUserId: string,
    capsuleId: string,
    expectedRevision: number | null,
    auditActor?: CapsuleAuditActor,
    telemetry?: CapsuleTelemetryRequest
  ): Promise<{ acceptedRevision: number }> {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerProfile(tx, ownerUserId)
      await lockCapsules(tx, ownerUserId, [capsuleId])

      const existing = await this.loadForMutation(
        tx,
        ownerUserId,
        capsuleId,
        expectedRevision
      )

      await tx.outfitRecommendation.updateMany({
        where: { capsule_id: capsuleId, user_id: ownerUserId },
        data: { capsule_id: null },
      })

      await tx.outfitCapsuleGarment.deleteMany({
        where: { capsule_id: capsuleId, user_id: ownerUserId },
      })

      await tx.outfitCapsule.delete({
        where: { id_user_id: { id: capsuleId, user_id: ownerUserId } },
      })

      await this.bumpProfileRevision(tx, ownerUserId)
      await this.writeAuditRecord(
        tx,
        ownerUserId,
        capsuleId,
        'delete',
        existing.revision,
        auditActor
      )
      /**
       * The claim deliberately carries no foreign key to `OutfitCapsule`, so a
       * delete event survives the row it describes.
       */
      await this.persistTelemetryClaim(
        tx,
        ownerUserId,
        existing,
        existing.revision,
        [],
        telemetry
      )

      return { acceptedRevision: existing.revision }
    })
  }
}
