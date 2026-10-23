// Story 6.7: the Home teaser and its Community notices ship in all ten mobile
// locales, with the same keys, placeholders and plural forms as web.
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
import webDeDE from '../../../web/src/i18n/locales/de-DE.json'
import webEnCA from '../../../web/src/i18n/locales/en-CA.json'
import webEnUS from '../../../web/src/i18n/locales/en-US.json'
import webEs419 from '../../../web/src/i18n/locales/es-419.json'
import webFrCA from '../../../web/src/i18n/locales/fr-CA.json'
import webFrFR from '../../../web/src/i18n/locales/fr-FR.json'
import webItIT from '../../../web/src/i18n/locales/it-IT.json'
import webPtBR from '../../../web/src/i18n/locales/pt-BR.json'
import webPtPT from '../../../web/src/i18n/locales/pt-PT.json'
import webTrTR from '../../../web/src/i18n/locales/tr-TR.json'

// Listed here rather than imported: the mobile i18n entry point pulls in
// `expo-localization`, which cannot be evaluated under the node test environment.
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

const MOBILE: Record<SupportedLocale, Catalog> = {
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

const WEB: Record<SupportedLocale, Catalog> = {
  'en-US': webEnUS as Catalog,
  'en-CA': webEnCA as Catalog,
  'de-DE': webDeDE as Catalog,
  'es-419': webEs419 as Catalog,
  'fr-CA': webFrCA as Catalog,
  'fr-FR': webFrFR as Catalog,
  'it-IT': webItIT as Catalog,
  'pt-BR': webPtBR as Catalog,
  'pt-PT': webPtPT as Catalog,
  'tr-TR': webTrTR as Catalog,
}

/** Every key the story adds, with the placeholders each one interpolates. */
const KEYS: Record<string, string[]> = {
  'home.spotlightTeaser.heading': ['label'],
  'home.spotlightTeaser.reactions': ['count'],
  'home.spotlightTeaser.reactions_one': ['count'],
  'home.spotlightTeaser.reactions_other': ['count'],
  'home.spotlightTeaser.linkLabel': ['author', 'count', 'label'],
  'home.spotlightTeaser.linkLabel_one': ['author', 'count', 'label'],
  'home.spotlightTeaser.linkLabel_other': ['author', 'count', 'label'],
  'home.spotlightTeaser.cta': [],
  'community.spotlight.targetUnavailable': [],
  'community.spotlight.destinationUnavailable': [],
}

function lookup(catalog: Catalog, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      catalog
    )
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

describe('6.7 Home teaser locale parity', () => {
  it('6.7-I18N-MOB-001 ships every key with its placeholders in every mobile and web locale', () => {
    for (const [surface, catalogs] of [
      ['mobile', MOBILE],
      ['web', WEB],
    ] as const)
      for (const locale of SUPPORTED_LOCALES)
        for (const [key, expected] of Object.entries(KEYS)) {
          const value = lookup(catalogs[locale], key)
          expect(typeof value, `${surface} ${locale}.${key}`).toBe('string')
          expect(
            (value as string).trim().length,
            `${surface} ${locale}.${key}`
          ).toBeGreaterThan(0)
          expect(placeholders(value as string), `${surface} ${locale}.${key}`).toEqual(
            expected
          )
        }
  })

  it('6.7-I18N-MOB-002 the teaser tree holds exactly the listed keys, identical on both surfaces', () => {
    const expected = Object.keys(KEYS)
      .filter((key) => key.startsWith('home.spotlightTeaser.'))
      .map((key) => key.slice('home.spotlightTeaser.'.length))
      .sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        Object.keys(lookup(MOBILE[locale], 'home.spotlightTeaser') as object).sort(),
        locale
      ).toEqual(expected)
      expect(lookup(MOBILE[locale], 'home'), locale).toEqual(lookup(WEB[locale], 'home'))
      for (const key of Object.keys(KEYS).filter((path) => path.startsWith('community.')))
        expect(lookup(MOBILE[locale], key), `${locale}.${key}`).toBe(
          lookup(WEB[locale], key)
        )
    }
  })

  it('6.7-I18N-MOB-003 plural bases match their other form and non-English catalogs are translated', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const base of ['reactions', 'linkLabel'])
        expect(lookup(MOBILE[locale], `home.spotlightTeaser.${base}`), locale).toBe(
          lookup(MOBILE[locale], `home.spotlightTeaser.${base}_other`)
        )
      if (locale.startsWith('en-')) continue
      for (const key of Object.keys(KEYS))
        expect(lookup(MOBILE[locale], key), `${locale}.${key}`).not.toBe(
          lookup(MOBILE['en-US'], key)
        )
    }
  })
})
