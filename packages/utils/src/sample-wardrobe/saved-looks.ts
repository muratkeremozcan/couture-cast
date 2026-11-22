import type { ComfortRange, ComfortRun, ComfortTolerance } from '../comfort-rules'
import { type SampleBookmark } from './bookmarks'
import {
  SAMPLE_WEATHER_KEYS,
  type GuestSampleWeatherKey,
  type SampleOutfitResult,
} from './selector'
import {
  STYLE_PIECE_WEATHER_KEYS,
  type StylePieceLook,
  type StylePieceRecipe,
  type StylePieceSelection,
  type StylePieceWeatherKey,
} from './style-one-piece'
import {
  SAMPLE_COLLECTION_FILTERS,
  SAMPLE_GARMENT_CATEGORIES,
  type SampleCollectionFilter,
  type SampleGarmentCategory,
} from './types'

export type SavedLookSourceKind = 'style_piece' | 'home_sample'
export type SavedLookSlotKindValue = 'garment' | 'catalog'

export type SavedLookCompositionSlotPayload = {
  slotIndex: number
  category: SampleGarmentCategory
  kind: SavedLookSlotKindValue
  itemId: string
  label?: string | null
}

export type SavedLookAnchorSnapshotPayload = {
  garmentId: string
  category: SampleGarmentCategory
  comfortRange: ComfortRange
}

export type SavedLookComfortPayload = {
  runsColdWarm: ComfortRun
  windTolerance: ComfortTolerance
  precipPreparedness: ComfortTolerance
}

export type CreateSavedLookPayload = {
  source: SavedLookSourceKind
  lookId: string
  weather: string
  title?: string | null
  anchorGarmentId?: string | null
  anchorSnapshot?: SavedLookAnchorSnapshotPayload | null
  composition: SavedLookCompositionSlotPayload[]
  swaps: Partial<Record<SampleGarmentCategory, string>>
  collection?: string | null
  comfort?: SavedLookComfortPayload | null
}

export type SavedLookLike = {
  id: string
  source: SavedLookSourceKind
  lookId: string
  weather: string
  anchorGarmentId: string | null
  swaps: Partial<Record<SampleGarmentCategory, string>>
  collection: string | null
  comfort: SavedLookComfortPayload | null
}

const STYLE_PIECE_WEATHER_SET = new Set<string>(STYLE_PIECE_WEATHER_KEYS)
const SAMPLE_WEATHER_SET = new Set<string>(SAMPLE_WEATHER_KEYS)
const SAMPLE_COLLECTION_SET = new Set<string>(SAMPLE_COLLECTION_FILTERS)
const GARMENT_CATEGORY_SET = new Set<string>(SAMPLE_GARMENT_CATEGORIES)

function formatUuidFromBytes(bytes: Uint8Array): string {
  const b = new Uint8Array(bytes)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Generates an RFC 4122 UUID v4 suitable for HTTP `Idempotency-Key` headers. */
export function createIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto as
    | {
        randomUUID?: () => string
        getRandomValues?: (buffer: Uint8Array) => Uint8Array
      }
    | undefined

  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof cryptoObj?.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return formatUuidFromBytes(bytes)
}

function cleanSwaps(
  swaps: Readonly<Partial<Record<SampleGarmentCategory, string>>> | undefined
): Partial<Record<SampleGarmentCategory, string>> {
  const result: Partial<Record<SampleGarmentCategory, string>> = {}
  if (!swaps) return result
  for (const [category, itemId] of Object.entries(swaps)) {
    if (
      GARMENT_CATEGORY_SET.has(category) &&
      typeof itemId === 'string' &&
      itemId.length > 0
    ) {
      result[category as SampleGarmentCategory] = itemId
    }
  }
  return result
}

function swapsEqual(
  left: Readonly<Partial<Record<SampleGarmentCategory, string>>>,
  right: Readonly<Partial<Record<SampleGarmentCategory, string>>>
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (left[key as SampleGarmentCategory] !== right[key as SampleGarmentCategory]) {
      return false
    }
  }
  return true
}

/**
 * Builds the canonical account-backed SavedLook payload for a Style this piece look.
 * Slot 0 is always the anchor wardrobe garment; companion catalog pieces follow in
 * display order so reopening reproduces the exact slot order and swaps.
 */
