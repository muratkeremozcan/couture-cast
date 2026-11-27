// Story 6.16: turns a policy result into words with the shared strings, so web and
// mobile say exactly the same thing for the same state.
import { getRainProbThreshold } from '../comfort-rules'
import type { SampleExplanation } from './selector'
import type { SampleCatalog, SampleGarment, SampleLook } from './types'
import {
  GUEST_PREVIEW_LOCALES,
  GUEST_PREVIEW_STRINGS,
  type GuestPreviewLocale,
  type GuestPreviewStrings,
} from './strings'

export function resolveGuestPreviewLocale(
  locale: string | undefined
): GuestPreviewLocale {
  const match = GUEST_PREVIEW_LOCALES.find((supported) => supported === locale)
  return match ?? 'en-US'
}

export function getGuestPreviewStrings(locale: string | undefined): GuestPreviewStrings {
  return GUEST_PREVIEW_STRINGS[resolveGuestPreviewLocale(locale)]
}

/** Fills {name} placeholders. An unknown placeholder stays visible so tests catch it. */
export function formatPreviewString(
  template: string,
  params: Readonly<Record<string, string | number>> = {}
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** en-US shows Fahrenheit like the ritual engine; every other locale shows Celsius. */
export function formatSampleTemperature(
  celsius: number,
  locale: string | undefined
): string {
  return resolveGuestPreviewLocale(locale) === 'en-US'
    ? `${Math.round((celsius * 9) / 5 + 32)}°F`
    : `${Math.round(celsius)}°C`
}

export function formatRainChance(percent: number, strings: GuestPreviewStrings): string {
  const { none, possible, likely } = strings.values.rainChance
  if (percent <= 0) return none
  return percent < 50 ? possible : likely
}

const slug = (id: string) => id.slice('sample:x:'.length)

export function sampleGarmentText(
  garment: Pick<SampleGarment, 'id'>,
  strings: GuestPreviewStrings
): { name: string; description: string } {
  return (
    (strings.garments as Record<string, { name: string; description: string }>)[
      slug(garment.id)
    ] ?? {
      name: garment.id,
      description: garment.id,
    }
  )
}

export function sampleLookText(
  look: Pick<SampleLook, 'id'>,
  strings: GuestPreviewStrings
): { name: string; description: string } {
  return (
    (strings.looks as Record<string, { name: string; description: string }>)[
      slug(look.id)
    ] ?? {
      name: look.id,
      description: look.id,
    }
  )
}

function pick<T extends Record<string, string>>(
  table: T,
  key: string | number | undefined
): string {
  return (table as Record<string, string>)[String(key)] ?? String(key)
}

export function formatSampleExplanation(
  item: SampleExplanation,
  options: {
    strings: GuestPreviewStrings
    locale: string | undefined
    catalog: SampleCatalog
  }
): string {
  const { strings, locale, catalog } = options
  const { values } = strings
  const p = item.params
  const garment = catalog.garments.find((entry) => entry.id === p.garmentId)
  const look = catalog.looks.find((entry) => entry.id === p.lookId)
  const temperature = (value: string | number | undefined) =>
    typeof value === 'number' ? formatSampleTemperature(value, locale) : ''
  const rainSetting = (['high', 'medium', 'low'] as const).find(
    (setting) =>
      Math.round(getRainProbThreshold(setting) * 100) === p.rainThresholdPercent
  )
  return formatPreviewString(strings.explanation[item.key], {
    ...p,
    weather: pick(values.weather, p.weather),
    feelsLike: temperature(p.feelsLike),
    adjustedFeelsLike: temperature(p.adjustedFeelsLike),
    threshold: temperature(p.threshold),
    rainPercent:
      typeof p.rainPercent === 'number' ? formatRainChance(p.rainPercent, strings) : '',
    rainThresholdPercent: rainSetting ? values.precipPreparedness[rainSetting] : '',
    range: pick(values.range, p.range),
    runsColdWarm: pick(values.range, p.runsColdWarm),
    category: pick(values.category, p.category),
    cause: pick(values.swapCause, p.cause),
    control: pick(values.control, p.control),
    collection: pick(values.collection, p.collection),
    garment: garment ? sampleGarmentText(garment, strings).name : '',
    look: look ? sampleLookText(look, strings).name : '',
  })
}
