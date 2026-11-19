// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19): the Settings page became the
// Profile, and the bottom nav labels moved from hardcoded English into the catalogs. Every
// `nav` and `settings` key ships in all ten web locales.
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, type SupportedLocale } from './index'

import deDE from './locales/de-DE.json'
import enCA from './locales/en-CA.json'
import enUS from './locales/en-US.json'
import es419 from './locales/es-419.json'
import frCA from './locales/fr-CA.json'
import frFR from './locales/fr-FR.json'
import itIT from './locales/it-IT.json'
import ptBR from './locales/pt-BR.json'
import ptPT from './locales/pt-PT.json'
import trTR from './locales/tr-TR.json'

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

const TREES = ['nav', 'settings'] as const

/** Flat `tree.key` to value for the Profile trees of one catalog. */
function profileStrings(catalog: Catalog): Map<string, string> {
  const out = new Map<string, string>()
  for (const tree of TREES) {
    const node = catalog[tree]
    if (typeof node !== 'object' || node === null) continue
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out.set(`${tree}.${key}`, String(value))
    }
  }
  return out
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = profileStrings(CATALOGS['en-US'])

/**
 * Names a locale may keep from English because it is the word that locale uses:
 * Community in German and Italian, Home in Italian (the mobile tabs say the same).
 */
const SHARED_WORDS = new Set(['Community', 'Home'])

describe('Profile and navigation locale parity (web)', () => {
  it('PROFILE-I18N-WEB-01 matches the canonical en-US strings', () => {
    expect(Object.fromEntries(reference)).toEqual({
      'nav.label': 'Bottom navigation',
      'nav.home': 'Home',
      'nav.wardrobe': 'Wardrobe',
      'nav.community': 'Community',
      'nav.profile': 'Profile',
      'nav.navigatedTo': 'Navigated to {{label}} tab',
      'settings.title': 'Profile',
      'settings.account': 'Your account',
    })
  })

  it('PROFILE-I18N-WEB-02 ships the same keys and placeholders in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const strings = profileStrings(CATALOGS[locale])
      expect([...strings.keys()].sort(), locale).toEqual([...reference.keys()].sort())
      for (const [key, english] of reference) {
        const value = strings.get(key) ?? ''
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(english))
      }
    }
  })

  it('PROFILE-I18N-WEB-03 translates every string outside English', () => {
    for (const locale of SUPPORTED_LOCALES.filter((tag) => !tag.startsWith('en-'))) {
      const strings = profileStrings(CATALOGS[locale])
      const untranslated = [...reference]
        .filter(([key, english]) => strings.get(key) === english)
        .filter(([, english]) => !SHARED_WORDS.has(english))
        .map(([key]) => key)
      expect(untranslated, locale).toEqual([])
    }
  })

  it('PROFILE-I18N-WEB-04 names the tab and the page title alike in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const strings = profileStrings(CATALOGS[locale])
      expect(strings.get('nav.profile'), locale).toBe(strings.get('settings.title'))
    }
  })

  it('PROFILE-I18N-WEB-05 points premium palette copy at the Profile, never Settings', () => {
    const settingsWord: Record<SupportedLocale, string> = {
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
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = CATALOGS[locale] as {
        commerce: { premium: { palette: Record<string, Record<string, string>> } }
      }
      const palette = catalog.commerce.premium.palette
      const profile = profileStrings(CATALOGS[locale]).get('nav.profile') ?? ''
      for (const value of [palette.sponsored!.disclosure!, palette.locked!.body!]) {
        expect(value, locale).toContain(profile)
        expect(value, locale).not.toContain(settingsWord[locale])
      }
    }
  })
})
