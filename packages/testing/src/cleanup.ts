/* eslint-disable complexity */
import {
  factoryRegistry,
  type FactoryRegistry,
  type FactoryRegistryKey,
  registerCreatedEntity,
  resetTrackedEntities,
  snapshotTrackedEntities,
} from './factories/registry.js'

type CleanupDelegate = {
  deleteMany(args: unknown): Promise<unknown>
}

export interface CleanupPrismaClient {
  alertRule: CleanupDelegate
  auditLog: CleanupDelegate
  comfortPreferences: CleanupDelegate
  engagementEvent: CleanupDelegate
  forecastSegment: CleanupDelegate
  garmentItem: CleanupDelegate
  guardianConsent: CleanupDelegate
  guardianInvitation: CleanupDelegate
  lookbookPost: CleanupDelegate
  notificationPreference: CleanupDelegate
  outfitRecommendation: CleanupDelegate
  outfitCapsule: CleanupDelegate
  outfitCapsuleGarment: CleanupDelegate
  paletteInsights: CleanupDelegate
  wardrobeOnboardingState: CleanupDelegate
  silhouetteProfile: CleanupDelegate
  moderationEvent: CleanupDelegate
  pushToken: CleanupDelegate
  savedLocation: CleanupDelegate
  user: CleanupDelegate
  userProfile: CleanupDelegate
  weatherSnapshot: CleanupDelegate
  eventEnvelope: CleanupDelegate
  alertDeliveryOutbox: CleanupDelegate
  alertCooldownReservation: CleanupDelegate
}

export interface CleanupConfiguration {
  prisma: CleanupPrismaClient
}

export interface CleanupOptions {
  prisma?: CleanupPrismaClient
  registry?: FactoryRegistry<FactoryRegistryKey>
}

let defaultCleanupPrisma: CleanupPrismaClient | null = null

/*
 * AlertCooldownReservation is keyed by a hash of (userId, locationKey,
 * fingerprint) and carries no owner column, so it cannot be filtered by the
 * tracked user ids the way every other table here is. It was therefore emptied
 * with an unscoped deleteMany({}), which destroys rows this run never created —
 * harmless against a disposable database, not harmless the moment
 * configureCleanup is pointed at a shared one. This anchor bounds the delete to
 * rows that could plausibly belong to the current process.
 */
let cleanupScopeStartedAt = new Date()

export function configureCleanup({ prisma }: CleanupConfiguration): void {
  defaultCleanupPrisma = prisma
  cleanupScopeStartedAt = new Date()
}

export function resetCleanupConfiguration(): void {
  defaultCleanupPrisma = null
  cleanupScopeStartedAt = new Date()
}

export function registerForCleanup(type: FactoryRegistryKey, id: string): string {
  return registerCreatedEntity(type, id)
}

export function resetCleanupRegistry(type?: FactoryRegistryKey): void {
  resetTrackedEntities(type)
}

export function snapshotCleanupRegistry(): Readonly<
  Record<FactoryRegistryKey, readonly string[]>
> {
  return snapshotTrackedEntities()
}

