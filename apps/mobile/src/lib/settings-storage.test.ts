import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSavedSettings, saveSettings } from './settings-storage'

const settingsFile = 'couture-cast-settings.json'

/** Swaps `globalThis.localStorage` out and hands back a restore function. */
function withoutLocalStorage() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
  })
  return () => {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', original)
    }
  }
}

describe('settings storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns the defaults when nothing has been saved', async () => {
    await expect(getSavedSettings()).resolves.toEqual({
      locale: null,
      localeSyncPending: false,
    })
  })

  it('round-trips a saved locale', async () => {
    await expect(saveSettings({ locale: 'tr-TR' })).resolves.toBe(true)

    await expect(getSavedSettings()).resolves.toEqual({
      locale: 'tr-TR',
      localeSyncPending: false,
    })
  })

  it('merges a partial update onto the stored settings', async () => {
    await saveSettings({ locale: 'tr-TR' })

    await saveSettings({ localeSyncPending: true })

    await expect(getSavedSettings()).resolves.toEqual({
      locale: 'tr-TR',
      localeSyncPending: true,
    })
  })

  /**
   * A locale removed from the supported set (or written by an older build) must
   * fall back to "unset" rather than being handed to i18n as a real locale.
   */
  it('discards a stored locale the contract no longer supports', async () => {
    localStorage.setItem(settingsFile, JSON.stringify({ locale: 'xx-XX' }))

    await expect(getSavedSettings()).resolves.toMatchObject({ locale: null })
  })

  it('discards a non-boolean sync flag', async () => {
    localStorage.setItem(
      settingsFile,
      JSON.stringify({ locale: 'en-US', localeSyncPending: 'yes' })
    )

    await expect(getSavedSettings()).resolves.toEqual({
      locale: 'en-US',
      localeSyncPending: false,
    })
  })

  it('falls back to the defaults for an unparseable settings file', async () => {
    localStorage.setItem(settingsFile, '{not-json')

    await expect(getSavedSettings()).resolves.toEqual({
      locale: null,
      localeSyncPending: false,
    })
  })

  it('reports the defaults rather than throwing when storage reads fail', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    await expect(getSavedSettings()).resolves.toEqual({
      locale: null,
      localeSyncPending: false,
    })
  })

  /** The caller decides what to do about it, so a failed write must say so. */
  it('reports a failed write instead of claiming success', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    await expect(saveSettings({ locale: 'en-US' })).resolves.toBe(false)
  })

  it('reports a failed write when the platform exposes no storage at all', async () => {
    const restore = withoutLocalStorage()
    try {
      await expect(saveSettings({ locale: 'en-US' })).resolves.toBe(false)
      await expect(getSavedSettings()).resolves.toEqual({
        locale: null,
        localeSyncPending: false,
      })
    } finally {
      restore()
    }
  })
})
