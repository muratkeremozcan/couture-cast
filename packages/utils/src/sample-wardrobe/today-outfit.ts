import { SAMPLE_CATALOG } from './catalog'
import { preferGarmentSubtypes, type GarmentSubtype } from './garment-subtypes'
import {
  createIdempotencyKey,
  type CreateSavedLookPayload,
  type SavedLookSlotKindValue,
} from './saved-looks'
import {
  buildSampleContext,
  DEFAULT_SAMPLE_COMFORT,
  garmentSuitsRange,
  sampleSwapCandidates,
  type SampleWeather,
} from './selector'
import {
  SAMPLE_GARMENT_CATEGORIES,
  type SampleGarment,
  type SampleGarmentCategory,
} from './types'
import type { ComfortRange } from '../comfort-rules'

export type TodayImageAccess = { url: string; expiresAt: string }

export type TodaySlot = {
  itemId: string
  category: SampleGarmentCategory
  subtype?: GarmentSubtype | null
  kind: SavedLookSlotKindValue
  imageAccess?: TodayImageAccess | null
  art: { key: string; primary: string; secondary: string }
}

type TodayWardrobePiece = {
  id: string
  category: SampleGarmentCategory | null
  subtype?: GarmentSubtype | null
  status: string
  retentionStatus: string
  comfortRange?: ComfortRange | null
  imageAccess?: TodayImageAccess | null
}

type TodayRecommendation = {
  id: string
  garmentIds: readonly string[]
  displayGarments?: readonly {
    id: string
    category: SampleGarmentCategory | null
    imageAccess?: TodayImageAccess | null
  }[]
}

type TodayScenario = 'morning' | 'midday' | 'evening'
type TodayWeather = {
  timezone: string
  current: { temperature: number; condition: string }
  hourly: readonly (SampleWeather & {
    forecastAt: string
    temperature: number
    condition: string
  })[]
}

const scenarioHour = { morning: 8, midday: 13, evening: 19 } as const
const catalogById = new Map(SAMPLE_CATALOG.garments.map((piece) => [piece.id, piece]))
const categoryByPlaceholder = new Map(
  SAMPLE_GARMENT_CATEGORIES.map((category) => [`default-${category}`, category])
)
const neutralArt = { key: '', primary: '', secondary: '' }
const sampleContextInput = {
  weather: 'mild-dry',
  collection: 'all',
  comfort: DEFAULT_SAMPLE_COMFORT,
} as const

export function todayCatalogSlot(garment: SampleGarment): TodaySlot {
  return {
    itemId: garment.id,
    category: garment.category,
    ...(garment.subtype && { subtype: garment.subtype }),
    art: garment.art,
    kind: 'catalog',
  }
}

function catalogCandidates(category: SampleGarmentCategory, weather: SampleWeather) {
  return sampleSwapCandidates(
    SAMPLE_CATALOG,
    category,
    sampleContextInput,
    buildSampleContext(sampleContextInput, weather)
  )
}

export function buildTodaySlots(
  outfit: TodayRecommendation,
  weather: SampleWeather,
  wardrobe: readonly TodayWardrobePiece[]
): TodaySlot[] {
  const recommended = new Map(outfit.displayGarments?.map((piece) => [piece.id, piece]))
  const closet = new Map(wardrobe.map((piece) => [piece.id, piece]))
  return outfit.garmentIds.map((itemId) => {
    const catalog = catalogById.get(itemId)
    if (catalog) return todayCatalogSlot(catalog)

    const piece = recommended.get(itemId)
    const owned = closet.get(itemId)
    const category = piece?.category ?? owned?.category
    const placeholder = categoryByPlaceholder.get(itemId)
    if (placeholder || !category) {
      const fallbackCategory = placeholder ?? 'top'
      const base =
        catalogCandidates(fallbackCategory, weather)[0] ??
        SAMPLE_CATALOG.garments.find((piece) => piece.category === fallbackCategory)!
      return todayCatalogSlot(base)
    }

    return {
      itemId,
      category,
      ...(owned?.subtype && { subtype: owned.subtype }),
      imageAccess: piece?.imageAccess,
      kind: 'garment',
      art: neutralArt,
    }
  })
}

function isCompatibleClosetPiece(
  piece: TodayWardrobePiece,
  category: SampleGarmentCategory,
  range: ComfortRange
): boolean {
  return (
    piece.category === category &&
    piece.status === 'ready' &&
    piece.retentionStatus === 'active' &&
    (!piece.comfortRange ||
      garmentSuitsRange({ comfortRanges: [piece.comfortRange] }, range))
  )
}

export function todaySwapOptions(
  slots: readonly TodaySlot[],
  index: number,
  wardrobe: readonly TodayWardrobePiece[],
  weather: SampleWeather
): TodaySlot[] {
  const current = slots[index]
  if (!current) return []
  const usedIds = new Set(slots.map((slot) => slot.itemId))
  const range = buildSampleContext(sampleContextInput, weather).range
  const closet = wardrobe.flatMap((piece): TodaySlot[] =>
    isCompatibleClosetPiece(piece, current.category, range) && !usedIds.has(piece.id)
      ? [
          {
            itemId: piece.id,
            category: current.category,
            ...(piece.subtype && { subtype: piece.subtype }),
            imageAccess: piece.imageAccess,
            kind: 'garment',
            art: neutralArt,
          },
        ]
      : []
  )
  const catalog = catalogCandidates(current.category, weather)
    .filter((piece) => !usedIds.has(piece.id))
    .map(todayCatalogSlot)
  const matches = current.subtype ? [current.subtype] : []
  return [
    current,
    ...preferGarmentSubtypes(closet, matches),
    ...preferGarmentSubtypes(catalog, matches),
  ]
}