function resolveCleanupPrisma(prisma?: CleanupPrismaClient): CleanupPrismaClient {
  if (prisma) {
    return prisma
  }

  if (defaultCleanupPrisma) {
    return defaultCleanupPrisma
  }

  throw new Error(
    'cleanup requires a Prisma client. Pass cleanup({ prisma }) or call configureCleanup({ prisma }) first.'
  )
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function buildIdFilter(ids: readonly string[]) {
  return {
    id: {
      in: uniqueValues(ids),
    },
  }
}

function buildUserFilter(userIds: readonly string[]) {
  return {
    user_id: {
      in: uniqueValues(userIds),
    },
  }
}

function buildDeleteWhere(
  ids: readonly string[],
  userIds: readonly string[] = []
): { OR: Record<string, { in: string[] }>[] } | null {
  const filters: Record<string, { in: string[] }>[] = []

  if (ids.length > 0) {
    filters.push(buildIdFilter(ids))
  }

  if (userIds.length > 0) {
    filters.push(buildUserFilter(userIds))
  }

  if (filters.length === 0) {
    return null
  }

  return { OR: filters }
}

type PaletteInsightWhereClause =
  | { garment_item_id: { in: string[] } }
  | { user_id: { in: string[] } }

function buildPaletteInsightWhere(
  garmentItemIds: readonly string[],
  userIds: readonly string[]
): { OR: PaletteInsightWhereClause[] } | null {
  const filters: PaletteInsightWhereClause[] = []

  if (garmentItemIds.length > 0) {
    filters.push({
      garment_item_id: {
        in: uniqueValues(garmentItemIds),
      },
    })
  }

  if (userIds.length > 0) {
    filters.push({
      user_id: {
        in: uniqueValues(userIds),
      },
    })
  }

  if (filters.length === 0) {
    return null
  }

  return { OR: filters }
}

type ModerationEventWhereClause =
  | { id: { in: string[] } }
  | { silhouette_profile_id: { in: string[] } }

/**
 * ModerationEvent has no user_id column (it references garment_item_id,
 * silhouette_profile_id, post_id, flagged_by_id, reviewed_by_id instead), so
 * it needs its own where-builder rather than buildUserFilter.
 */
function buildModerationEventWhere(
  moderationEventIds: readonly string[],
  silhouetteProfileIds: readonly string[]
): { OR: ModerationEventWhereClause[] } | null {
  const filters: ModerationEventWhereClause[] = []

  if (moderationEventIds.length > 0) {
    filters.push({ id: { in: uniqueValues(moderationEventIds) } })
  }

  if (silhouetteProfileIds.length > 0) {
    filters.push({ silhouette_profile_id: { in: uniqueValues(silhouetteProfileIds) } })
  }

  if (filters.length === 0) {
    return null
  }

  return { OR: filters }
}

async function deleteByUserIds(
  userIds: readonly string[],
  deletes: (() => Promise<unknown>)[]
): Promise<void> {
  if (userIds.length === 0) {
    return
  }

  for (const remove of deletes) {
    await remove()
  }
}

export async function cleanup(options: CleanupOptions = {}): Promise<void> {
  const prisma = resolveCleanupPrisma(options.prisma)
  const registry = options.registry ?? factoryRegistry
  const tracked = registry.snapshot()

  const userIds = uniqueValues(tracked.users)
  const wardrobeItemIds = uniqueValues(tracked.wardrobeItems)
  const ritualIds = uniqueValues(tracked.rituals)
  const savedLocationIds = uniqueValues(tracked.savedLocations)
  const weatherSnapshotIds = uniqueValues(tracked.weatherSnapshots)
  const alertRuleIds = uniqueValues(tracked.alertRules)
  const notificationPreferenceIds = uniqueValues(tracked.notificationPreferences)

  const outfitCapsuleIds = uniqueValues(tracked.outfitCapsules)
  const outfitCapsuleGarmentIds = uniqueValues(tracked.outfitCapsuleGarments)
  const wardrobeOnboardingStateIds = uniqueValues(tracked.wardrobeOnboardingStates)
  const silhouetteProfileIds = uniqueValues(tracked.silhouetteProfiles)
  const moderationEventIds = uniqueValues(tracked.moderationEvents)

  const outfitRecommendationWhere = buildDeleteWhere(ritualIds, userIds)
  const outfitCapsuleGarmentWhere = buildDeleteWhere(outfitCapsuleGarmentIds, userIds)
  const outfitCapsuleWhere = buildDeleteWhere(outfitCapsuleIds, userIds)
  const garmentItemWhere = buildDeleteWhere(wardrobeItemIds, userIds)
  const paletteInsightWhere = buildPaletteInsightWhere(wardrobeItemIds, userIds)
  const moderationEventWhere = buildModerationEventWhere(
    moderationEventIds,
    silhouetteProfileIds
  )
  const silhouetteProfileWhere = buildDeleteWhere(silhouetteProfileIds, userIds)
  const wardrobeOnboardingStateWhere = buildDeleteWhere(
    wardrobeOnboardingStateIds,
    userIds
  )

  try {
    await deleteByUserIds(userIds, [
      () =>
        prisma.eventEnvelope.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.alertCooldownReservation.deleteMany({
          where: { created_at: { gte: cleanupScopeStartedAt } },
        }),
      () =>
        prisma.engagementEvent.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.lookbookPost.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.auditLog.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.pushToken.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.alertRule.deleteMany({
          where:
            alertRuleIds.length > 0
              ? {
                  OR: [buildIdFilter(alertRuleIds), buildUserFilter(userIds)],
                }
              : buildUserFilter(userIds),
        }),
      () =>
        prisma.notificationPreference.deleteMany({
          where:
            notificationPreferenceIds.length > 0
              ? {
                  OR: [
                    buildIdFilter(notificationPreferenceIds),
                    buildUserFilter(userIds),
                  ],
                }
              : buildUserFilter(userIds),
        }),
      () =>
        prisma.savedLocation.deleteMany({
          where:
            savedLocationIds.length > 0
              ? {
                  OR: [buildIdFilter(savedLocationIds), buildUserFilter(userIds)],
                }
              : buildUserFilter(userIds),
        }),
    ])

    if (savedLocationIds.length > 0 && userIds.length === 0) {
      await prisma.savedLocation.deleteMany({
        where: buildIdFilter(savedLocationIds),
      })
    }

    if (alertRuleIds.length > 0 && userIds.length === 0) {
      await prisma.alertRule.deleteMany({
        where: buildIdFilter(alertRuleIds),
      })
    }

    if (notificationPreferenceIds.length > 0 && userIds.length === 0) {
      await prisma.notificationPreference.deleteMany({
        where: buildIdFilter(notificationPreferenceIds),
      })
    }

    if (outfitRecommendationWhere) {
      await prisma.outfitRecommendation.deleteMany({
        where: outfitRecommendationWhere,
      })
    }

    if (outfitCapsuleGarmentWhere) {
      await prisma.outfitCapsuleGarment.deleteMany({
        where: outfitCapsuleGarmentWhere,
      })
    }

    if (outfitCapsuleWhere) {
      await prisma.outfitCapsule.deleteMany({
        where: outfitCapsuleWhere,
      })
    }

    if (paletteInsightWhere) {
      await prisma.paletteInsights.deleteMany({
        where: paletteInsightWhere,
      })
    }

    // Moderation events reference a silhouette profile before the profile
    // itself is removed, before the owning user (Story 4.4 Task 2).
    if (moderationEventWhere) {
      await prisma.moderationEvent.deleteMany({
        where: moderationEventWhere,
      })
    }

    if (silhouetteProfileWhere) {
      await prisma.silhouetteProfile.deleteMany({
        where: silhouetteProfileWhere,
      })
    }

    if (wardrobeOnboardingStateWhere) {
      await prisma.wardrobeOnboardingState.deleteMany({
        where: wardrobeOnboardingStateWhere,
      })
    }

    if (garmentItemWhere) {
      await prisma.garmentItem.deleteMany({
        where: garmentItemWhere,
      })
    }

    if (weatherSnapshotIds.length > 0) {
      await prisma.forecastSegment.deleteMany({
        where: {
          weather_snapshot_id: {
            in: weatherSnapshotIds,
          },
        },
      })
    }

    if (weatherSnapshotIds.length > 0) {
      await prisma.weatherSnapshot.deleteMany({
        where: buildIdFilter(weatherSnapshotIds),
      })
    }

    if (userIds.length > 0) {
      await prisma.guardianInvitation.deleteMany({
        where: {
          OR: [
            {
              teen_id: {
                in: userIds,
              },
            },
            {
              accepted_guardian_id: {
                in: userIds,
              },
            },
          ],
        },
      })
    }

    if (userIds.length > 0) {
      await prisma.guardianConsent.deleteMany({
        where: {
          OR: [
            {
              guardian_id: {
                in: userIds,
              },
            },
            {
              teen_id: {
                in: userIds,
              },
            },
          ],
        },
      })
    }

    await deleteByUserIds(userIds, [
      () =>
        prisma.comfortPreferences.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.userProfile.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () =>
        prisma.user.deleteMany({
          where: buildIdFilter(userIds),
        }),
    ])
  } finally {
    registry.clear()
  }
}
