import { afterEach, describe, expect, it } from 'vitest'

import { cleanup, createTeenUser, createWardrobeItem } from '../src/index.js'
import { registerForCleanup } from '../src/cleanup.js'

type DeleteManyRecorder = {
  deleteMany: (args: unknown) => Promise<{ count: number }>
}

const prisma = {
  auditLog: { deleteMany: () => Promise.resolve({ count: 0 }) },
  comfortPreferences: { deleteMany: () => Promise.resolve({ count: 0 }) },
  engagementEvent: { deleteMany: () => Promise.resolve({ count: 0 }) },
  forecastSegment: { deleteMany: () => Promise.resolve({ count: 0 }) },
  garmentItem: { deleteMany: () => Promise.resolve({ count: 0 }) },
  guardianConsent: { deleteMany: () => Promise.resolve({ count: 0 }) },
  guardianInvitation: { deleteMany: () => Promise.resolve({ count: 0 }) },
  lookbookPost: { deleteMany: () => Promise.resolve({ count: 0 }) },
  outfitRecommendation: { deleteMany: () => Promise.resolve({ count: 0 }) },
  paletteInsights: { deleteMany: () => Promise.resolve({ count: 0 }) },
  pushToken: { deleteMany: () => Promise.resolve({ count: 0 }) },
  user: { deleteMany: () => Promise.resolve({ count: 0 }) },
  userProfile: { deleteMany: () => Promise.resolve({ count: 0 }) },
  weatherSnapshot: { deleteMany: () => Promise.resolve({ count: 0 }) },
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
