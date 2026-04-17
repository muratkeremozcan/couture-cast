import { describe, expect, it, vi } from 'vitest'

import type { CleanupPrismaClient } from '../src/cleanup.js'
import { cleanup } from '../src/cleanup.js'
import {
  createFactoryRegistry,
  DEFAULT_FACTORY_REGISTRY_KEYS,
} from '../src/factories/registry.js'

type CleanupCall = {
  delegate: keyof CleanupPrismaClient
  where: unknown
}

function createCleanupPrismaStub(calls: CleanupCall[]): CleanupPrismaClient {
  const createDelegate = (delegate: keyof CleanupPrismaClient) => ({
    deleteMany: vi.fn(({ where }: { where: unknown }) => {
      calls.push({ delegate, where })
      return Promise.resolve({ count: 1 })
    }),
  })

  return {
    auditLog: createDelegate('auditLog'),
    comfortPreferences: createDelegate('comfortPreferences'),
    engagementEvent: createDelegate('engagementEvent'),
    forecastSegment: createDelegate('forecastSegment'),
    garmentItem: createDelegate('garmentItem'),
    guardianConsent: createDelegate('guardianConsent'),
    guardianInvitation: createDelegate('guardianInvitation'),
    lookbookPost: createDelegate('lookbookPost'),
    outfitRecommendation: createDelegate('outfitRecommendation'),
    paletteInsights: createDelegate('paletteInsights'),
    pushToken: createDelegate('pushToken'),
    user: createDelegate('user'),
    userProfile: createDelegate('userProfile'),
    weatherSnapshot: createDelegate('weatherSnapshot'),
  }
}

describe('cleanup', () => {
  it('removes registered entities in reverse dependency order', async () => {
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    const calls: CleanupCall[] = []
    const prisma = createCleanupPrismaStub(calls)

    registry.track('users', 'user-1')
    registry.track('wardrobeItems', 'garment-1')
    registry.track('rituals', 'ritual-1')
    registry.track('weatherSnapshots', 'weather-1')

    await cleanup({ prisma, registry })

    expect(calls.map((call) => call.delegate)).toEqual([
      'engagementEvent',
      'lookbookPost',
      'auditLog',
      'pushToken',
      'outfitRecommendation',
      'paletteInsights',
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
    expect(
      calls.find((call) => call.delegate === 'weatherSnapshot')?.where
    ).toMatchObject({
      id: { in: ['weather-1'] },
    })
    expect(calls.find((call) => call.delegate === 'user')?.where).toMatchObject({
      id: { in: ['user-1'] },
    })
    expect(registry.snapshot()).toEqual({
      users: [],
      wardrobeItems: [],
      rituals: [],
      weatherSnapshots: [],
    })
  })
})
