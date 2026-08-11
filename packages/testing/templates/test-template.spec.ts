import { afterEach, describe, expect, it } from 'vitest'

import { cleanup, createTeenUser, createWardrobeItem } from '../src/index.js'
import { registerForCleanup } from '../src/cleanup.js'

type DeleteManyRecorder = {
  deleteMany: (args: unknown) => Promise<{ count: number }>
}

const prisma = {
  alertRule: { deleteMany: () => Promise.resolve({ count: 0 }) },
  auditLog: { deleteMany: () => Promise.resolve({ count: 0 }) },
  comfortPreferences: { deleteMany: () => Promise.resolve({ count: 0 }) },
  engagementEvent: { deleteMany: () => Promise.resolve({ count: 0 }) },
  forecastSegment: { deleteMany: () => Promise.resolve({ count: 0 }) },
  garmentItem: { deleteMany: () => Promise.resolve({ count: 0 }) },
  guardianConsent: { deleteMany: () => Promise.resolve({ count: 0 }) },
  guardianInvitation: { deleteMany: () => Promise.resolve({ count: 0 }) },
  lookbookPost: { deleteMany: () => Promise.resolve({ count: 0 }) },
  notificationPreference: { deleteMany: () => Promise.resolve({ count: 0 }) },
  outfitRecommendation: { deleteMany: () => Promise.resolve({ count: 0 }) },
  outfitCapsule: { deleteMany: () => Promise.resolve({ count: 0 }) },
  outfitCapsuleGarment: { deleteMany: () => Promise.resolve({ count: 0 }) },
  paletteInsights: { deleteMany: () => Promise.resolve({ count: 0 }) },
  wardrobeOnboardingState: { deleteMany: () => Promise.resolve({ count: 0 }) },
  silhouetteProfile: { deleteMany: () => Promise.resolve({ count: 0 }) },
  moderationEvent: { deleteMany: () => Promise.resolve({ count: 0 }) },
  pushToken: { deleteMany: () => Promise.resolve({ count: 0 }) },
  savedLocation: { deleteMany: () => Promise.resolve({ count: 0 }) },
  user: { deleteMany: () => Promise.resolve({ count: 0 }) },
  userProfile: { deleteMany: () => Promise.resolve({ count: 0 }) },
  weatherSnapshot: { deleteMany: () => Promise.resolve({ count: 0 }) },
  eventEnvelope: { deleteMany: () => Promise.resolve({ count: 0 }) },
  alertDeliveryOutbox: { deleteMany: () => Promise.resolve({ count: 0 }) },
  alertCooldownReservation: { deleteMany: () => Promise.resolve({ count: 0 }) },
  // Story 5.1 commerce. Every delegate `cleanup` touches has to appear here, or
  // this template stops compiling, which is the point: the template is what a
  // new suite copies, so a missing delegate would be inherited silently.
  commercePartner: { deleteMany: () => Promise.resolve({ count: 0 }) },
  affiliateOffer: { deleteMany: () => Promise.resolve({ count: 0 }) },
  commercePreference: { deleteMany: () => Promise.resolve({ count: 0 }) },
  affiliateClick: { deleteMany: () => Promise.resolve({ count: 0 }) },
  affiliateConversion: { deleteMany: () => Promise.resolve({ count: 0 }) },
} satisfies Record<string, DeleteManyRecorder>

describe('example factory suite', () => {
  afterEach(async () => {
    await cleanup({ prisma })
  })

  it('demonstrates the shared starter template pattern', () => {
    const teen = createTeenUser({ age: 15, email: 'template-teen@example.com' })
    const top = createWardrobeItem({ userId: teen.id, category: 'top' })

    // Direct Prisma setup can still opt into the shared teardown flow.
    registerForCleanup('wardrobeItems', top.id)
    registerForCleanup('users', teen.id)

    expect(top.userId).toBe(teen.id)
  })
})
