// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19): the Settings tab became the Profile, with an account header.
// Both strings ship in all ten mobile locales, and the copy that sent members to Settings now
// names the Profile in each locale's own word.
import { describe, expect, it } from 'vitest'

import deDE from '../../assets/locales/de-DE.json'
import enCA from '../../assets/locales/en-CA.json'
import enUS from '../../assets/locales/en-US.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import trTR from '../../assets/locales/tr-TR.json'

// Listed here rather than imported: the mobile i18n entry point pulls in `expo-localization`.
const SUPPORTED_LOCALES = [
  'en-US',
  'en-CA',
  'de-DE',
  'es-419',
  'fr-CA',
  'fr-FR',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
] as const

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
type Catalog = Record<string, unknown>

const CATALOGS: Record<SupportedLocale, Catalog> = {
  'en-US': enUS as Catalog,
  'en-CA': enCA as Catalog,
  'de-DE': deDE as Catalog,
  'es-419': es419 as Catalog,
  'fr-CA': frCA as Catalog,
  'fr-FR': frFR as Catalog,
  'it-IT': itIT as Catalog,
  'pt-BR': ptBR as Catalog,
  'pt-PT': ptPT as Catalog,
  'tr-TR': trTR as Catalog,
}

function lookup(catalog: Catalog, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      catalog
    )
}

/** The Profile word each locale uses, which the copy pointing at the tab must contain. */
const PROFILE_WORD: Record<SupportedLocale, string> = {
  'en-US': 'Profile',
  'en-CA': 'Profile',
  'de-DE': 'Profil',
  'es-419': 'Perfil',
  'fr-CA': 'Profil',
  'fr-FR': 'Profil',
  'it-IT': 'Profilo',
  'pt-BR': 'Perfil',
  'pt-PT': 'Perfil',
  'tr-TR': 'Profil',
}

/** The word each catalog used for the old Settings tab. */
const SETTINGS_WORD: Record<SupportedLocale, string> = {
  'en-US': 'Settings',
  'en-CA': 'Settings',
  'de-DE': 'Einstellungen',
  'es-419': 'Configuración',
  'fr-CA': 'Réglages',
  'fr-FR': 'Réglages',
  'it-IT': 'Impostazioni',
  'pt-BR': 'Configurações',
  'pt-PT': 'Definições',
  'tr-TR': 'Ayarlar',
}

const POINTERS = [
  'commerce.premium.palette.sponsored.disclosure',
  'commerce.premium.palette.locked.body',
]

describe('Profile locale parity (mobile)', () => {
  it('PROFILE-I18N-MOB-01 matches the canonical en-US strings', () => {
    expect(lookup(CATALOGS['en-US'], 'tabs.profile')).toBe('Profile')
    expect(lookup(CATALOGS['en-US'], 'settings.account.label')).toBe('Account')
  })

  it('PROFILE-I18N-MOB-02 ships the tab label and account caption in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(lookup(CATALOGS[locale], 'tabs.profile'), locale).toBe(PROFILE_WORD[locale])
      const caption = lookup(CATALOGS[locale], 'settings.account.label')
      expect(typeof caption, locale).toBe('string')
      expect(String(caption).trim().length, locale).toBeGreaterThan(0)
    }
  })

  it('PROFILE-I18N-MOB-03 points premium palette copy at the Profile, never Settings', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of POINTERS) {
        const value = String(lookup(CATALOGS[locale], key))
        expect(value, `${locale} ${key}`).toContain(PROFILE_WORD[locale])
        expect(value, `${locale} ${key}`).not.toContain(SETTINGS_WORD[locale])
      }
    }
  })
})
