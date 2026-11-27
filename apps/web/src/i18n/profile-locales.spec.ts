// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19): the Settings page became the
// Profile, and the bottom nav labels moved from hardcoded English into the catalogs. Every
// `nav` and `settings` key ships in all ten web locales.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): D15 parity for the five tab labels (nav.today|closet|looks) and
// the Profile > Style keys (settings.style.*); nested trees now flatten to dotted keys.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
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

/** Adds every leaf under `node` as `prefix.key`, descending into nested trees. */
function addLeaves(out: Map<string, string>, prefix: string, node: unknown) {
  if (typeof node !== 'object' || node === null) {
    out.set(prefix, String(node))
    return
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    addLeaves(out, `${prefix}.${key}`, value)
  }
}

/** Flat dotted key to value for the Profile trees of one catalog. */
function profileStrings(catalog: Catalog): Map<string, string> {
  const out = new Map<string, string>()
  for (const tree of TREES) {
    const node = catalog[tree]
    if (typeof node !== 'object' || node === null) continue
    addLeaves(out, tree, node)
  }
  return out
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = profileStrings(CATALOGS['en-US'])

/**
 * Names a locale may keep from English because it is the word that locale uses:
 * Community in German and Italian, Home in Italian (the mobile tabs say the same). Story CC-7.11:
 * Looks is the fashion loanword German, Spanish, French and Portuguese use; Silhouette is the
 * German, French and Italian word; Style is the French word.
 */
const SHARED_WORDS = new Set([
  'Account',
  'Community',
  'Home',
  'Looks',
  'Notifications',
  'Premium',
  'Silhouette',
  'Style',
])

describe('Profile and navigation locale parity (web)', () => {
  it('PROFILE-I18N-WEB-01 matches the canonical en-US strings', () => {
    expect(Object.fromEntries(reference)).toEqual({
      'nav.label': 'Bottom navigation',
      // Story CC-7.9 D6: the top bar's desktop tab links name their landmark.
      'nav.primaryLabel': 'Main navigation',
      // The legal links' Home link; the Today tab reads nav.today.
      'nav.home': 'Home',
      // Story CC-7.11 D1: Today, Closet, Looks, Community, Profile.
      'nav.today': 'Today',
      'nav.closet': 'Closet',
      'nav.looks': 'Looks',
      'nav.community': 'Community',
      'nav.profile': 'Profile',
      'nav.navigatedTo': 'Navigated to {{label}} tab',
      'settings.profile.account': 'Account',
      'settings.profile.places': 'Places',
      'settings.profile.style': 'Style',
      'settings.profile.premium': 'Premium',
      'settings.profile.notifications': 'Notifications',
      'settings.profile.language': 'Language',
      'settings.profile.about': 'About and privacy',
      'settings.profile.unavailable': 'Unavailable',
      'settings.profile.notSet': 'Not set',
      'settings.profile.premiumActive': 'Active',
      'settings.profile.premiumFree': 'Free',
      'settings.profile.on': 'On',
      'settings.profile.off': 'Off',
      'settings.profile.learnMore': 'Learn more',
      'settings.profile.languageHelp': 'Your browser sets the language.',
      'settings.profile.browserLanguageHelp':
        'Change your preferred language in your browser’s settings, then reload CoutureCast.',
      'settings.profile.aboutHelp':
        'Plan outfits for the weather and keep track of your closet.',
      'settings.profile.themeHelp': 'Choose colors for the app.',
      'settings.profile.privacy': 'Privacy policy',
      'settings.profile.terms': 'Terms of service',
      'settings.profile.setup.not_started': 'Not started',
      'settings.profile.setup.in_progress': 'In progress',
      'settings.profile.setup.completed': 'Complete',
      'settings.profile.languages.en-US': 'English (US)',
      'settings.profile.languages.en-CA': 'English (Canada)',
      'settings.profile.languages.es-419': 'Español (LatAm)',
      'settings.profile.languages.fr-CA': 'Français (Canada)',
      'settings.profile.languages.fr-FR': 'Français (Europe)',
      'settings.profile.languages.tr-TR': 'Türkçe',
      'settings.profile.languages.de-DE': 'Deutsch',
      'settings.profile.languages.it-IT': 'Italiano',
      'settings.profile.languages.pt-BR': 'Português (Brasil)',
      'settings.profile.languages.pt-PT': 'Português (Portugal)',
      'settings.title': 'Profile',
      'settings.account': 'Your account',
      // Story CC-7.11 D7: Profile > Style and its three rows.
      'settings.style.row': 'Style',
      'settings.style.title': 'Style',
      'settings.style.silhouette': 'Silhouette',
      'settings.style.closetSetup': 'Closet setup',
      'settings.style.palette': 'Color palette',
    })
    // The old Wardrobe tab key left with the rename (D1).
    expect(reference.has('nav.wardrobe')).toBe(false)
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
        .filter(
          ([key, english]) =>
            !key.startsWith('settings.profile.languages.') && strings.get(key) === english
        )
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
