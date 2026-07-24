// Story 3.3 Task 1 step 1 owner: serialize localized widget data and persist one atomic native payload.
import { NativeModules, Platform } from 'react-native'
import type {
  RitualResponse,
  SupportedLocale,
  WeatherHourlyEntry,
} from '@couture/api-client/contracts/http'
import { formatTemperature } from './formatters'
import { getWidgetCopy } from './widget-copy'

interface WidgetSharedModuleInterface {
  setWidgetData(payload: string): Promise<void>
}

export type WidgetSlot = 'now' | 'next'
export type WidgetScenario = 'morning' | 'midday' | 'evening'

export interface WidgetData {
  currentTemp: string
  feelsLikeTemp: string
  currentConditionIcon: string
  currentConditionText: string
  nowOutfitSummary: string
  nextHourTime: string
  nextHourTemp: string
  nextHourIcon: string
  nextHourPrecipitation: string
  nextOutfitSummary: string
  lastUpdated: string
  locale: string
  nowLabel: string
  nextHourLabel: string
  staleLabel: string
  unavailableLabel: string
  precipitationLabel: string
}

type TimestampedHourlyEntry = {
  entry: WeatherHourlyEntry
  timestamp: number
}

function getWidgetSharedModule(): WidgetSharedModuleInterface | undefined {
  return NativeModules['WidgetSharedModule'] as WidgetSharedModuleInterface | undefined
}

export function getScenarioForHour(hour: number): WidgetScenario {
  if (hour >= 6 && hour < 11) {
    return 'morning'
  }
  if (hour >= 11 && hour < 17) {
    return 'midday'
  }
  return 'evening'
}

function hourInTimeZone(date: Date, timeZone: string): number {
  try {
    const hourPart = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
      .formatToParts(date)
      .find((part) => part.type === 'hour')
    const hour = Number(hourPart?.value)
    return Number.isInteger(hour) ? hour : date.getUTCHours()
  } catch {
    return date.getUTCHours()
  }
}

export function getScenarioForInstant(instant: Date, timeZone: string): WidgetScenario {
  return getScenarioForHour(hourInTimeZone(instant, timeZone))
}

function timestampedHourlyEntries(
  entries: readonly WeatherHourlyEntry[]
): TimestampedHourlyEntry[] {
  return entries
    .map((entry) => ({ entry, timestamp: Date.parse(entry.forecastAt) }))
    .filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((left, right) => left.timestamp - right.timestamp)
}

export function findNextHourlyEntry(
  ritual: RitualResponse,
  nowMs = Date.now()
): WeatherHourlyEntry | undefined {
  return timestampedHourlyEntries(ritual.data.weather.hourly).find(
    ({ timestamp }) => timestamp > nowMs
  )?.entry
}

function findClosestHourlyEntry(
  entries: readonly WeatherHourlyEntry[],
  nowMs: number
): WeatherHourlyEntry | undefined {
  return timestampedHourlyEntries(entries).reduce<TimestampedHourlyEntry | undefined>(
    (closest, candidate) => {
      if (!closest) {
        return candidate
      }
      return Math.abs(candidate.timestamp - nowMs) < Math.abs(closest.timestamp - nowMs)
        ? candidate
        : closest
    },
    undefined
  )?.entry
}

export function resolveWidgetScenario(
  ritual: RitualResponse,
  slot: WidgetSlot,
  nowMs = Date.now()
): WidgetScenario {
  const weather = ritual.data.weather
  const instant =
    slot === 'next'
      ? new Date(findNextHourlyEntry(ritual, nowMs)?.forecastAt ?? nowMs)
      : new Date(nowMs)
  return getScenarioForInstant(instant, weather.timezone)
}

function formatPrecipitation(probability: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(probability)
}

function formatForecastTime(
  forecastAt: string,
  locale: SupportedLocale,
  timeZone: string
): string {
  return new Date(forecastAt).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale === 'en-US',
    timeZone,
  })
}

export function createWidgetData(
  ritual: RitualResponse,
  locale: SupportedLocale,
  lastUpdatedMs = Date.now(),
  nowMs = Date.now()
): WidgetData {
  const weather = ritual.data.weather
  const current = weather.current
  const copy = getWidgetCopy(locale, current.condition)
  const outfits = ritual.data.outfits
  const currentHourly = findClosestHourlyEntry(weather.hourly, nowMs)
  const nextHourEntry = findNextHourlyEntry(ritual, nowMs)
  const nowScenario = resolveWidgetScenario(ritual, 'now', nowMs)
  const nextScenario = resolveWidgetScenario(ritual, 'next', nowMs)

  return {
    currentTemp: formatTemperature(current.temperature, locale),
    feelsLikeTemp: formatTemperature(
      currentHourly?.feelsLike ?? current.temperature,
      locale
    ),
    currentConditionIcon: current.condition,
    currentConditionText: copy.condition,
    nowOutfitSummary:
      outfits.find((outfit) => outfit.scenario === nowScenario)?.comfortNotes ?? '',
    nextHourTime: nextHourEntry
      ? formatForecastTime(nextHourEntry.forecastAt, locale, weather.timezone)
      : '',
    nextHourTemp: nextHourEntry
      ? formatTemperature(nextHourEntry.temperature, locale)
      : '',
    nextHourIcon: nextHourEntry?.condition ?? 'unknown',
    nextHourPrecipitation: nextHourEntry
      ? formatPrecipitation(nextHourEntry.precipitationProbability, locale)
      : '',
    nextOutfitSummary:
      outfits.find((outfit) => outfit.scenario === nextScenario)?.comfortNotes ?? '',
    lastUpdated: new Date(lastUpdatedMs).toISOString(),
    locale,
    nowLabel: copy.now,
    nextHourLabel: copy.nextHour,
    staleLabel: copy.stale,
    unavailableLabel: copy.unavailable,
    precipitationLabel: copy.precipitation,
  }
}

export async function shareWidgetData(
  ritual: RitualResponse,
  locale: SupportedLocale,
  lastUpdatedMs = Date.now()
): Promise<void> {
  const widgetData = createWidgetData(ritual, locale, lastUpdatedMs)
  const payload = JSON.stringify(widgetData)

  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem('OutfitWidgetData', payload)
    return
  }

  const widgetSharedModule = getWidgetSharedModule()
  if (!widgetSharedModule?.setWidgetData) {
    throw new Error('WidgetSharedModule is unavailable in this native build')
  }

  await widgetSharedModule.setWidgetData(payload)
}
