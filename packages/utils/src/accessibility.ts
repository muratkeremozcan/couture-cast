/** Locale-aware accessibility descriptions shared by web and mobile. */

export interface WeatherAltTextInput {
  conditionLabel: string
  temperature: number
  unit: 'C' | 'F'
  locale: string
  descriptor?: string
}

export type AccessibilityAnnouncementEvent =
  | 'refresh'
  | 'swap'
  | 'chip_change'
  | 'feedback'
  | 'alert'
  | 'error'

const DEFAULT_LOCALE = 'en-US'

function normalizeParts(parts: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()

  return parts.flatMap((part) => {
    const value = part?.trim()
    if (!value) {
      return []
    }

    const key = value.toLocaleLowerCase()
    if (seen.has(key)) {
      return []
    }

    seen.add(key)
    return [value]
  })
}

function safeLocale(locale?: string): string {
  try {
    return Intl.getCanonicalLocales(locale?.trim() || DEFAULT_LOCALE)[0] ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

function formatList(parts: readonly string[], locale: string): string {
  if (parts.length < 2) {
    return parts[0] ?? ''
  }

  return new Intl.ListFormat(locale, {
    style: 'long',
    type: 'conjunction',
  }).format(parts)
}

/**
 * Formats an already-localized weather description. Empty values are ignored and
 * case-insensitive duplicates are removed. Finite temperatures, including zero and
 * negatives, use Intl unit formatting. Invalid temperatures are omitted. Empty input
 * returns an empty string, and an invalid locale falls back to en-US.
 */
export function formatWeatherAltText(input: WeatherAltTextInput): string {
  const locale = safeLocale(input.locale)
  const words = normalizeParts([input.conditionLabel, input.descriptor])

  if (Number.isFinite(input.temperature)) {
    const temperature = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: input.unit === 'F' ? 'fahrenheit' : 'celsius',
      unitDisplay: 'long',
      maximumFractionDigits: 0,
    }).format(input.temperature)
    words.splice(Math.min(1, words.length), 0, temperature)
  }

  return formatList(words, locale)
}

/**
 * Formats an already-localized garment title and descriptor list. Values are trimmed,
 * empty parts and case-insensitive duplicates are removed, and Intl.ListFormat supplies
 * locale punctuation. A title without useful descriptors is returned unchanged.
 */
export function formatGarmentAltText(
  title: string,
  descriptorParts: readonly string[] = [],
  locale = DEFAULT_LOCALE
): string {
  const [cleanTitle = '', ...descriptors] = normalizeParts([title, ...descriptorParts])
  if (!cleanTitle || descriptors.length === 0) {
    return cleanTitle
  }

  return `${cleanTitle}: ${formatList(descriptors, safeLocale(locale))}`
}

/** Returns the live-region urgency required for an interaction event. */
export function getAnnouncementUrgency(
  event: AccessibilityAnnouncementEvent
): 'polite' | 'assertive' {
  return event === 'alert' || event === 'error' ? 'assertive' : 'polite'
}
