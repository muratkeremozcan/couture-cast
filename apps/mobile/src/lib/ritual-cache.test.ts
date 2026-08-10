import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRitualResponse } from '../test-utils/msw/handlers'
import {
  clearRitualMemoryCache,
  readLatestRitualCache,
  saveRitualCache,
} from './ritual-cache'

const locationKey = mockRitualResponse.data.weather.locationKey
const entryKey = `ritual:user-1:en-US:${locationKey}`
const latestLocationKey = 'ritual:user-1:en-US:latest-location'

describe('ritual cache localization', () => {
  beforeEach(() => {
    localStorage.clear()
    clearRitualMemoryCache()
  })

  afterEach(() => {
    localStorage.clear()
    clearRitualMemoryCache()
  })

  it('stores and reads each locale independently for the same user and location', async () => {
    await saveRitualCache('user-1', 'en-US', {
      data: mockRitualResponse,
      timestamp: 100,
    })
    await saveRitualCache('user-1', 'tr-TR', {
      data: mockRitualResponse,
      timestamp: 200,
    })
    clearRitualMemoryCache()

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toMatchObject({
      timestamp: 100,
    })
    await expect(readLatestRitualCache('user-1', 'tr-TR')).resolves.toMatchObject({
      timestamp: 200,
    })
  })

  it('preserves validated alert preferences with the cached ritual', async () => {
    await saveRitualCache('user-1', 'en-US', {
      data: mockRitualResponse,
      timestamp: 300,
      alertPreferences: {
        pushEnabled: false,
        quietHoursEnabled: true,
        quietHoursStart: '20:00',
        quietHoursEnd: '06:00',
        timezone: 'America/Chicago',
      },
    })
    clearRitualMemoryCache()

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toMatchObject({
      alertPreferences: {
        pushEnabled: false,
        quietHoursEnabled: true,
        quietHoursStart: '20:00',
        quietHoursEnd: '06:00',
        timezone: 'America/Chicago',
      },
    })
  })

  it('returns null when this user and locale have never cached a location', async () => {
    await expect(readLatestRitualCache('user-unknown', 'en-US')).resolves.toBeNull()
  })

  /** The in-memory hit is what keeps the hero readable while storage is busy. */
  it('serves a repeat read from memory once a location is known', async () => {
    await saveRitualCache('user-1', 'en-US', {
      data: mockRitualResponse,
      timestamp: 400,
    })
    localStorage.clear()

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toMatchObject({
      timestamp: 400,
    })
  })

  it('returns null when the pointed-at ritual entry is missing from storage', async () => {
    localStorage.setItem(latestLocationKey, locationKey)

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toBeNull()
  })

  /**
   * A stored entry written by an older build can no longer satisfy the current
   * contract. Serving it would push malformed weather into the hero, so a
   * failed parse has to read as "no cache" rather than throwing.
   */
  it.each([
    ['a non-numeric timestamp', '{"timestamp":"yesterday"}'],
    ['unparseable JSON', 'not-json-at-all'],
    ['a payload the ritual contract rejects', '{"timestamp":1,"data":{"nope":true}}'],
  ])('discards a cache entry with %s', async (_label, stored) => {
    localStorage.setItem(latestLocationKey, locationKey)
    localStorage.setItem(entryKey, stored)

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toBeNull()
  })

  it('reports no cache rather than throwing when storage itself fails', async () => {
    localStorage.setItem(latestLocationKey, locationKey)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toBeNull()
  })

  /** Background refresh must report failure, not claim NewData it never stored. */
  it('propagates a durable write failure to the caller', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    await expect(
      saveRitualCache('user-1', 'en-US', { data: mockRitualResponse, timestamp: 500 })
    ).rejects.toThrow('quota exceeded')
  })
})