export function todaySlotCatalogItem(slot: TodaySlot): SampleGarment | undefined {
  return slot.kind === 'catalog' ? catalogById.get(slot.itemId) : undefined
}

export function todaySlotSignature(slots: readonly TodaySlot[]): string {
  return JSON.stringify(
    slots.map(({ category, kind, itemId }) => [category, kind, itemId])
  )
}

export type TodaySlotEdits = Readonly<Partial<Record<number, TodaySlot>>>

export function applyTodaySlotEdits(
  slots: readonly TodaySlot[],
  edits: TodaySlotEdits | undefined,
  wardrobe: readonly TodayWardrobePiece[],
  weather: SampleWeather
): TodaySlot[] {
  if (!edits) return [...slots]
  const range = buildSampleContext(sampleContextInput, weather).range
  return slots.map((slot, index) => {
    const selected = edits[index]
    if (
      !selected ||
      selected.category !== slot.category ||
      selected.itemId === slot.itemId
    ) {
      return slot
    }
    if (selected.kind === 'catalog') return selected
    const piece = wardrobe.find(
      (item) =>
        item.id === selected.itemId && isCompatibleClosetPiece(item, slot.category, range)
    )
    return piece
      ? {
          ...selected,
          ...(piece.subtype !== undefined && { subtype: piece.subtype }),
          imageAccess: piece.imageAccess,
        }
      : slot
  })
}

export function todayLocalDate(timeZone: string, now = new Date()): string {
  return todayDateAndHour(timeZone)(now).date
}

function todayDateAndHour(timeZone: string) {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
  let formatter: Intl.DateTimeFormat
  try {
    formatter = format(timeZone)
  } catch {
    formatter = format('UTC')
  }
  return (at: Date) => {
    const parts = formatter.formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      hour: Number(part('hour')),
    }
  }
}

export function todayForecastPeriods(weather: TodayWeather, readAt: number) {
  const local = todayDateAndHour(weather.timezone)
  const anchor = todayRitualAnchorDate(weather.timezone, readAt)
  const byDay = new Map<string, Map<number, TodayWeather['hourly'][number]>>()
  for (const entry of weather.hourly) {
    const time = local(new Date(entry.forecastAt))
    if (
      time.hour !== scenarioHour.morning &&
      time.hour !== scenarioHour.midday &&
      time.hour !== scenarioHour.evening
    )
      continue
    const day = byDay.get(time.date) ?? new Map<number, TodayWeather['hourly'][number]>()
    if (!day.has(time.hour)) day.set(time.hour, entry)
    byDay.set(time.date, day)
  }
  const anchored = byDay.get(anchor)
  const periods =
    anchored?.size === 3
      ? anchored
      : [...byDay.values()].reverse().find((day) => day.size === 3)
  return periods
    ? {
        morning: periods.get(scenarioHour.morning)!,
        midday: periods.get(scenarioHour.midday)!,
        evening: periods.get(scenarioHour.evening)!,
      }
    : undefined
}

export function todayRitualAnchorDate(timeZone: string, readAt: number) {
  const local = todayDateAndHour(timeZone)
  const { date, hour } = local(new Date(readAt))
  if (hour < scenarioHour.morning) return date
  const tomorrow = new Date(`${date}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
}

export function todayScenarioWeather(
  weather: TodayWeather,
  scenario: TodayScenario,
  readAt: number
) {
  return (
    todayForecastPeriods(weather, readAt)?.[scenario] ?? {
      ...weather.current,
      feelsLike: weather.current.temperature,
      windSpeed: 0,
      precipitationAmount: 0,
      precipitationProbability: 0,
    }
  )
}

export function todayLookNameKey(weather: SampleWeather & { condition: string }) {
  const context = buildSampleContext(sampleContextInput, weather)
  if (
    context.rainReady ||
    ['drizzle', 'rain', 'thunderstorm', 'sleet'].includes(weather.condition)
  ) {
    return 'rain'
  }
  if (context.windLayer || weather.condition === 'wind') return 'wind'
  if (context.range === 'cold' || context.range === 'cool') return 'cool'
  if (context.range === 'warm' || context.range === 'hot') return 'warm'
  return 'mild'
}

export function buildTodaySaveAttempt(
  outfitId: string,
  condition: string,
  slots: readonly TodaySlot[],
  wornOn: string,
  title: string
): { payload: CreateSavedLookPayload; idempotencyKey: string } {
  return {
    payload: {
      source: 'today',
      lookId: `today:${wornOn}:${outfitId}`.slice(0, 64),
      weather: condition,
      wornOn,
      title,
      composition: slots.map(({ itemId, category, kind }, slotIndex) => ({
        itemId,
        category,
        kind,
        slotIndex,
      })),
      swaps: {},
    },
    idempotencyKey: createIdempotencyKey(),
  }
}
