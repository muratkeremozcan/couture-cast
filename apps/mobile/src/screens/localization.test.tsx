import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import i18n, { initI18n, resolveSystemLocale } from '../lib/i18n'
import { getSavedSettings } from '../lib/settings-storage'

describe('Localization Client System tests', () => {
  beforeAll(async () => {
    // Make sure i18n is initialized with the catalogs
    await initI18n()
  })

  beforeEach(async () => {
    // Reset to default locale before each test
    await i18n.changeLanguage('en-US')
  })

  it('translates UI keys in the default locale (en-US)', () => {
    expect(i18n.t('tabs.tab_two')).toBe('Tab Two')
    expect(i18n.t('settings.language')).toBe('Language')
  })

  it('translates UI keys dynamically when language changes to Turkish (tr-TR)', async () => {
    await i18n.changeLanguage('tr-TR')
    expect(i18n.t('tabs.tab_two')).toBe('Ayarlar')
    expect(i18n.t('settings.language')).toBe('Dil')
  })

  it('translates UI keys dynamically when language changes to French (fr-CA)', async () => {
    await i18n.changeLanguage('fr-CA')
    expect(i18n.t('tabs.tab_two')).toBe('Paramètres')
    expect(i18n.t('settings.language')).toBe('Langue')
  })

  it('translates UI keys dynamically when language changes to German (de-DE)', async () => {
    await i18n.changeLanguage('de-DE')
    expect(i18n.t('tabs.tab_two')).toBe('Einstellungen')
    expect(i18n.t('settings.language')).toBe('Sprache')
  })

  it('translates UI keys dynamically when language changes to Italian (it-IT)', async () => {
    await i18n.changeLanguage('it-IT')
    expect(i18n.t('tabs.tab_two')).toBe('Impostazioni')
    expect(i18n.t('settings.language')).toBe('Lingua')
  })

  it('translates UI keys dynamically when language changes to Portuguese (pt-BR)', async () => {
    await i18n.changeLanguage('pt-BR')
    expect(i18n.t('tabs.tab_two')).toBe('Configurações')
    expect(i18n.t('settings.language')).toBe('Idioma')
  })

  it('translates UI keys dynamically when language changes to Portuguese (pt-PT)', async () => {
    await i18n.changeLanguage('pt-PT')
    expect(i18n.t('tabs.tab_two')).toBe('Definições')
    expect(i18n.t('settings.language')).toBe('Idioma')
  })

  it('falls back to English copy when translation key is missing in another language', async () => {
    i18n.addResource('en-US', 'translation', 'test.fallback_only', 'English Fallback')
    await i18n.changeLanguage('tr-TR')
    expect(i18n.t('test.fallback_only')).toBe('English Fallback')
  })

  it('uses regional device information for supported locale variants', () => {
    expect(
      resolveSystemLocale([{ languageTag: 'fr', languageCode: 'fr', regionCode: 'CA' }])
    ).toBe('fr-CA')
    expect(
      resolveSystemLocale([{ languageTag: 'pt', languageCode: 'pt', regionCode: 'BR' }])
    ).toBe('pt-BR')
  })

  it('represents missing settings as no override so startup can use the device locale', async () => {
    localStorage.clear()
    expect(await getSavedSettings()).toEqual({
      locale: null,
      localeSyncPending: false,
    })
  })
})
