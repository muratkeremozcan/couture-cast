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
    pushToken: createDelegate('pushToken'),
    savedLocation: createDelegate('savedLocation'),
    user: createDelegate('user'),
    userProfile: createDelegate('userProfile'),
    weatherSnapshot: createDelegate('weatherSnapshot'),
    eventEnvelope: createDelegate('eventEnvelope'),
    alertDeliveryOutbox: createDelegate('alertDeliveryOutbox'),
    alertCooldownReservation: createDelegate('alertCooldownReservation'),
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
    registry.track('savedLocations', 'location-1')
    registry.track('weatherSnapshots', 'weather-1')
    registry.track('alertRules', 'rule-1')
    registry.track('notificationPreferences', 'preference-1')
    registry.track('outfitCapsules', 'capsule-1')
    registry.track('outfitCapsuleGarments', 'join-1')

    await cleanup({ prisma, registry })

    expect(calls.map((call) => call.delegate)).toEqual([
      'eventEnvelope',
      'alertCooldownReservation',
      'engagementEvent',
      'lookbookPost',
      'auditLog',
      'pushToken',
      'alertRule',
      'notificationPreference',
      'savedLocation',
      'outfitRecommendation',
      'outfitCapsuleGarment',
      'outfitCapsule',
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
    })
  })
})
