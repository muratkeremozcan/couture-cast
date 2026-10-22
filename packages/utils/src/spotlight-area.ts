// Story 6.6: canonical coarse area components for the City Spotlight.
//
// Members type their saved location freely, so `USA` and `United States`, or
// `Sao Paulo` and `São Paulo`, must land in one area. The country resolves to
// its ISO 3166-1 alpha-2 code; region and city fold to one spelling. Nothing
// here runs at import time, so clients that load this package never pay for
// the country table.

/** The ten product locales whose country names resolve. */
export const SPOTLIGHT_COUNTRY_LOCALES = [
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

/**
 * Region codes ICU names that are no ISO 3166-1 country: exceptional
 * reservations, groupings and pseudo-regions. `XK` (Kosovo) stays, as the
 * user-assigned code every registry uses for it.
 */
const NON_COUNTRY_REGIONS = new Set([
  'AC',
  'CP',
  'CQ',
  'DG',
  'EA',
  'IC',
  'TA',
  'EU',
  'EZ',
  'UN',
  'QO',
  'XA',
  'XB',
  'ZZ',
])

/**
 * Common spellings no locale's display name covers: abbreviations, former
 * names and constituent countries. Keys are already in `countryKey` form.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  uae: 'AE',
  holland: 'NL',
  turkey: 'TR',
  'czech republic': 'CZ',
  'ivory coast': 'CI',
  burma: 'MM',
  swaziland: 'SZ',
  macedonia: 'MK',
  'cape verde': 'CV',
  'east timor': 'TL',
  'vatican city': 'VA',
}

/**
 * Trimmed, NFKD with combining marks removed, Turkish dotted and dotless I
 * folded, then lowercased. NFC afterwards recomposes scripts NFKD split
 * without marks, such as Hangul. Blank collapses to null.
 */
export function foldAreaComponent(value: string | null | undefined): string | null {
  if (value == null) return null
  const folded = value
    .trim()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .trim()
  return folded.length > 0 ? folded : null
}

/** The lookup form of a country name: folded, dots dropped, separators collapsed. */
function countryKey(value: string): string | null {
  const folded = foldAreaComponent(value)
  if (!folded) return null
  const key = folded
    .replace(/\./g, '')
    .replace(/[\s\-‐‑–—_,'’()]+/g, ' ')
    .trim()
  return key.length > 0 ? key : null
}

let countryTable: {
  codes: readonly string[]
  byKey: ReadonlyMap<string, string>
} | null = null

/**
 * Every ISO 3166-1 alpha-2 code ICU names, with the long and short display
 * name of each in every product locale. Alias codes ICU canonicalizes to
 * another code (`UK` to `GB`) are left to the alias table. The first locale to
 * claim a name keeps it, so the table never depends on iteration luck.
 */
function countries() {
  if (countryTable) return countryTable
  const codes: string[] = []
  const english = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second)
      if (NON_COUNTRY_REGIONS.has(code) || !english.of(code)) continue
      if (new Intl.Locale(`und-${code}`).region !== code) continue
      codes.push(code)
    }
  }
  const byKey = new Map<string, string>()
  const claim = (name: string | undefined, code: string) => {
    const key = name ? countryKey(name) : null
    if (key && !byKey.has(key)) byKey.set(key, code)
  }
  for (const code of codes) claim(code, code)
  for (const locale of SPOTLIGHT_COUNTRY_LOCALES) {
    for (const style of ['long', 'short'] as const) {
      const names = new Intl.DisplayNames([locale], {
        type: 'region',
        style,
        fallback: 'none',
      })
      for (const code of codes) claim(names.of(code), code)
    }
  }
  for (const [key, code] of Object.entries(COUNTRY_ALIASES)) {
    if (!byKey.has(key)) byKey.set(key, code)
  }
  countryTable = { codes, byKey }
  return countryTable
}

/** Every canonical country code, in code order. */
export function spotlightCountryCodes(): readonly string[] {
  return countries().codes
}

/**
 * The ISO 3166-1 alpha-2 code a saved country names, in any product locale,
 * as a code, or through the alias table. Text that resolves to nothing is
 * null, so the post stays unstamped and the viewer sits at level `none`.
 */
export function canonicalCountryCode(value: string | null | undefined): string | null {
  const key = value == null ? null : countryKey(value)
  return key ? (countries().byKey.get(key) ?? null) : null
}

export interface SpotlightAreaSource {
  country: string | null
  region: string | null
  city: string | null
}

export interface CanonicalSpotlightArea {
  country: string | null
  region: string | null
  city: string | null
}

/**
 * Keeps only the prefix whose parents all resolve, so a city under a missing
 * region is dropped and can never merge with a same-named city elsewhere.
 */
export function canonicalSpotlightArea(
  source: SpotlightAreaSource
): CanonicalSpotlightArea {
  const country = canonicalCountryCode(source.country)
  const region = country ? foldAreaComponent(source.region) : null
  const city = region ? foldAreaComponent(source.city) : null
  return { country, region, city }
}
