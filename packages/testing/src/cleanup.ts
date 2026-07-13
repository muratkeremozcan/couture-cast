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
  paletteInsights: CleanupDelegate
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

export function configureCleanup({ prisma }: CleanupConfiguration): void {
  defaultCleanupPrisma = prisma
}

export function resetCleanupConfiguration(): void {
  defaultCleanupPrisma = null
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

  const outfitRecommendationWhere = buildDeleteWhere(ritualIds, userIds)
  const garmentItemWhere = buildDeleteWhere(wardrobeItemIds, userIds)
  const paletteInsightWhere = buildPaletteInsightWhere(wardrobeItemIds, userIds)

  try {
    await deleteByUserIds(userIds, [
      () =>
        prisma.eventEnvelope.deleteMany({
          where: buildUserFilter(userIds),
        }),
      () => prisma.alertCooldownReservation.deleteMany({}),
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

    if (paletteInsightWhere) {
      await prisma.paletteInsights.deleteMany({
        where: paletteInsightWhere,
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
