// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Learning path Step 34: Premium subscription lifecycle.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-34-premium-subscription-lifecycle
// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CleanupPrismaClient } from '../src/cleanup.js'
import {
  cleanup,
  configureCleanup,
  registerForCleanup,
  resetCleanupConfiguration,
  resetCleanupRegistry,
  snapshotCleanupRegistry,
} from '../src/cleanup.js'
import {
  createFactoryRegistry,
  DEFAULT_FACTORY_REGISTRY_KEYS,
} from '../src/factories/registry.js'

type CleanupCall = {
  delegate: keyof CleanupPrismaClient
  where: unknown
}

type CleanupFailures = Partial<Record<keyof CleanupPrismaClient, Error>>

function createCleanupPrismaStub(
  calls: CleanupCall[],
  failures: CleanupFailures = {}
): CleanupPrismaClient {
  const createDelegate = (delegate: keyof CleanupPrismaClient) => ({
    deleteMany: vi.fn(({ where }: { where: unknown }) => {
      calls.push({ delegate, where })

      const failure = failures[delegate]
      if (failure) {
        return Promise.reject(failure)
      }

      return Promise.resolve({ count: 1 })
    }),
  })

  return {
    auditLog: createDelegate('auditLog'),
    alertRule: createDelegate('alertRule'),
    comfortPreferences: createDelegate('comfortPreferences'),
    engagementEvent: createDelegate('engagementEvent'),
    forecastSegment: createDelegate('forecastSegment'),
    garmentItem: createDelegate('garmentItem'),
    guardianConsent: createDelegate('guardianConsent'),
    guardianInvitation: createDelegate('guardianInvitation'),
    lookbookPost: createDelegate('lookbookPost'),
    notificationPreference: createDelegate('notificationPreference'),
    outfitRecommendation: createDelegate('outfitRecommendation'),
    outfitCapsule: createDelegate('outfitCapsule'),
    outfitCapsuleGarment: createDelegate('outfitCapsuleGarment'),
    paletteInsights: createDelegate('paletteInsights'),
    wardrobeOnboardingState: createDelegate('wardrobeOnboardingState'),
    silhouetteProfile: createDelegate('silhouetteProfile'),
    moderationEvent: createDelegate('moderationEvent'),
    pushToken: createDelegate('pushToken'),
    savedLocation: createDelegate('savedLocation'),
    user: createDelegate('user'),
    userProfile: createDelegate('userProfile'),
    weatherSnapshot: createDelegate('weatherSnapshot'),
    eventEnvelope: createDelegate('eventEnvelope'),
    alertDeliveryOutbox: createDelegate('alertDeliveryOutbox'),
    alertCooldownReservation: createDelegate('alertCooldownReservation'),
    commercePartner: createDelegate('commercePartner'),
    affiliateOffer: createDelegate('affiliateOffer'),
    commercePreference: createDelegate('commercePreference'),
    affiliateClick: createDelegate('affiliateClick'),
    affiliateConversion: createDelegate('affiliateConversion'),
    premiumEntitlement: createDelegate('premiumEntitlement'),
    billingEvent: createDelegate('billingEvent'),
    billingCustomer: createDelegate('billingCustomer'),
    premiumThemePreference: createDelegate('premiumThemePreference'),
    paletteProfile: createDelegate('paletteProfile'),
    advisorRecommendationState: createDelegate('advisorRecommendationState'),
    plannerDayPlan: createDelegate('plannerDayPlan'),
    communityChallenge: createDelegate('communityChallenge'),
    communityModerationOutbox: createDelegate('communityModerationOutbox'),
    communityAlias: createDelegate('communityAlias'),
    communityPostReport: createDelegate('communityPostReport'),
  }
}

