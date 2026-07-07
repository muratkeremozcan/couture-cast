import { describe, expect, it, vi } from 'vitest'

import { WeatherQueryService } from './weather-query.service.js'

const clock = {
  now: () => new Date('2026-07-06T14:00:00.000Z'),
}

function createRepository(snapshot: unknown) {
  return {
    findLatestByLocationKey: vi.fn().mockResolvedValue(snapshot),
  }
}

function snapshotAt(fetchedAt: string) {
  return {
    id: 'weather-1',
    location_key: 'new-york-ny',
    fetched_at: new Date(fetchedAt),
    segments: [],
  }
}

describe('WeatherQueryService', () => {
  it.each([
    ['fresh at 59:59', '2026-07-06T13:00:01.000Z'],
    ['fresh at exactly 60:00', '2026-07-06T13:00:00.000Z'],
  ])('returns %s without a fallback message', async (_caseName, fetchedAt) => {
    const repository = createRepository(snapshotAt(fetchedAt))
    const service = new WeatherQueryService(repository as never, clock)

    const result = await service.getLatestWeather('new-york-ny')

    expect(result.status).toBe('fresh')
    if (result.status !== 'fresh') {
      throw new Error('Expected fresh weather')
    }
    expect(result.data.id).toBe('weather-1')
  })

  it('returns cached when a live provider request failed but fresh data exists', async () => {
    const repository = createRepository(snapshotAt('2026-07-06T13:30:00.000Z'))
    const service = new WeatherQueryService(repository as never, clock)

    await expect(
      service.getLatestWeather('new-york-ny', { liveProviderFailed: true })
    ).resolves.toMatchObject({
      status: 'cached',
      message: 'Using recently cached weather data.',
    })
  })

  it('returns stale with the exact fallback message after the 60-minute boundary', async () => {
    const repository = createRepository(snapshotAt('2026-07-06T12:59:59.999Z'))
    const service = new WeatherQueryService(repository as never, clock)

    await expect(service.getLatestWeather('new-york-ny')).resolves.toMatchObject({
      status: 'stale',
      message: 'Weather data is delayed. Check again shortly.',
    })
  })

  it('returns unavailable with the exact fallback message when no snapshot exists', async () => {
    const repository = createRepository(null)
    const service = new WeatherQueryService(repository as never, clock)

    await expect(service.getLatestWeather('new-york-ny')).resolves.toEqual({
      status: 'unavailable',
      data: null,
      message: 'Weather data is temporarily unavailable.',
    })
  })
})
