// Learning path Step 23: Home and lock-screen widgets.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-23-home-and-lock-screen-widgets
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRitualResponse } from '../test-utils/msw/handlers'

const nativeStorage = vi.hoisted(() => {
  const files = new Map<string, string>()
  return {
    files,
    fileSystem: {
      documentDirectory: 'file:///documents/',
      getInfoAsync: vi.fn((uri: string) => Promise.resolve({ exists: files.has(uri) })),
      readAsStringAsync: vi.fn((uri: string) => Promise.resolve(files.get(uri) ?? '')),
      writeAsStringAsync: vi.fn((uri: string, value: string) => {
        files.set(uri, value)
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
  readLatestRitualCache,
  saveRitualCache,
  withoutShopThisLook,
} from './ritual-cache'
import { getSavedSettings, saveSettings } from './settings-storage'

describe('native file storage', () => {
  beforeEach(() => {
    nativeStorage.files.clear()
    nativeStorage.fileSystem.getInfoAsync.mockClear()
    nativeStorage.fileSystem.readAsStringAsync.mockClear()
    nativeStorage.fileSystem.writeAsStringAsync.mockClear()
    nativeStorage.shareWidgetData.mockClear()
    clearRitualMemoryCache()
  })

  it('persists and restores the ritual cache through the SDK 54 legacy module', async () => {
    const entry = { data: mockRitualResponse, timestamp: 100 }
    // Story 5.1 decision 6: the affiliate block is dropped on the way in, so
    // what comes back out is the payload minus every `shopThisLook`.
    const persisted = { data: withoutShopThisLook(mockRitualResponse), timestamp: 100 }

    await saveRitualCache('user-1', 'en-US', entry)
    clearRitualMemoryCache()

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toEqual(persisted)
    expect(nativeStorage.fileSystem.writeAsStringAsync).toHaveBeenCalledTimes(2)
    expect(nativeStorage.shareWidgetData).toHaveBeenCalledOnce()
  })

  it('keeps the durable cache when widget publication fails and reports the failure', async () => {
    const entry = { data: mockRitualResponse, timestamp: 100 }
    const persisted = { data: withoutShopThisLook(mockRitualResponse), timestamp: 100 }
    const publicationError = new Error('native bridge unavailable')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    nativeStorage.shareWidgetData.mockRejectedValueOnce(publicationError)

    await expect(saveRitualCache('user-1', 'en-US', entry)).rejects.toBe(publicationError)
    clearRitualMemoryCache()

    await expect(readLatestRitualCache('user-1', 'en-US')).resolves.toEqual(persisted)
    expect(warning).toHaveBeenCalledWith(
      '[RitualCache] Durable cache saved, but widget publication failed',
      publicationError
    )
    warning.mockRestore()
  })

  it('persists and restores settings through the SDK 54 legacy module', async () => {
    await expect(saveSettings({ locale: 'pt-PT' })).resolves.toBe(true)

    await expect(getSavedSettings()).resolves.toEqual({
      locale: 'pt-PT',
      localeSyncPending: false,
    })
  })
})