export function buildStylePieceSavedLookInput(
  garment: StylePieceSelection,
  look: StylePieceLook
): CreateSavedLookPayload {
  const composition: SavedLookCompositionSlotPayload[] = [
    {
      slotIndex: 0,
      category: garment.category,
      kind: 'garment',
      itemId: garment.id,
    },
    ...look.companions.map((companion, index) => ({
      slotIndex: index + 1,
      category: companion.category,
      kind: 'catalog' as const,
      itemId: companion.id,
    })),
  ]

  return {
    source: 'style_piece',
    lookId: look.recipe.lookId,
    weather: look.recipe.weather,
    anchorGarmentId: garment.id,
    anchorSnapshot: {
      garmentId: garment.id,
      category: garment.category,
      comfortRange: garment.comfortRange,
    },
    composition,
    swaps: cleanSwaps(look.recipe.swaps),
  }
}

/**
 * Builds the canonical account-backed SavedLook payload for a signed-in Home sample look.
 * Returns `null` when the sample result has no selected look or garments.
 */
export function buildHomeSampleSavedLookInput(
  result: SampleOutfitResult
): CreateSavedLookPayload | null {
  const lookId = result.look?.id
  if (!lookId || result.garments.length === 0) return null
  const { weather, collection, comfort } = result.input
  if (!SAMPLE_WEATHER_SET.has(weather)) return null

  const swaps: Partial<Record<SampleGarmentCategory, string>> = {}
  for (const garment of result.garments) {
    if (result.input.swaps[lookId]?.[garment.category] === garment.id) {
      swaps[garment.category] = garment.id
    }
  }

  return {
    source: 'home_sample',
    lookId,
    weather,
    collection,
    comfort: {
      runsColdWarm: comfort.runsColdWarm,
      windTolerance: comfort.windTolerance,
      precipPreparedness: comfort.precipPreparedness,
    },
    composition: result.garments.map((garment, index) => ({
      slotIndex: index,
      category: garment.category,
      kind: 'catalog' as const,
      itemId: garment.id,
    })),
    swaps,
  }
}

/** Extracts a `StylePieceRecipe` for reopening a saved look in `StylePiecePanel`. */
export function savedLookToStylePieceRecipe(
  savedLook: SavedLookLike
): StylePieceRecipe | null {
  if (savedLook.source !== 'style_piece') return null
  if (!STYLE_PIECE_WEATHER_SET.has(savedLook.weather)) return null
  return {
    lookId: savedLook.lookId,
    weather: savedLook.weather as StylePieceWeatherKey,
    swaps: cleanSwaps(savedLook.swaps),
  }
}

/** Extracts a `SampleBookmark` for reopening a Home sample saved look. */
export function savedLookToSampleBookmark(
  savedLook: SavedLookLike
): SampleBookmark | null {
  if (savedLook.source !== 'home_sample') return null
  if (!SAMPLE_WEATHER_SET.has(savedLook.weather)) return null
  if (!savedLook.collection || !SAMPLE_COLLECTION_SET.has(savedLook.collection)) {
    return null
  }
  if (!savedLook.comfort) return null
  return {
    lookId: savedLook.lookId,
    weather: savedLook.weather as GuestSampleWeatherKey,
    collection: savedLook.collection as SampleCollectionFilter,
    comfort: {
      runsColdWarm: savedLook.comfort.runsColdWarm,
      windTolerance: savedLook.comfort.windTolerance,
      precipPreparedness: savedLook.comfort.precipPreparedness,
    },
    swaps: cleanSwaps(savedLook.swaps),
  }
}

/** Checks whether an account saved look matches a given Style this piece look. */
export function savedLookMatchesStylePiece(
  savedLook: SavedLookLike,
  garmentId: string,
  look: StylePieceLook
): boolean {
  return (
    savedLook.source === 'style_piece' &&
    savedLook.anchorGarmentId === garmentId &&
    savedLook.lookId === look.recipe.lookId &&
    savedLook.weather === look.recipe.weather &&
    swapsEqual(cleanSwaps(savedLook.swaps), cleanSwaps(look.recipe.swaps))
  )
}

/** Checks whether an account saved look matches a given Home sample outfit result. */
export function savedLookMatchesHomeSample(
  savedLook: SavedLookLike,
  result: SampleOutfitResult
): boolean {
  const input = buildHomeSampleSavedLookInput(result)
  if (!input) return false
  return (
    savedLook.source === 'home_sample' &&
    savedLook.lookId === input.lookId &&
    savedLook.weather === input.weather &&
    savedLook.collection === input.collection &&
    savedLook.comfort?.runsColdWarm === input.comfort?.runsColdWarm &&
    savedLook.comfort?.windTolerance === input.comfort?.windTolerance &&
    savedLook.comfort?.precipPreparedness === input.comfort?.precipPreparedness &&
    swapsEqual(cleanSwaps(savedLook.swaps), input.swaps)
  )
}
