import { beforeEach, describe, expect, it } from 'vitest'
import { mockRitualResponse } from '../test-utils/msw/handlers'
import {
  clearRitualMemoryCache,
  readLatestRitualCache,
  saveRitualCache,
} from './ritual-cache'

describe('ritual cache localization', () => {
  beforeEach(() => {
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
})
