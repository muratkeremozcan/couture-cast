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

  const listFormat = (
    Intl as typeof Intl & {
      ListFormat?: typeof Intl.ListFormat
    }
  ).ListFormat
  if (listFormat) {
    return new listFormat(locale, {
      style: 'long',
      type: 'conjunction',
    }).format(parts)
  }

  const language = locale.split('-')[0]?.toLowerCase() ?? 'en'
  const conjunction =
    {
      de: 'und',
      es: 'y',
      fr: 'et',
      it: 'e',
      pt: 'e',
      tr: 've',
    }[language] ?? 'and'
  const head = parts.slice(0, -1)
  const tail = parts.at(-1) ?? ''
  return head.length === 1
    ? `${head[0]} ${conjunction} ${tail}`
    : `${head.join(', ')}, ${conjunction} ${tail}`
}

/**
 * Joins already-localized parts the way the reader's language joins a list.
 *
 * Public because more than accessibility copy needs it: any surface rendering a
 * list of localized names needs the same punctuation, and `join(', ')` is wrong
 * in most of the languages this ships in. German wants "und", French "et",
 * Turkish "ve", Spanish "y", and English and Canadian English disagree about the
 * serial comma.
 *
 * Call this rather than `Intl.ListFormat` directly. `Intl.ListFormat` is optional
 * under ECMA-402 and Hermes ships without it, so constructing one on a device
 * throws `TypeError: Cannot read property 'prototype' of undefined`. This helper
 * uses the real thing where it exists and falls back where it does not.
 */
export function formatLocalizedList(
  parts: readonly string[],
  locale: string = DEFAULT_LOCALE
): string {
  // No normalizing here: this is a plain locale-aware join, so it stays a drop-in
  // replacement for `Intl.ListFormat`. De-duplicating would silently drop a genuine
  // repeat that the caller meant to show.
  return formatList(parts, safeLocale(locale))
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
