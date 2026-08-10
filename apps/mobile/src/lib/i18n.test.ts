import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** Device locales are a native boundary; every case here drives this list. */
const localization = vi.hoisted(() => ({
  locales: [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }] as {
    languageTag: string
    languageCode: string | null
    regionCode: string | null
  }[],
}))

vi.mock('expo-localization', () => ({
  getLocales: () => localization.locales,
}))

import i18n, { getSystemLocale, initI18n, resolveSystemLocale } from './i18n'

const SETTINGS_KEY = 'couture-cast-settings.json'

function device(
  languageTag: string,
  languageCode: string | null,
  regionCode: string | null
) {
  return { languageTag, languageCode, regionCode }
}

describe('resolveSystemLocale', () => {
  it('falls back to English when the device reports no locales at all', () => {
    expect(resolveSystemLocale([])).toBe('en-US')
  })

  it('takes an exact supported language tag as-is', () => {
    expect(resolveSystemLocale([device('pt-BR', 'pt', 'BR')])).toBe('pt-BR')
  })

  /** Android reports `fr_CA`, which is not a member of the locale enum. */
  it('recovers a supported locale from an underscore-separated tag', () => {
    expect(resolveSystemLocale([device('fr_CA', 'fr', 'CA')])).toBe('fr-CA')
  })

  /** An unshipped region still gets that language's shipped default bundle. */
  it('maps an unsupported region onto the language default', () => {
    expect(resolveSystemLocale([device('de-AT', 'de', 'AT')])).toBe('de-DE')
  })

  it('resolves from the language alone when the device reports no region', () => {
    expect(resolveSystemLocale([device('it', 'it', null)])).toBe('it-IT')
  })

  /**
   * iOS and Android both expose a ranked preference list. An unsupported first
   * choice must not shadow a supported second choice.
   */
  it('walks past unsupported preferences to the first supported one', () => {
    expect(
      resolveSystemLocale([device('ja-JP', 'ja', 'JP'), device('tr-TR', 'tr', 'TR')])
    ).toBe('tr-TR')
  })

  it('falls back to English when nothing in the preference list is supported', () => {
    expect(
      resolveSystemLocale([device('ja-JP', 'ja', 'JP'), device('ko-KR', 'ko', 'KR')])
    ).toBe('en-US')
  })

  it('falls back to English when the device reports no language code', () => {
    expect(resolveSystemLocale([device('und', null, null)])).toBe('en-US')
  })
})

describe('getSystemLocale', () => {
  it('reads the live device preference list', () => {
    localization.locales = [device('pt-PT', 'pt', 'PT')]
    expect(getSystemLocale()).toBe('pt-PT')
  })
})

/**
 * `initI18n` latches module-level state on its first success and Vitest browser
 * mode cannot reset a module registry, so these cases run in order against one
 * instance: first launch, then the memoized calls that follow it.
 */
describe('initI18n on a first launch', () => {
  beforeAll(() => {
    localStorage.removeItem(SETTINGS_KEY)
    localization.locales = [device('tr-TR', 'tr', 'TR')]
  })

  afterAll(() => {
    localStorage.removeItem(SETTINGS_KEY)
    localization.locales = [device('en-US', 'en', 'US')]
  })

  /** First launch pins the device locale so it cannot drift on a later boot. */
  it('adopts the device locale and persists it to settings', async () => {
    await expect(initI18n()).resolves.toBe('tr-TR')

    expect(i18n.resolvedLanguage).toBe('tr-TR')
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({
      locale: 'tr-TR',
    })
  })

  it('loads the translations for the adopted locale', () => {
    expect(i18n.t('wardrobe.capsules.save')).not.toBe('wardrobe.capsules.save')
  })

  /**
   * Every screen calls this on mount. A second i18next init would tear down the
   * live language, so later calls must resolve from the already-loaded instance.
   */
  it('returns the resolved locale without re-reading the device on later calls', async () => {
    localization.locales = [device('de-DE', 'de', 'DE')]
    localStorage.removeItem(SETTINGS_KEY)

    await expect(initI18n()).resolves.toBe('tr-TR')

    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
  })

  it('keeps reporting the active locale after an explicit language change', async () => {
    await i18n.changeLanguage('pt-BR')

    await expect(initI18n()).resolves.toBe('pt-BR')

    await i18n.changeLanguage('tr-TR')
  })
})
