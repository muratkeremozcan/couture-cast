import { z } from 'zod'
import supportedLocaleConfig from './supported-locales.json'

export type SupportedLocale = keyof typeof supportedLocaleConfig

const localeKeys = Object.keys(supportedLocaleConfig) as [
  SupportedLocale,
  ...SupportedLocale[],
]

export const supportedLocales = Object.freeze([...localeKeys])
export const defaultSupportedLocale: SupportedLocale = 'en-US'
export const supportedLocaleSchema = z.enum(localeKeys)

function normalizeLocaleTag(localeTag: string) {
  return localeTag.trim().replaceAll('_', '-').toLowerCase()
}

export function resolveSupportedLocale(localeTag: string | null | undefined) {
  if (!localeTag) {
    return undefined
  }

  const normalizedTag = normalizeLocaleTag(localeTag)
  const exactMatch = supportedLocales.find(
    (locale): locale is SupportedLocale => locale.toLowerCase() === normalizedTag
  )
  if (exactMatch) {
    return exactMatch
  }

  const [language, region] = normalizedTag.split('-')
  if (!language) {
    return undefined
  }

  const regionalMatch = supportedLocales.find((locale) => {
    const config = supportedLocaleConfig[locale]
    return (
      config.language === language &&
      'regions' in config &&
      config.regions.some((candidate) => candidate.toLowerCase() === region)
    )
  })
  if (regionalMatch) {
    return regionalMatch
  }

  return supportedLocales.find((locale) => {
    const config = supportedLocaleConfig[locale]
    return config.language === language && 'defaultForLanguage' in config
  })
}

type WeightedLanguageRange = {
  localeRange: string
  quality: number
  order: number
}

export function resolveAcceptLanguage(acceptLanguage: string | null | undefined) {
  if (!acceptLanguage) {
    return undefined
  }

  const weightedRanges = acceptLanguage
    .split(',')
    .map((entry, order): WeightedLanguageRange | undefined => {
      const [localeRangePart, ...parameters] = entry.trim().split(';')
      const localeRange = localeRangePart?.trim()
      if (!localeRange || localeRange === '*') {
        return undefined
      }

      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().toLowerCase().startsWith('q=')
      )
      const parsedQuality = qualityParameter
        ? Number.parseFloat(qualityParameter.split('=')[1] ?? '')
        : 1
      const quality = Number.isFinite(parsedQuality)
        ? Math.min(1, Math.max(0, parsedQuality))
        : 0

      return { localeRange, quality, order }
    })
    .filter((entry): entry is WeightedLanguageRange =>
      Boolean(entry && entry.quality > 0)
    )
    .sort((left, right) => right.quality - left.quality || left.order - right.order)

  for (const range of weightedRanges) {
    const locale = resolveSupportedLocale(range.localeRange)
    if (locale) {
      return locale
    }
  }

  return undefined
}
