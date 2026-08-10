import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Separate spec file on purpose. `initI18n` latches module-level state on its
 * first success and Vitest browser mode has no working `vi.resetModules`, so the
 * i18next failure path cannot share a module instance with the happy path in
 * `i18n.test.ts`. Mocking i18next here is the only way to reach the fallback.
 */
const stub = vi.hoisted(() => {
  const init = vi.fn()
  const instance = {
    init,
    resolvedLanguage: undefined as string | undefined,
    language: undefined as string | undefined,
    use() {
      return instance
    },
  }
  return { init, instance }
})

vi.mock('i18next', () => ({
  createInstance: () => stub.instance,
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'pt-BR', languageCode: 'pt', regionCode: 'BR' }],
}))

import { initI18n } from './i18n'

describe('initI18n when the locale bundle fails to load', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    localStorage.clear()
  })

  /**
   * A rejected initialization must not be memoized, otherwise one bad boot would
   * leave the app permanently stringless with no way to retry.
   */
  it('propagates a total failure and lets the next caller retry', async () => {
    stub.init
      .mockRejectedValueOnce(new Error('device locale bundle unreadable'))
      .mockRejectedValueOnce(new Error('English bundle unreadable'))

    await expect(initI18n()).rejects.toThrow('English bundle unreadable')

    expect(stub.init).toHaveBeenCalledTimes(2)
  })

  /**
   * The core contract: when the device's locale cannot be loaded, the app still
   * comes up in English rather than with no translations at all.
   */
  it('retries in English and reports English as the active locale', async () => {
    stub.init
      .mockRejectedValueOnce(new Error('device locale bundle unreadable'))
      .mockResolvedValueOnce(undefined)

    await expect(initI18n()).resolves.toBe('en-US')

    expect(stub.init.mock.calls.at(-2)?.[0]).toMatchObject({ lng: 'pt-BR' })
    expect(stub.init.mock.calls.at(-1)?.[0]).toMatchObject({
      lng: 'en-US',
      fallbackLng: 'en-US',
    })
  })
})
