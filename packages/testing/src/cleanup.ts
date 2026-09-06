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
  commercePartner: CleanupDelegate
  affiliateOffer: CleanupDelegate
  commercePreference: CleanupDelegate
  affiliateClick: CleanupDelegate
  affiliateConversion: CleanupDelegate
  premiumEntitlement: CleanupDelegate
  billingEvent: CleanupDelegate
  billingCustomer: CleanupDelegate
  premiumThemePreference: CleanupDelegate
  paletteProfile: CleanupDelegate
  advisorRecommendationState: CleanupDelegate
  plannerDayPlan: CleanupDelegate
  communityChallenge: CleanupDelegate
  communityModerationOutbox: CleanupDelegate
  communityAlias: CleanupDelegate
  communityPostReport: CleanupDelegate
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
  | { post_id: { in: string[] } }
  | { flagged_by_id: { in: string[] } }

/**
 * ModerationEvent has no user_id column (it references garment_item_id,
 * silhouette_profile_id, post_id, flagged_by_id, reviewed_by_id instead), so
 * it needs its own where-builder rather than buildUserFilter.
 *
 * Story 6.1 added the post and reporter branches. Before them this builder
 * filtered on id and silhouette_profile_id only, so a moderation row written by
 * a community report — which carries a post_id and a flagged_by_id and neither
 * of the other two — was unreachable by cleanup entirely. That was survivable
 * only while ModerationEvent.post_id cascaded from the post; it no longer does
 * (the cascade destroyed third-party reports on account erasure), so an
 * unreachable row is now a row left behind.
 */
function buildModerationEventWhere(
  moderationEventIds: readonly string[],
  silhouetteProfileIds: readonly string[],
  lookbookPostIds: readonly string[],
  userIds: readonly string[]
): { OR: ModerationEventWhereClause[] } | null {
  const filters: ModerationEventWhereClause[] = []

  if (moderationEventIds.length > 0) {
    filters.push({ id: { in: uniqueValues(moderationEventIds) } })
  }

  if (silhouetteProfileIds.length > 0) {
    filters.push({ silhouette_profile_id: { in: uniqueValues(silhouetteProfileIds) } })
  }

  if (lookbookPostIds.length > 0) {
    filters.push({ post_id: { in: uniqueValues(lookbookPostIds) } })
  }

  if (userIds.length > 0) {
    filters.push({ flagged_by_id: { in: uniqueValues(userIds) } })
  }

  if (filters.length === 0) {
    return null
  }

  return { OR: filters }
}

type CommunityPostReportWhereClause =
  | { id: { in: string[] } }
  | { post_id: { in: string[] } }
  | { reporter_id: { in: string[] } }

/**
 * CommunityPostReport carries no user_id either: its owner columns are post_id
 * and reporter_id, and both are ON DELETE SET NULL so that neither the
 * subject's erasure nor the reporter's destroys a moderation record. That is
 * also why the report has to be deleted before the post rather than swept
 * through it.
 */
