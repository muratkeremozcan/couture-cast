// Story 1.2b review round 2: native cache writes are asynchronous, so the
// latest-location pointer of a save that started before an invalidation must
// never land after it, and an older save must never overwrite a newer primary.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supportedLocales, type RitualResponse } from '@couture/api-client/contracts/http'
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

/** A member nothing queues: its mutations never wait behind member-1's held write. */
const UNQUEUED_MEMBER = 'member-unqueued'

/**
 * Settles once `twin`, the same mutation for {@link UNQUEUED_MEMBER}, has
 * settled. `twin` is started after `work` and takes the same native steps, so
 * an unordered `work` has settled by then too; ordered behind a held write,
 * `work` cannot even start until that write is released. No timer decides it.
 */
async function settledOrQueued(
  work: Promise<unknown>,
  twin: () => Promise<unknown>
): Promise<void> {
  const settled = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      () => undefined
    )
  await Promise.race([settled(work), settled(twin())])
}

/**
 * Holds the next native write to the latest-location pointer until released.
 * With `failEntryWrite`, the same mutation's entry write rejects at once while
 * its pointer write is still held.
 */
function holdNextPointerWrite({ failEntryWrite = false } = {}) {
  let markStarted!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => (markStarted = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  let pointerArmed = true
  let entryArmed = failEntryWrite
  nativeStorage.fileSystem.writeAsStringAsync.mockImplementation(
    async (uri: string, value: string) => {
      if (pointerArmed && uri.includes(POINTER)) {
        pointerArmed = false
        markStarted()
        await gate
      } else if (entryArmed && !uri.includes(POINTER)) {
        entryArmed = false
        throw new Error('disk full')
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
    await settledOrQueued(invalidation, () => forgetLatestRitual(UNQUEUED_MEMBER))
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
    await settledOrQueued(newerSave, () =>
      saveRitualCache(UNQUEUED_MEMBER, 'en-US', {
        data: ritualFor('new-primary'),
        timestamp: 200,
      })
    )
    pointer.release()
    await Promise.all([olderSave, newerSave])

    clearRitualMemoryCache()
    const cached = await readLatestRitualCache('member-1', 'en-US')
    expect(cached?.data.data.weather.locationKey).toBe('new-primary')
  })

  it('1.2b-MOB-CACHE-03 a failed save holds the next save until its pointer write lands', async () => {
    // The older save's entry write rejects while its pointer write is held.
    const pointer = holdNextPointerWrite({ failEntryWrite: true })
    const olderSave = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('previous-primary'),
      timestamp: 100,
    })
    await pointer.started

    const newerSave = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('new-primary'),
      timestamp: 200,
    })
    await settledOrQueued(newerSave, () =>
      saveRitualCache(UNQUEUED_MEMBER, 'en-US', {
        data: ritualFor('new-primary'),
        timestamp: 200,
      })
    )
    pointer.release()
    await expect(olderSave).rejects.toThrow('disk full')
    // The failure released the queue, and the newer primary still won.
    await newerSave

    clearRitualMemoryCache()
    const cached = await readLatestRitualCache('member-1', 'en-US')
    expect(cached?.data.data.weather.locationKey).toBe('new-primary')
  })

  it('1.2b-MOB-CACHE-04 a failed refresh cannot land its pointer after an invalidation', async () => {
    // The member already has a cached ritual for the primary they then delete.
    await saveRitualCache('member-1', 'en-US', {
      data: ritualFor('deleted-primary'),
      timestamp: 100,
    })

    // A refresh of that primary: its entry write rejects while its pointer
    // write is held, and the member deletes the location meanwhile.
    const pointer = holdNextPointerWrite({ failEntryWrite: true })
    const refresh = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('deleted-primary'),
      timestamp: 200,
    })
    await pointer.started
    const invalidation = forgetLatestRitual('member-1')
    await settledOrQueued(invalidation, () => forgetLatestRitual(UNQUEUED_MEMBER))
    pointer.release()
    await expect(refresh).rejects.toThrow('disk full')
    await invalidation

    clearRitualMemoryCache()
    await expect(readLatestRitualCache('member-1', 'en-US')).resolves.toBeNull()
  })

  it('1.2b-MOB-CACHE-05 a save queued before an invalidation never writes its pointer', async () => {
    const pointer = holdNextPointerWrite()
    const inFlight = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('first'),
      timestamp: 100,
    })
    await pointer.started
    // Called before the invalidation, but still queued behind the held write.
    const queued = saveRitualCache('member-1', 'en-US', {
      data: ritualFor('previous-primary'),
      timestamp: 200,
    })
    const invalidation = forgetLatestRitual('member-1')
    pointer.release()
    await Promise.all([inFlight, queued, invalidation])

    const pointerWrites = nativeStorage.fileSystem.writeAsStringAsync.mock.calls.filter(
      ([uri, value]) => String(uri).includes(POINTER) && value === 'previous-primary'
    )
    expect(pointerWrites).toHaveLength(0)
    clearRitualMemoryCache()
    await expect(readLatestRitualCache('member-1', 'en-US')).resolves.toBeNull()
  })

  it('1.2b-MOB-CACHE-06 an invalidation drops the pointer in every locale, past a failed delete', async () => {
    for (const locale of supportedLocales) {
      await saveRitualCache('member-1', locale, {
        data: ritualFor('previous-primary'),
        timestamp: 100,
      })
    }
    // One locale's delete fails; the rest still go, and the caller is not failed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    nativeStorage.fileSystem.deleteAsync.mockImplementationOnce(() =>
      Promise.reject(new Error('busy'))
    )

    await forgetLatestRitual('member-1')

    clearRitualMemoryCache()
    const survivors: string[] = []
    for (const locale of supportedLocales) {
      if (await readLatestRitualCache('member-1', locale)) survivors.push(locale)
    }
    // The pointer whose delete failed is the only one left.
    expect(survivors).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(
      '[RitualCache] Latest ritual pointer delete failed',
      expect.any(Error)
    )
  })
})
