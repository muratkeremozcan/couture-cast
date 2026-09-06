import type { ClimateBand } from '@couture/utils'
import type { SupportedLocale } from '@couture/api-client/contracts/http'

export interface AltTextSuggestionInput {
  climateBand: ClimateBand | null
  widthPx: number
  heightPx: number
  locale?: SupportedLocale
}

type Orientation = 'portrait' | 'landscape' | 'square'

function resolveOrientation(widthPx: number, heightPx: number): Orientation {
  if (widthPx > heightPx) return 'landscape'
  if (heightPx > widthPx) return 'portrait'
  return 'square'
}

/**
 * The band phrasing is deliberately descriptive rather than a band identifier:
 * an alt text is read aloud to someone who cannot see the photo, and
 * `cold_wet` is not a sentence.
 */
/** The locales this module holds suggestion copy for. */
type CopyLocale = 'en-US' | 'es-419' | 'fr-FR'

const DEFAULT_COPY_LOCALE: CopyLocale = 'en-US'

const BAND_PHRASES: Record<CopyLocale, Record<ClimateBand, string>> = {
  'en-US': {
    cold_dry: 'cold, dry weather',
    cold_wet: 'cold, wet weather',
    temperate_dry: 'mild, dry weather',
    temperate_wet: 'mild, wet weather',
    warm_dry: 'warm, dry weather',
    warm_wet: 'warm, humid weather',
  },
  'es-419': {
    cold_dry: 'clima frío y seco',
    cold_wet: 'clima frío y húmedo',
    temperate_dry: 'clima templado y seco',
    temperate_wet: 'clima templado y húmedo',
    warm_dry: 'clima cálido y seco',
    warm_wet: 'clima cálido y húmedo',
  },
  'fr-FR': {
    cold_dry: 'temps froid et sec',
    cold_wet: 'temps froid et humide',
    temperate_dry: 'temps doux et sec',
    temperate_wet: 'temps doux et humide',
    warm_dry: 'temps chaud et sec',
    warm_wet: 'temps chaud et humide',
  },
}

const ORIENTATION_PHRASES: Record<CopyLocale, Record<Orientation, string>> = {
  'en-US': { portrait: 'Portrait', landscape: 'Landscape', square: 'Square' },
  'es-419': {
    portrait: 'Foto vertical',
    landscape: 'Foto horizontal',
    square: 'Foto cuadrada',
  },
  'fr-FR': {
    portrait: 'Photo verticale',
    landscape: 'Photo horizontale',
    square: 'Photo carrée',
  },
}

const TEMPLATES: Record<
  CopyLocale,
  (orientation: string, band: string | null) => string
> = {
  'en-US': (orientation, band) =>
    band
      ? `${orientation} photo of an outfit styled for ${band}.`
      : `${orientation} photo of an outfit.`,
  'es-419': (orientation, band) =>
    band
      ? `${orientation} de un conjunto para ${band}.`
      : `${orientation} de un conjunto.`,
  'fr-FR': (orientation, band) =>
    band ? `${orientation} d'une tenue pour ${band}.` : `${orientation} d'une tenue.`,
}

const COPY_LOCALES = Object.keys(TEMPLATES) as CopyLocale[]

/**
 * Narrows a supported locale to one this module has copy for, so every lookup
 * below is total. `de-DE`, `tr-TR`, `it-IT` and `pt-*` all ship as locales and
 * have no suggestion copy; they land on the default. The suggestion is editable,
 * so an English starting point is usable rather than a blocker.
 */
function resolveCopyLocale(locale: SupportedLocale | undefined): CopyLocale {
  if (!locale) {
    return DEFAULT_COPY_LOCALE
  }
  const exact = COPY_LOCALES.find((candidate) => candidate === locale)
  if (exact) {
    return exact
  }
  const language = locale.split('-')[0]
  return (
    COPY_LOCALES.find((candidate) => candidate.startsWith(`${language}-`)) ??
    DEFAULT_COPY_LOCALE
  )
}

/**
 * Builds the editable alt-text suggestion the author confirms before publishing.
 *
 * The spec requires a SERVER-generated suggestion plus an explicit confirmation.
 * Before this, `publishPost` only rejected an empty string and the confirmation
 * was a client-side checkbox any direct API caller could skip. This function is
 * the generator half, returned on the allocate session as `altTextSuggestion`;
 * the confirmation half is `altTextConfirmed: z.literal(true)` on the publish
 * input, which the contract itself rejects when absent, stamped as
 * `alt_text_confirmed_at` in the same statement that writes the confirmed text.
 *
 * The suggestion is derived locally from what the server already knows at
 * allocation time: the declared dimensions and the author's resolved climate
 * band. It is deliberately generic, because an alt text that guesses at garments
 * it has not seen would be worse than one that describes the frame honestly and
 * invites the author to improve it.
 */
export function buildAltTextSuggestion(input: AltTextSuggestionInput): string {
  const copyLocale = resolveCopyLocale(input.locale)
  const orientation = resolveOrientation(input.widthPx, input.heightPx)
  const orientationPhrase = ORIENTATION_PHRASES[copyLocale][orientation]
  const bandPhrase = input.climateBand
    ? BAND_PHRASES[copyLocale][input.climateBand]
    : null

  return TEMPLATES[copyLocale](orientationPhrase, bandPhrase)
}
