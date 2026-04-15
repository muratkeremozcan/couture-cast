import { afterEach, describe, expect, it } from 'vitest'

import { cleanup, createUser, createWardrobeItem } from '../src/index.js'

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

  it('builds fixtures without hardcoded literals', () => {
    const teen = createUser({ role: 'teen', age: 15 })
    const top = createWardrobeItem({ userId: teen.id, category: 'top' })

    expect(top.userId).toBe(teen.id)
  })
})
