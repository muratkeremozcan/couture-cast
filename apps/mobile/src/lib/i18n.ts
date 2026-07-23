// Step 22 step 1 owner: define language resources and system defaults in apps/mobile/src/lib/i18n.ts
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as Localization from 'expo-localization'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  supportedLocales,
  supportedLocaleSchema,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'

import enUS from '../../assets/locales/en-US.json'
import enCA from '../../assets/locales/en-CA.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import trTR from '../../assets/locales/tr-TR.json'
import deDE from '../../assets/locales/de-DE.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import { getSavedSettings, saveSettings } from './settings-storage'

const i18n = createInstance()

const resources = {
  'en-US': { translation: enUS },
  'en-CA': { translation: enCA },
  'es-419': { translation: es419 },
  'fr-CA': { translation: frCA },
  'fr-FR': { translation: frFR },
  'tr-TR': { translation: trTR },
  'de-DE': { translation: deDE },
  'it-IT': { translation: itIT },
  'pt-BR': { translation: ptBR },
  'pt-PT': { translation: ptPT },
} satisfies Record<SupportedLocale, { translation: object }>

type DeviceLocale = Pick<
  Localization.Locale,
  'languageCode' | 'languageTag' | 'regionCode'
>

export function resolveSystemLocale(locales: readonly DeviceLocale[]): SupportedLocale {
  if (locales.length === 0) {
    return defaultSupportedLocale
  }

  for (const loc of locales) {
    const exactLocale = supportedLocaleSchema.safeParse(loc.languageTag)
    if (exactLocale.success) {
      return exactLocale.data
    }

    const regionalLocale = resolveSupportedLocale(
      loc.languageCode && loc.regionCode
        ? `${loc.languageCode}-${loc.regionCode}`
        : undefined
    )
    if (regionalLocale) {
      return regionalLocale
    }

    const languageLocale = resolveSupportedLocale(loc.languageCode)
    if (languageLocale) {
      return languageLocale
    }
  }

  return defaultSupportedLocale
}

export function getSystemLocale() {
  return resolveSystemLocale(Localization.getLocales())
}

let isInitialized = false
let initializationPromise: Promise<SupportedLocale> | undefined

async function initializeI18n(): Promise<SupportedLocale> {
  const saved = await getSavedSettings()
  const initialLocale = saved.locale ?? getSystemLocale()

  if (!saved.locale) {
    await saveSettings({ locale: initialLocale })
  }

  const initialize = (locale: SupportedLocale) =>
    i18n.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: defaultSupportedLocale,
      compatibilityJSON: 'v3',
      interpolation: {
        escapeValue: false,
      },
    })

  try {
    await initialize(initialLocale)
    isInitialized = true
    return initialLocale
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[i18n] locale initialization failed, using English fallback', error)
    }
    await initialize(defaultSupportedLocale)
    isInitialized = true
    return defaultSupportedLocale
  }
}

export function initI18n(): Promise<SupportedLocale> {
  if (isInitialized) {
    return Promise.resolve(
      resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
        defaultSupportedLocale
    )
  }

  initializationPromise ??= initializeI18n().catch((error: unknown) => {
    initializationPromise = undefined
    throw error
  })
  return initializationPromise
}

export { supportedLocales }
export default i18n