describe('cleanup', () => {
  afterEach(() => {
    resetCleanupRegistry()
    resetCleanupConfiguration()
  })

  it('scopes the alert cooldown sweep to the current cleanup scope', async () => {
    /*
     * AlertCooldownReservation is keyed by a hash of (userId, locationKey,
     * fingerprint) and has no owner column, so it used to be emptied with an
     * unscoped deleteMany({}). That destroys reservations the run never created,
     * which is only harmless while cleanup points at a disposable database.
     */
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    const calls: CleanupCall[] = []
    const prisma = createCleanupPrismaStub(calls)

    const before = new Date()
    configureCleanup({ prisma })
    registry.track('users', 'user-1')

    await cleanup({ prisma, registry })

    const cooldown = calls.find((call) => call.delegate === 'alertCooldownReservation')
    const where = cooldown?.where as { created_at: { gte: Date } } | undefined
    expect(where?.created_at.gte).toBeInstanceOf(Date)
    expect(where?.created_at.gte.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('bounds unowned billing events to the current cleanup scope', async () => {
    // Story 5.2: unknown-subject webhook tests write BillingEvent rows with
    // user_id NULL, which neither tracked ids nor the user filter can reach.
    // The same scope anchor that bounds the cooldown sweep bounds these.
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    const calls: CleanupCall[] = []
    const prisma = createCleanupPrismaStub(calls)

    const before = new Date()
    configureCleanup({ prisma })
    registry.track('users', 'user-1')
    registry.track('billingEvents', 'event-1')

    await cleanup({ prisma, registry })

    const billingEvent = calls.find((call) => call.delegate === 'billingEvent')
    const where = billingEvent?.where as {
      OR: Record<string, unknown>[]
    }
    expect(where.OR).toHaveLength(3)
    expect(where.OR[0]).toEqual({ id: { in: ['event-1'] } })
    expect(where.OR[1]).toEqual({ user_id: { in: ['user-1'] } })
    const anchored = where.OR[2] as { user_id: null; received_at: { gte: Date } }
    expect(anchored.user_id).toBeNull()
    expect(anchored.received_at.gte.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('removes registered entities in reverse dependency order', async () => {
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    const calls: CleanupCall[] = []
    const prisma = createCleanupPrismaStub(calls)

    registry.track('users', 'user-1')
    registry.track('wardrobeItems', 'garment-1')
    registry.track('rituals', 'ritual-1')
    registry.track('savedLocations', 'location-1')
    registry.track('weatherSnapshots', 'weather-1')
    registry.track('alertRules', 'rule-1')
    registry.track('notificationPreferences', 'preference-1')
    registry.track('outfitCapsules', 'capsule-1')
    registry.track('outfitCapsuleGarments', 'join-1')
    registry.track('wardrobeOnboardingStates', 'onboarding-1')
    registry.track('silhouetteProfiles', 'silhouette-1')
    registry.track('moderationEvents', 'moderation-1')

    await cleanup({ prisma, registry })

    expect(calls.map((call) => call.delegate)).toEqual([
      // Story 5.2: billing first. Events, then the entitlement and customer
      // rows that hang off the tracked user. All three are reachable through
      // the user filter even with no billing ids registered.
      'billingEvent',
      'premiumEntitlement',
      'billingCustomer',
      // Story 5.3: the theme preference hangs off the tracked user with
      // ON DELETE CASCADE and nothing references it, so it only has to precede
      // the user delete. It sits beside billing because it is the same domain.
      'premiumThemePreference',
      // Story 5.4: both palette tables reference only the tracked user with
      // ON DELETE CASCADE and nothing references them, so like the theme
      // preference they only have to precede the user delete. Neither
      // references the other; the per-item state goes first for readability.
      'advisorRecommendationState',
      'paletteProfile',
      // Story 5.5: PlannerDayPlan references both the tracked user and
      // SavedLocation, so it precedes the savedLocation delete below even
      // though both FKs cascade.
      'plannerDayPlan',
      // Story 6.1: the community tables go as one ordered group. Only the
      // outbox still cascades from the post; ModerationEvent.post_id and
      // CommunityPostReport.post_id are ON DELETE SET NULL, so deleting the
      // post first orphans them, and an orphaned row is reachable by nothing
      // this function knows about.
      'communityModerationOutbox',
      'communityPostReport',
      'moderationEvent',
      'lookbookPost',
      'communityAlias',
      // Story 5.1: commerce first, and in reverse dependency order.
      // AffiliateClick holds RESTRICT foreign keys onto AffiliateOffer and
      // CommercePartner, so a catalog row cannot go before the clicks that
      // reference it. Clicks and preferences are reachable here through the
      // tracked user id even with no commerce ids registered.
      'affiliateClick',
      'commercePreference',
      'eventEnvelope',
      'alertCooldownReservation',
      'engagementEvent',
      'auditLog',
      'pushToken',
      'alertRule',
      'notificationPreference',
      'savedLocation',
      'outfitRecommendation',
      'outfitCapsuleGarment',
      'outfitCapsule',
      'paletteInsights',
      'silhouetteProfile',
      'wardrobeOnboardingState',
      'garmentItem',
      'forecastSegment',
      'weatherSnapshot',
      'guardianInvitation',
      'guardianConsent',
      'comfortPreferences',
      'userProfile',
      'user',
    ])
    expect(calls.find((call) => call.delegate === 'garmentItem')?.where).toMatchObject({
      OR: [{ id: { in: ['garment-1'] } }, { user_id: { in: ['user-1'] } }],
    })
    expect(calls.find((call) => call.delegate === 'outfitCapsule')?.where).toMatchObject({
      OR: [{ id: { in: ['capsule-1'] } }, { user_id: { in: ['user-1'] } }],
    })
    expect(calls.find((call) => call.delegate === 'savedLocation')?.where).toMatchObject({
      OR: [{ id: { in: ['location-1'] } }, { user_id: { in: ['user-1'] } }],
    })
    expect(
      calls.find((call) => call.delegate === 'weatherSnapshot')?.where
    ).toMatchObject({
      id: { in: ['weather-1'] },
    })
    expect(calls.find((call) => call.delegate === 'user')?.where).toMatchObject({
      id: { in: ['user-1'] },
    })
    // Moderation events referencing a silhouette profile must be deleted
    // before the profile, before the owning user (Story 4.4 Task 2). Story 6.1
    // added the flagged_by_id branch, because a moderation row written by a
    // community report carries a post and a reporter and neither of the other
    // two columns.
    expect(
      calls.find((call) => call.delegate === 'moderationEvent')?.where
    ).toMatchObject({
      OR: [
        { id: { in: ['moderation-1'] } },
        { silhouette_profile_id: { in: ['silhouette-1'] } },
        { flagged_by_id: { in: ['user-1'] } },
        { reviewed_by_id: { in: ['user-1'] } },
      ],
    })
    expect(
      calls.find((call) => call.delegate === 'silhouetteProfile')?.where
    ).toMatchObject({
      OR: [{ id: { in: ['silhouette-1'] } }, { user_id: { in: ['user-1'] } }],
    })
    expect(
      calls.find((call) => call.delegate === 'wardrobeOnboardingState')?.where
    ).toMatchObject({
      OR: [{ id: { in: ['onboarding-1'] } }, { user_id: { in: ['user-1'] } }],
    })
    expect(calls.findIndex((call) => call.delegate === 'moderationEvent')).toBeLessThan(
      calls.findIndex((call) => call.delegate === 'silhouetteProfile')
    )
    expect(calls.findIndex((call) => call.delegate === 'silhouetteProfile')).toBeLessThan(
      calls.findIndex((call) => call.delegate === 'user')
    )
    expect(registry.snapshot()).toEqual({
      users: [],
      wardrobeItems: [],
      rituals: [],
      savedLocations: [],
      weatherSnapshots: [],
      alertRules: [],
      notificationPreferences: [],
      outfitCapsules: [],
      outfitCapsuleGarments: [],
      wardrobeOnboardingStates: [],
      silhouetteProfiles: [],
      moderationEvents: [],
      commercePartners: [],
      affiliateOffers: [],
      commercePreferences: [],
      affiliateClicks: [],
      affiliateConversions: [],
      premiumEntitlements: [],
      billingEvents: [],
      billingCustomers: [],
      premiumThemePreferences: [],
      paletteProfiles: [],
      advisorRecommendationStates: [],
      plannerDayPlans: [],
      lookbookPosts: [],
      communityChallenges: [],
      communityModerationOutboxEntries: [],
      communityAliases: [],
      communityPostReports: [],
    })
  })

  it('refuses to run without a Prisma client instead of skipping teardown', async () => {
    // A cleanup that quietly no-ops leaves fixture rows behind, and the failure
    // surfaces later as a unique-constraint error in an unrelated suite.
    await expect(cleanup()).rejects.toThrow('cleanup requires a Prisma client')
  })

  it('uses the client registered by configureCleanup until it is reset', async () => {
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    configureCleanup({ prisma: createCleanupPrismaStub(calls) })
    registry.track('users', 'user-configured')
    await cleanup({ registry })

    expect(calls.find((call) => call.delegate === 'user')?.where).toEqual({
      id: { in: ['user-configured'] },
    })

    // Resetting has to restore the guard, otherwise a suite that tears down its
    // Prisma client keeps deleting through a dead connection.
    resetCleanupConfiguration()
    registry.track('users', 'user-configured')
    await expect(cleanup({ registry })).rejects.toThrow(
      'cleanup requires a Prisma client'
    )
  })

  it('prefers an explicitly passed client over the configured default', async () => {
    const configuredCalls: CleanupCall[] = []
    const explicitCalls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    configureCleanup({ prisma: createCleanupPrismaStub(configuredCalls) })
    registry.track('users', 'user-explicit')

    await cleanup({ prisma: createCleanupPrismaStub(explicitCalls), registry })

    expect(explicitCalls.map((call) => call.delegate)).toContain('user')
    expect(configuredCalls).toEqual([])
  })

  it('issues no deletes at all when nothing was registered', async () => {
    // The registry is the only thing scoping these statements, so an empty
    // registry has to produce zero deletes. An unscoped deleteMany here would
    // empty tables the run never wrote to.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    await cleanup({ prisma: createCleanupPrismaStub(calls), registry })

    expect(calls).toEqual([])
  })

  it('deletes by id alone when entities were registered without an owning user', async () => {
    // Tests that attach fixtures to a pre-seeded user register only the child
    // rows; those still have to be removed, and no user table may be touched.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    registry.track('savedLocations', 'location-1')
    registry.track('alertRules', 'rule-1')
    registry.track('notificationPreferences', 'preference-1')
    registry.track('wardrobeItems', 'garment-1')

    await cleanup({ prisma: createCleanupPrismaStub(calls), registry })

    const whereFor = (delegate: keyof CleanupPrismaClient) =>
      calls.find((call) => call.delegate === delegate)?.where

    expect(whereFor('savedLocation')).toEqual({ id: { in: ['location-1'] } })
    expect(whereFor('alertRule')).toEqual({ id: { in: ['rule-1'] } })
    expect(whereFor('notificationPreference')).toEqual({ id: { in: ['preference-1'] } })
    expect(whereFor('garmentItem')).toEqual({ OR: [{ id: { in: ['garment-1'] } }] })
    expect(whereFor('paletteInsights')).toEqual({
      OR: [{ garment_item_id: { in: ['garment-1'] } }],
    })
    expect(calls.map((call) => call.delegate)).not.toContain('user')
    expect(calls.map((call) => call.delegate)).not.toContain('userProfile')
    expect(calls.map((call) => call.delegate)).not.toContain('comfortPreferences')
  })

  it('scopes owner-wide deletes by user when no child ids were registered', async () => {
    // A persisted user drags rows the test never registered (push tokens, audit
    // entries, preferences), and the owner id is the only handle on them.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    registry.track('users', 'user-1')

    await cleanup({ prisma: createCleanupPrismaStub(calls), registry })

    const whereFor = (delegate: keyof CleanupPrismaClient) =>
      calls.find((call) => call.delegate === delegate)?.where

    expect(whereFor('alertRule')).toEqual({ user_id: { in: ['user-1'] } })
    expect(whereFor('notificationPreference')).toEqual({ user_id: { in: ['user-1'] } })
    expect(whereFor('savedLocation')).toEqual({ user_id: { in: ['user-1'] } })
    expect(whereFor('paletteInsights')).toEqual({ OR: [{ user_id: { in: ['user-1'] } }] })
    // ModerationEvent has no user_id column. A tracked user who filed a
    // community report leaves a moderation row that only flagged_by_id reaches.
    expect(whereFor('moderationEvent')).toEqual({
      OR: [
        { flagged_by_id: { in: ['user-1'] } },
        // A `report_resolved` row for an already-erased subject carries no
        // post_id and no flagged_by_id; the operator is all that names it.
        { reviewed_by_id: { in: ['user-1'] } },
      ],
    })
    expect(whereFor('communityPostReport')).toEqual({
      OR: [{ reporter_id: { in: ['user-1'] } }],
    })
  })

  it('removes moderation events attached to a silhouette profile under teardown', async () => {
    // Story 4.4 Task 2: a profile cannot be deleted while a moderation event
    // still references it, and the event carries no user id to match on.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    registry.track('silhouetteProfiles', 'silhouette-1')

    await cleanup({ prisma: createCleanupPrismaStub(calls), registry })

    expect(calls.find((call) => call.delegate === 'moderationEvent')?.where).toEqual({
      OR: [{ silhouette_profile_id: { in: ['silhouette-1'] } }],
    })
  })

  it('deletes a tracked lookbook post when no user was tracked', async () => {
    // Story 6.1 (M6). The lookbook delete used to sit inside deleteByUserIds,
    // which returns immediately when no user ids are tracked. A test that
    // persisted a post without also tracking its author therefore left the row
    // behind while cleanup reported success. That is the worst shape of leak:
    // nothing fails until an unrelated suite trips over the stale row.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    registry.track('lookbookPosts', 'post-1')

    await cleanup({ prisma: createCleanupPrismaStub(calls), registry })

    expect(calls.find((call) => call.delegate === 'lookbookPost')?.where).toEqual({
      OR: [{ id: { in: ['post-1'] } }],
    })
  })

  it('reaches community report and moderation rows through the post and the reporter', async () => {
    // Story 6.1 (M7). ModerationEvent.post_id and CommunityPostReport.post_id
    // are ON DELETE SET NULL, so deleting the post sweeps neither row. Both
    // builders have to match on post_id in their own right, and on the
    // reporting user, or a report filed during a test is unreachable by
    // cleanup entirely.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    registry.track('users', 'user-1')
    registry.track('lookbookPosts', 'post-1')

    await cleanup({ prisma: createCleanupPrismaStub(calls), registry })

    const whereFor = (delegate: keyof CleanupPrismaClient) =>
      calls.find((call) => call.delegate === delegate)?.where

    expect(whereFor('moderationEvent')).toEqual({
      OR: [
        { post_id: { in: ['post-1'] } },
        { flagged_by_id: { in: ['user-1'] } },
        { reviewed_by_id: { in: ['user-1'] } },
      ],
    })
    expect(whereFor('communityPostReport')).toEqual({
      OR: [{ post_id: { in: ['post-1'] } }, { reporter_id: { in: ['user-1'] } }],
    })
    expect(whereFor('communityAlias')).toEqual({
      OR: [{ user_id: { in: ['user-1'] } }],
    })

    // The report and the moderation row must both be gone before the post they
    // point at; SET NULL orphans whatever is still standing.
    const order = calls.map((call) => call.delegate)
    expect(order.indexOf('communityPostReport')).toBeLessThan(
      order.indexOf('lookbookPost')
    )
    expect(order.indexOf('moderationEvent')).toBeLessThan(order.indexOf('lookbookPost'))
  })

  it('clears the registry even when a delete fails', async () => {
    // Without the finally, one failed teardown poisons every later suite in the
    // same process: the ids stay tracked and get re-deleted forever.
    const calls: CleanupCall[] = []
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    const prisma = createCleanupPrismaStub(calls, {
      user: new Error('deadlock detected'),
    })

    registry.track('users', 'user-1')

    await expect(cleanup({ prisma, registry })).rejects.toThrow('deadlock detected')
    expect(registry.snapshot().users).toEqual([])
  })

  it('drains the shared factory registry when the caller passes none', async () => {
    const calls: CleanupCall[] = []

    expect(registerForCleanup('users', 'user-shared')).toBe('user-shared')

    await cleanup({ prisma: createCleanupPrismaStub(calls) })

    expect(calls.find((call) => call.delegate === 'user')?.where).toEqual({
      id: { in: ['user-shared'] },
    })
    expect(snapshotCleanupRegistry().users).toEqual([])
  })
})
