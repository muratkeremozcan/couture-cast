'use client'

import { createInstance, type i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'

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

export const SUPPORTED_LOCALES = [
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

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'en-US'

const RESOURCES: Record<SupportedLocale, { translation: Record<string, unknown> }> = {
  'en-US': { translation: enUS },
  'en-CA': { translation: enCA },
  'de-DE': { translation: deDE },
  'es-419': { translation: es419 },
  'fr-CA': { translation: frCA },
  'fr-FR': { translation: frFR },
  'it-IT': { translation: itIT },
  'pt-BR': { translation: ptBR },
  'pt-PT': { translation: ptPT },
  'tr-TR': { translation: trTR },
}

/**
 * Base-language fallbacks for regions we do not ship a dedicated catalog for.
 * Exact `en-CA`, `fr-CA`, and `pt-BR` keep their own regional catalogs and are
 * therefore resolved by the exact-match step before this map is consulted.
 */
const BASE_LANGUAGE_FALLBACK: Record<string, SupportedLocale> = {
  en: 'en-US',
  de: 'de-DE',
  es: 'es-419',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  tr: 'tr-TR',
}

function normalizeTag(value: string): string {
  const [language = '', region] = value.replace(/_/g, '-').split('-')
  return region
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase()
}

/**
 * Resolves one candidate tag: an exact supported locale first, then the base
 * language mapped to its default region.
 */
export function resolveSupportedLocale(
  candidate: string | null | undefined
): SupportedLocale | null {
  if (!candidate) {
    return null
  }

  const normalized = normalizeTag(candidate)
  const exact = SUPPORTED_LOCALES.find((locale) => locale === normalized)
  if (exact) {
    return exact
  }

  const base = normalized.split('-')[0] ?? ''
  return BASE_LANGUAGE_FALLBACK[base] ?? null
}

/**
 * Locale precedence: the saved `UserProfile` locale, then the browser's
 * languages in order, then `en-US`.
 */
export function resolveWebLocale(options: {
  profileLocale?: string | null
  browserLanguages?: readonly string[]
}): SupportedLocale {
  const fromProfile = resolveSupportedLocale(options.profileLocale)
  if (fromProfile) {
    return fromProfile
  }

  for (const language of options.browserLanguages ?? []) {
    const resolved = resolveSupportedLocale(language)
    if (resolved) {
      return resolved
    }
  }

  return DEFAULT_LOCALE
}

let instance: I18nInstance | null = null

/** Initializes once per browser session; safe to call from any client component. */
export function getI18n(profileLocale?: string | null): I18nInstance {
  const locale = resolveWebLocale({
    profileLocale,
    browserLanguages: typeof navigator !== 'undefined' ? navigator.languages : undefined,
  })

  if (!instance) {
    instance = createInstance()
    void instance.use(initReactI18next).init({
      resources: RESOURCES,
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
      returnNull: false,
    })
    return instance
  }

  if (instance.language !== locale) {
    void instance.changeLanguage(locale)
  }
  return instance
}
