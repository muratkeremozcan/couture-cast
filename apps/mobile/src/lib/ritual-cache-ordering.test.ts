// Story 1.2b review round 2: native cache writes are asynchronous, so the
// latest-location pointer of a save that started before an invalidation must
// never land after it, and an older save must never overwrite a newer primary.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RitualResponse } from '@couture/api-client/contracts/http'
import { mockRitualResponse } from '../test-utils/msw/handlers'

const nativeStorage = vi.hoisted(() => {
  const files = new Map<string, string>()
  return {
    files,
    fileSystem: {
      documentDirectory: 'file:///documents/',
      getInfoAsync: vi.fn((uri: string) => Promise.resolve({ exists: files.has(uri) })),
      readAsStringAsync: vi.fn((uri: string) => Promise.resolve(files.get(uri) ?? '')),
      writeAsStringAsync: vi.fn(),
      deleteAsync: vi.fn((uri: string) => {
        files.delete(uri)
        return Promise.resolve()
      }),
    },
    shareWidgetData: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-file-system/legacy', () => nativeStorage.fileSystem)
vi.mock('./widget-share', () => ({ shareWidgetData: nativeStorage.shareWidgetData }))

import {
  clearRitualMemoryCache,
  forgetLatestRitual,
  readLatestRitualCache,
  saveRitualCache,
} from './ritual-cache'

const POINTER = encodeURIComponent('ritual:member-1:en-US:latest-location')

function ritualFor(locationKey: string): RitualResponse {
  return {
    ...mockRitualResponse,
    data: {
      ...mockRitualResponse.data,
      weather: { ...mockRitualResponse.data.weather, locationKey },
    },
  }
}

/**
 * Gives `work` time to finish on its own. Unordered, every mocked native call
 * resolves within a few microtasks, so it settles well inside the grace period;
 * ordered behind a held write, it cannot settle until that write is released.
 */
async function settledOrQueued(work: Promise<unknown>): Promise<void> {
  await Promise.race([
    work.then(
      () => undefined,
      () => undefined
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 100)),
  ])
}

/** Holds the next native write to the latest-location pointer until released. */
function holdNextPointerWrite() {
  let markStarted!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => (markStarted = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  let armed = true
  nativeStorage.fileSystem.writeAsStringAsync.mockImplementation(
    async (uri: string, value: string) => {
      if (armed && uri.includes(POINTER)) {
        armed = false
        markStarted()
        await gate
      }
      nativeStorage.files.set(uri, value)
    }
  )
  return { started, release }
}

describe('ritual cache mutation order on native storage', () => {
  beforeEach(() => {
    nativeStorage.files.clear()
    nativeStorage.fileSystem.writeAsStringAsync.mockReset()
    nativeStorage.fileSystem.writeAsStringAsync.mockImplementation(
      (uri: string, value: string) => {
        nativeStorage.files.set(uri, value)
        return Promise.resolve()
      }
    )
    clearRitualMemoryCache()
  })

  it('1.2b-MOB-CACHE-01 an invalidation outlasts a pointer write that started before it', async () => {
    const pointer = holdNextPointerWrite()
    const pendingSave = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('deleted-primary'),
      timestamp: 100,
    })
    await pointer.started

    // Unordered, the invalidation finishes while the old write is held, and the
    // write then lands after it. Ordered, the invalidation waits for the write.
    const invalidation = forgetLatestRitual('member-1')
    await settledOrQueued(invalidation)
    pointer.release()
    await pendingSave
    await invalidation

    clearRitualMemoryCache()
    await expect(readLatestRitualCache('member-1', 'en-US')).resolves.toBeNull()
  })

  it('1.2b-MOB-CACHE-02 an older pending save never overwrites a newer primary', async () => {
    const pointer = holdNextPointerWrite()
    const olderSave = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('previous-primary'),
      timestamp: 100,
    })
    await pointer.started

    const newerSave = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('new-primary'),
      timestamp: 200,
    })
    await settledOrQueued(newerSave)
    pointer.release()
    await Promise.all([olderSave, newerSave])

    clearRitualMemoryCache()
    const cached = await readLatestRitualCache('member-1', 'en-US')
    expect(cached?.data.data.weather.locationKey).toBe('new-primary')
  })

  it('1.2b-MOB-CACHE-03 a failed write releases the next mutation', async () => {
    nativeStorage.fileSystem.writeAsStringAsync.mockRejectedValueOnce(
      new Error('disk full')
    )
    await expect(
      saveRitualCache('member-1', 'en-US', { data: ritualFor('a'), timestamp: 1 })
    ).rejects.toThrow('disk full')

    await forgetLatestRitual('member-1')
    await saveRitualCache('member-1', 'en-US', { data: ritualFor('b'), timestamp: 2 })
    clearRitualMemoryCache()
    const cached = await readLatestRitualCache('member-1', 'en-US')
    expect(cached?.data.data.weather.locationKey).toBe('b')
  })
})