function buildCommunityPostReportWhere(
  reportIds: readonly string[],
  lookbookPostIds: readonly string[],
  userIds: readonly string[]
): { OR: CommunityPostReportWhereClause[] } | null {
  const filters: CommunityPostReportWhereClause[] = []

  if (reportIds.length > 0) {
    filters.push({ id: { in: uniqueValues(reportIds) } })
  }

  if (lookbookPostIds.length > 0) {
    filters.push({ post_id: { in: uniqueValues(lookbookPostIds) } })
  }

  if (userIds.length > 0) {
    filters.push({ reporter_id: { in: uniqueValues(userIds) } })
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
  const commercePartnerIds = uniqueValues(tracked.commercePartners)
  const affiliateOfferIds = uniqueValues(tracked.affiliateOffers)
  const commercePreferenceIds = uniqueValues(tracked.commercePreferences)
  const affiliateClickIds = uniqueValues(tracked.affiliateClicks)
  const affiliateConversionIds = uniqueValues(tracked.affiliateConversions)

  const premiumEntitlementIds = uniqueValues(tracked.premiumEntitlements)
  const billingEventIds = uniqueValues(tracked.billingEvents)
  const billingCustomerIds = uniqueValues(tracked.billingCustomers)
  const premiumThemePreferenceIds = uniqueValues(tracked.premiumThemePreferences)
  const paletteProfileIds = uniqueValues(tracked.paletteProfiles)
  const advisorRecommendationStateIds = uniqueValues(tracked.advisorRecommendationStates)
  const plannerDayPlanIds = uniqueValues(tracked.plannerDayPlans)
  const lookbookPostIds = uniqueValues(tracked.lookbookPosts)
  const communityChallengeIds = uniqueValues(tracked.communityChallenges)
  const communityModerationOutboxIds = uniqueValues(
    tracked.communityModerationOutboxEntries
  )
  const communityAliasIds = uniqueValues(tracked.communityAliases)
  const communityPostReportIds = uniqueValues(tracked.communityPostReports)

  const lookbookPostWhere = buildDeleteWhere(lookbookPostIds, userIds)
  const commercePreferenceWhere = buildDeleteWhere(commercePreferenceIds, userIds)
  const affiliateClickWhere = buildDeleteWhere(affiliateClickIds, userIds)
  const premiumEntitlementWhere = buildDeleteWhere(premiumEntitlementIds, userIds)
  const billingCustomerWhere = buildDeleteWhere(billingCustomerIds, userIds)
  const premiumThemePreferenceWhere = buildDeleteWhere(premiumThemePreferenceIds, userIds)
  const paletteProfileWhere = buildDeleteWhere(paletteProfileIds, userIds)
  const advisorRecommendationStateWhere = buildDeleteWhere(
    advisorRecommendationStateIds,
    userIds
  )
  const plannerDayPlanWhere = buildDeleteWhere(plannerDayPlanIds, userIds)

  const outfitRecommendationWhere = buildDeleteWhere(ritualIds, userIds)
  const outfitCapsuleGarmentWhere = buildDeleteWhere(outfitCapsuleGarmentIds, userIds)
  const outfitCapsuleWhere = buildDeleteWhere(outfitCapsuleIds, userIds)
  const garmentItemWhere = buildDeleteWhere(wardrobeItemIds, userIds)
  const paletteInsightWhere = buildPaletteInsightWhere(wardrobeItemIds, userIds)
  const moderationEventWhere = buildModerationEventWhere(
    moderationEventIds,
    silhouetteProfileIds,
    lookbookPostIds,
    userIds
  )
  const communityAliasWhere = buildDeleteWhere(communityAliasIds, userIds)
  const communityPostReportWhere = buildCommunityPostReportWhere(
    communityPostReportIds,
    lookbookPostIds,
    userIds
  )
  const silhouetteProfileWhere = buildDeleteWhere(silhouetteProfileIds, userIds)
  const wardrobeOnboardingStateWhere = buildDeleteWhere(
    wardrobeOnboardingStateIds,
    userIds
  )

  try {
    // Story 5.2 billing, deleted first: events -> entitlements -> customers,
    // before the users they hang off are removed below. BillingEvent rows
    // written by webhook tests may carry user_id NULL (unknown-subject
    // deliveries), which neither tracked ids nor the user filter can reach, so
    // those are bounded by the same cleanupScopeStartedAt anchor the cooldown
    // table uses rather than an unscoped sweep.
    {
      const billingEventFilters: Record<string, unknown>[] = []
      if (billingEventIds.length > 0) {
        billingEventFilters.push(buildIdFilter(billingEventIds))
      }
      if (userIds.length > 0) {
        billingEventFilters.push(buildUserFilter(userIds))
        billingEventFilters.push({
          user_id: null,
          received_at: { gte: cleanupScopeStartedAt },
        })
      }
      if (billingEventFilters.length > 0) {
        await prisma.billingEvent.deleteMany({
          where: { OR: billingEventFilters },
        })
      }
    }

    if (premiumEntitlementWhere) {
      await prisma.premiumEntitlement.deleteMany({ where: premiumEntitlementWhere })
    }

    if (billingCustomerWhere) {
      await prisma.billingCustomer.deleteMany({ where: billingCustomerWhere })
    }

    // Story 5.3 theme preference. It hangs off the user with ON DELETE CASCADE
    // and nothing references it, so it only needs to precede the user delete;
    // it sits beside the billing block because it is the same premium domain.
    if (premiumThemePreferenceWhere) {
      await prisma.premiumThemePreference.deleteMany({
        where: premiumThemePreferenceWhere,
      })
    }

    // Story 5.4 palette advisor. AdvisorRecommendationState references only
    // User, so it precedes the user delete like the theme preference above.
    // PaletteProfile likewise references only User (there is no selfie-object
    // FK to anything else), so the same single deleteMany suffices here too.
    if (advisorRecommendationStateWhere) {
      await prisma.advisorRecommendationState.deleteMany({
        where: advisorRecommendationStateWhere,
      })
    }
    if (paletteProfileWhere) {
      await prisma.paletteProfile.deleteMany({
        where: paletteProfileWhere,
      })
    }

    // Story 5.5. PlannerDayPlan references both User and SavedLocation (the
    // composite (location_id, user_id) FK), so it must precede the
    // savedLocation delete below even though both FKs cascade.
    if (plannerDayPlanWhere) {
      await prisma.plannerDayPlan.deleteMany({
        where: plannerDayPlanWhere,
      })
    }

    // Story 6.1 community block, in reverse dependency order and deleted as one
    // group rather than spread across this function.
    //
    // It has to be a group because only one of these five FKs still cascades.
    // ModerationEvent.post_id and CommunityPostReport.post_id are ON DELETE SET
    // NULL, so deleting the post no longer removes them; it orphans them, and
    // an orphaned row is invisible to every filter this function has. So the
    // rows that reference the post go first, the post goes next, and the
    // challenge and alias it referenced go after.
    if (communityModerationOutboxIds.length > 0 || lookbookPostWhere) {
      await prisma.communityModerationOutbox.deleteMany({
        where: {
          OR: [
            ...(communityModerationOutboxIds.length > 0
              ? [buildIdFilter(communityModerationOutboxIds)]
              : []),
            ...(lookbookPostWhere ? [{ post: lookbookPostWhere }] : []),
          ],
        },
      })
    }

    if (communityPostReportWhere) {
      await prisma.communityPostReport.deleteMany({ where: communityPostReportWhere })
    }

    // Moderation events reference the post, a silhouette profile and the
    // flagging user, so they precede all three (Story 4.4 Task 2 put this
    // before the silhouette profile; Story 6.1 moved it ahead of the post too).
    if (moderationEventWhere) {
      await prisma.moderationEvent.deleteMany({
        where: moderationEventWhere,
      })
    }

    if (lookbookPostWhere) {
      await prisma.lookbookPost.deleteMany({
        where: lookbookPostWhere,
      })
    }

    // CommunityChallenge carries no user_id, so tracked ids are the only way to
    // reach it.
    if (communityChallengeIds.length > 0) {
      await prisma.communityChallenge.deleteMany({
        where: buildIdFilter(communityChallengeIds),
      })
    }

    if (communityAliasWhere) {
      await prisma.communityAlias.deleteMany({ where: communityAliasWhere })
    }

    // Story 5.1 commerce, deleted first and in reverse dependency order:
    // conversions -> clicks -> preferences -> offers -> partners. AffiliateClick
    // holds RESTRICT foreign keys onto AffiliateOffer and CommercePartner, so a
    // catalog row cannot be removed while any click still points at it.
    //
    // CommercePartner, AffiliateOffer, and AffiliateConversion carry no user_id,
    // so buildUserFilter cannot reach them the way it reaches every other table
    // here. Unlike AlertCooldownReservation, though, they do NOT need the
    // cleanupScopeStartedAt time anchor: the commerce factories register every
    // row they create, so tracked ids are a complete and exact record of what
    // this run made. Sweeping by timestamp instead would delete catalog rows
    // that a concurrent run, or the commerce seed itself, legitimately owns.
    if (affiliateConversionIds.length > 0) {
      await prisma.affiliateConversion.deleteMany({
        where: buildIdFilter(affiliateConversionIds),
      })
    }

    if (affiliateClickWhere) {
      await prisma.affiliateClick.deleteMany({ where: affiliateClickWhere })
    }

    if (commercePreferenceWhere) {
      await prisma.commercePreference.deleteMany({ where: commercePreferenceWhere })
    }

    if (affiliateOfferIds.length > 0) {
      await prisma.affiliateOffer.deleteMany({
        where: buildIdFilter(affiliateOfferIds),
      })
    }

    if (commercePartnerIds.length > 0) {
      await prisma.commercePartner.deleteMany({
        where: buildIdFilter(commercePartnerIds),
      })
    }

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
