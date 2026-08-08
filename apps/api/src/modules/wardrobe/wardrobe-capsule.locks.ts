import { Prisma } from '@prisma/client'

/**
 * Shared lock protocol for every transaction that can change capsule
 * availability. Story 4.3 requires capsule mutation and
 * `WardrobeRetentionService` to acquire the same rows in the same order so the
 * two paths cannot deadlock against each other, and so the garment eligibility
 * check cannot race a retention transition.
 *
 * Order is always: owner `UserProfile` -> affected `OutfitCapsule` rows by id
 * -> affected `GarmentItem` rows by id. Callers must acquire each stage in this
 * order and must sort the id sets, which the helpers below do for them.
 *
 * Identifiers are quoted PascalCase because that is how Prisma creates them.
 * Unquoted identifiers fold to lower case in PostgreSQL and resolve to nothing.
 */

/**
 * Guarantees the owner's profile row exists, then locks it. The row doubles as
 * the serialization point for `capsule_revision`, so a missing profile would
 * otherwise leave concurrent capsule writes completely unserialized.
 */
export async function lockOwnerProfile(
  tx: Prisma.TransactionClient,
  ownerUserId: string
): Promise<void> {
  await tx.userProfile.upsert({
    where: { user_id: ownerUserId },
    create: { user_id: ownerUserId },
    update: {},
  })

  await tx.$queryRaw`SELECT 1 FROM "UserProfile" WHERE user_id = ${ownerUserId} FOR UPDATE`
}

export async function lockCapsules(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  capsuleIds: readonly string[]
): Promise<void> {
  const sorted = Array.from(new Set(capsuleIds)).sort()
  if (sorted.length === 0) {
    return
  }

  await tx.$queryRaw`SELECT 1 FROM "OutfitCapsule" WHERE id IN (${Prisma.join(sorted)}) AND user_id = ${ownerUserId} ORDER BY id FOR UPDATE`
}

export async function lockGarments(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  garmentIds: readonly string[]
): Promise<void> {
  const sorted = Array.from(new Set(garmentIds)).sort()
  if (sorted.length === 0) {
    return
  }

  await tx.$queryRaw`SELECT 1 FROM "GarmentItem" WHERE id IN (${Prisma.join(sorted)}) AND user_id = ${ownerUserId} ORDER BY id FOR UPDATE`
}

/**
 * A garment may only enter or remain in a capsule while it is fully uploaded
 * and retained. Both conditions are required; checking retention alone lets a
 * `pending_upload`, `processing`, or `failed` garment into a capsule and then
 * reports it as available.
 */
export const CAPSULE_ELIGIBLE_GARMENT_WHERE = {
  upload_status: 'ready',
  retention_status: 'active',
} as const
