import { afterEach, describe, expect, it } from 'vitest'

import {
  createFactoryRegistry,
  DEFAULT_FACTORY_REGISTRY_KEYS,
  getTrackedEntityIds,
  registerCreatedEntity,
  resetTrackedEntities,
  snapshotTrackedEntities,
} from '../src/factories/registry.js'

describe('createFactoryRegistry', () => {
  it('returns the tracked id so factories can inline the call', () => {
    // Factories do `id: registry.track('users', user.id)`, so the return value
    // is part of the contract, not a convenience.
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    expect(registry.track('users', 'user-1')).toBe('user-1')
  })

  it('records an id once even when a fixture is registered repeatedly', () => {
    // Re-registering happens when a test persists the same fixture twice; the
    // resulting delete filter must not carry duplicate ids.
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)

    registry.track('users', 'user-1')
    registry.track('users', 'user-1')

    expect(registry.get('users')).toEqual(['user-1'])
  })

  it('hands out detached copies so a caller cannot corrupt tracking', () => {
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    registry.track('users', 'user-1')

    const ids = registry.get('users') as string[]
    ids.push('user-not-tracked')

    expect(registry.get('users')).toEqual(['user-1'])
  })

  it('freezes the snapshot at both levels', () => {
    // cleanup() reads this snapshot and builds delete filters from it; a
    // mutable snapshot would let one delegate's filter leak into another's.
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    registry.track('wardrobeItems', 'garment-1')

    const snapshot = registry.snapshot()

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.wardrobeItems)).toBe(true)
    expect(snapshot.wardrobeItems).toEqual(['garment-1'])
  })

  it('clears only the requested bucket', () => {
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    registry.track('users', 'user-1')
    registry.track('wardrobeItems', 'garment-1')

    registry.clear('wardrobeItems')

    expect(registry.get('wardrobeItems')).toEqual([])
    expect(registry.get('users')).toEqual(['user-1'])
  })

  it('clears every bucket when no type is given', () => {
    const registry = createFactoryRegistry(DEFAULT_FACTORY_REGISTRY_KEYS)
    registry.track('users', 'user-1')
    registry.track('wardrobeItems', 'garment-1')

    registry.clear()

    expect(registry.snapshot()).toEqual(
      Object.fromEntries(DEFAULT_FACTORY_REGISTRY_KEYS.map((key) => [key, []]))
    )
  })

  it('supports a caller-supplied key set', () => {
    // The registry is generic so a suite can track entities the default key set
    // does not know about without editing this package.
    const registry = createFactoryRegistry(['lookbookPosts'] as const)

    registry.track('lookbookPosts', 'post-1')

    expect(registry.snapshot()).toEqual({ lookbookPosts: ['post-1'] })
  })
})

describe('shared factory registry helpers', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  it('tracks, reads and snapshots through the module-level registry', () => {
    expect(registerCreatedEntity('users', 'user-1')).toBe('user-1')
    registerCreatedEntity('savedLocations', 'location-1')

    expect(getTrackedEntityIds('users')).toEqual(['user-1'])
    expect(snapshotTrackedEntities().savedLocations).toEqual(['location-1'])
  })

  it('resets a single entity type without dropping the rest', () => {
    registerCreatedEntity('users', 'user-1')
    registerCreatedEntity('savedLocations', 'location-1')

    resetTrackedEntities('savedLocations')

    expect(getTrackedEntityIds('savedLocations')).toEqual([])
    expect(getTrackedEntityIds('users')).toEqual(['user-1'])
  })

  it('resets every entity type when no type is given', () => {
    registerCreatedEntity('users', 'user-1')
    registerCreatedEntity('savedLocations', 'location-1')

    resetTrackedEntities()

    expect(getTrackedEntityIds('users')).toEqual([])
    expect(getTrackedEntityIds('savedLocations')).toEqual([])
  })
})
