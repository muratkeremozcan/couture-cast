import { z } from 'zod'
import {
  COMFORT_RANGES,
  type ComfortRange,
  type ComfortRun,
  type ComfortTolerance,
} from '../comfort-rules'
import {
  MAX_SAMPLE_BOOKMARK_BYTES,
  openSampleBookmark,
  type SampleBookmark,
} from './bookmarks'
import { SAMPLE_CATALOG } from './catalog'
import {
  COMMUNITY_SAMPLE_WEATHER_KEYS,
  SAMPLE_WEATHER_KEYS,
  selectSampleOutfit,
  type GuestSampleWeatherKey,
  type SampleOutfitResult,
  type SampleWeatherKey,
} from './selector'
import {
  applyStylePieceRecipe,
  isStylePieceOwnedCompanion,
  MAX_STYLE_PIECE_STORAGE_BYTES,
  STYLE_PIECE_WEATHER_KEYS,
  stylePieceAnchor,
  stylePieceCompanionSuitsWeather,
  stylePieceLooks,
  stylePieceOwnedCompanions,
  stylePieceRecipeKey,
  stylePieceStorageKey,
  stylePieceSwapOptions,
  type StylePieceAnchor,
  type StylePieceLook,
  type StylePieceOwnedCompanion,
  type StylePieceRecipe,
  type StylePieceSelection,
  type StylePieceWeatherKey,
} from './style-one-piece'
import {
  SAMPLE_COLLECTION_FILTERS,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_GARMENT_ID_PATTERN,
  SAMPLE_LOOK_ID_PATTERN,
  type SampleCatalog,
  type SampleCollectionFilter,
  type SampleGarmentCategory,
} from './types'

export type SavedLookSourceKind = 'style_piece' | 'home_sample' | 'today'
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
  wornOn?: string
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
  wornOn?: string
  anchorGarmentId: string | null
  swaps: Partial<Record<SampleGarmentCategory, string>>
  collection: string | null
  comfort: SavedLookComfortPayload | null
  composition?: readonly SavedLookCompositionSlotPayload[]
}

export type LegacySavedLookImportEntry<TRaw> = {
  sourceId: string
  idempotencyKey: string
  payload: CreateSavedLookPayload
  rawEntry: TRaw
  resolvesCleanly: boolean
}

const STYLE_PIECE_WEATHER_SET = new Set<string>(STYLE_PIECE_WEATHER_KEYS)
const SAMPLE_WEATHER_SET = new Set<string>([
  ...SAMPLE_WEATHER_KEYS,
  ...COMMUNITY_SAMPLE_WEATHER_KEYS,
])
const SAMPLE_COLLECTION_SET = new Set<string>(SAMPLE_COLLECTION_FILTERS)
const GARMENT_CATEGORY_SET = new Set<string>(SAMPLE_GARMENT_CATEGORIES)

const HOME_SAMPLE_DISPLAY_ORDER: readonly SampleGarmentCategory[] = [
  'outerwear',
  'top',
  'dress',
  'bottom',
  'shoes',
  'accessory',
]

const MEMBER_SAMPLE_BOOKMARKS_PREFIX = 'couturecast.member-sample-bookmarks.'
const STYLE_PIECE_STORAGE_PREFIX = 'couturecast.style-piece.'
const MAX_LEGACY_IMPORT_ITEMS = 32

const legacyToleranceSchema = z.enum(['low', 'medium', 'high'])

const legacySampleBookmarkSchema = z
  .object({
    lookId: z.string().regex(SAMPLE_LOOK_ID_PATTERN),
    weather: z.enum(SAMPLE_WEATHER_KEYS),
    collection: z.enum(SAMPLE_COLLECTION_FILTERS),
    comfort: z
      .object({
        runsColdWarm: z.enum(['cold', 'neutral', 'warm']),
        windTolerance: legacyToleranceSchema,
        precipPreparedness: legacyToleranceSchema,
      })
      .strict(),
    swaps: z.partialRecord(
      z.enum(SAMPLE_GARMENT_CATEGORIES),
      z.string().regex(SAMPLE_GARMENT_ID_PATTERN)
    ),
  })
  .strict()

const legacyStylePieceRecipeSchema = z
  .object({
    lookId: z.string().regex(SAMPLE_LOOK_ID_PATTERN),
    weather: z.enum(STYLE_PIECE_WEATHER_KEYS),
    swaps: z.partialRecord(
      z.enum(SAMPLE_GARMENT_CATEGORIES),
      z.string().regex(SAMPLE_GARMENT_ID_PATTERN)
    ),
  })
  .strict()

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

function mix32(value: number): number {
  let h = value | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Generates a deterministic RFC 4122 UUID v4 from `seed` so interrupted or concurrent
 * device-saved look imports reuse the exact same `Idempotency-Key` per stable source id.
 */
export function createDeterministicIdempotencyKey(seed: string): string {
  const input = new TextEncoder().encode(seed)
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x7f4a7c15, 0x6a09e667] as const
  const bytes = new Uint8Array(16)

  for (let lane = 0; lane < 4; lane += 1) {
    let h = seeds[lane]! >>> 0
    const prime = (0x01000193 + lane * 0x16a) >>> 0
    for (let i = 0; i < input.length; i += 1) {
      h ^= (input[i]! + lane * 31 + (i & 0xff)) & 0xff
      h = Math.imul(h, prime) >>> 0
    }
    h = mix32(h ^ input.length)
    const offset = lane * 4
    bytes[offset] = (h >>> 24) & 0xff
    bytes[offset + 1] = (h >>> 16) & 0xff
    bytes[offset + 2] = (h >>> 8) & 0xff
    bytes[offset + 3] = h & 0xff
  }

  return formatUuidFromBytes(bytes)
}

/**
 * Returns the candidate device storage keys for a member's pre-CC-7.2 Home sample bookmarks.
 * Web used the raw owner suffix while mobile used `encodeURIComponent(owner)`.
 */
export function memberSampleBookmarksStorageKeys(owner: string): string[] {
  const trimmed = owner.trim()
  if (!trimmed || trimmed.includes('\u0000')) return []
  return Array.from(
    new Set([
      `${MEMBER_SAMPLE_BOOKMARKS_PREFIX}${trimmed}`,
      `${MEMBER_SAMPLE_BOOKMARKS_PREFIX}${encodeURIComponent(trimmed)}`,
    ])
  )
}

/**
 * Extracts the owner member id from a `couturecast.member-sample-bookmarks.<owner>` key,
 * or returns `null` if the key is not a valid member sample bookmark key. Pass
 * `{ allowJsonExtension: true }` only at the native document filename boundary.
 */
export function parseMemberSampleBookmarksStorageKey(
  storageKey: string,
  options?: { allowJsonExtension?: boolean }
): string | null {
  const normalized =
    options?.allowJsonExtension && storageKey.endsWith('.json')
      ? storageKey.slice(0, -5)
      : storageKey
  if (!normalized.startsWith(MEMBER_SAMPLE_BOOKMARKS_PREFIX)) return null
  const suffix = normalized.slice(MEMBER_SAMPLE_BOOKMARKS_PREFIX.length)
  if (!suffix || suffix.length > 256 || suffix.includes('\u0000')) return null
  try {
    return decodeURIComponent(suffix)
  } catch {
    return suffix
  }
}

function isValidStylePieceScopeTuple(parsed: unknown): parsed is [string, string] {
  if (!Array.isArray(parsed) || parsed.length !== 2) return false
  const [owner, garmentId] = parsed as [unknown, unknown]
  return (
    typeof owner === 'string' &&
    owner.length > 0 &&
    !owner.includes('\u0000') &&
    typeof garmentId === 'string' &&
    garmentId.length > 0 &&
    garmentId.length <= 128 &&
    !garmentId.includes('\u0000')
  )
}

/**
 * Decodes a `couturecast.style-piece.<scope>` storage key into `{ owner, garmentId }`.
 * Verifies canonical round-trip via `stylePieceStorageKey(owner, garmentId)` so malformed
 * or ambiguous keys are never read, imported, or deleted. Pass `{ allowJsonExtension: true }`
 * only at the native document filename boundary.
 */
export function parseStylePieceStorageKey(
  storageKey: string,
  options?: { allowJsonExtension?: boolean }
): { owner: string; garmentId: string } | null {
  const normalized =
    options?.allowJsonExtension && storageKey.endsWith('.json')
      ? storageKey.slice(0, -5)
      : storageKey
  if (!normalized.startsWith(STYLE_PIECE_STORAGE_PREFIX)) return null
  const scope = normalized.slice(STYLE_PIECE_STORAGE_PREFIX.length)
  if (!scope || scope.length > 512) return null
  try {
    const decoded = decodeURIComponent(scope.replaceAll('~', '%'))
    const parsed = JSON.parse(decoded) as unknown
    if (!isValidStylePieceScopeTuple(parsed)) return null
    const [owner, garmentId] = parsed
    if (stylePieceStorageKey(owner, garmentId) !== normalized) {
      return null
    }
    return { owner, garmentId }
  } catch {
    return null
  }
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

function doesStylePieceLookResolve(
  input: {
    lookId: string
    weather: string
    anchorCategory?: SampleGarmentCategory | null
    anchorComfortRange?: ComfortRange | null
  },
  swaps: Partial<Record<SampleGarmentCategory, string>>,
  catalog: SampleCatalog
): boolean {
  if (
    !input.anchorCategory ||
    !input.anchorComfortRange ||
    !STYLE_PIECE_WEATHER_SET.has(input.weather)
  ) {
    return false
  }
  const { looks } = stylePieceLooks(
    { category: input.anchorCategory, comfortRange: input.anchorComfortRange },
    input.weather as StylePieceWeatherKey,
    catalog
  )
  const base = looks.find((entry) => entry.recipe.lookId === input.lookId)
  if (!base) return false

  for (const [category, swapId] of Object.entries(swaps)) {
    const cat = category as SampleGarmentCategory
    const baseCompanion = base.companions.find((item) => item.category === cat)
    if (!baseCompanion) return false
    if (baseCompanion.id === swapId) continue
    const allowed = stylePieceSwapOptions(base, cat, catalog).some(
      (candidate) => candidate.id === swapId
    )
    if (!allowed) return false
  }
  return true
}

function doesHomeSampleLookResolve(
  input: {
    lookId: string
    weather: string
    collection?: string | null
    comfort?: SavedLookComfortPayload | null
  },
  swaps: Partial<Record<SampleGarmentCategory, string>>,
  catalog: SampleCatalog
): boolean {
  if (
    !SAMPLE_WEATHER_SET.has(input.weather) ||
    !input.collection ||
    !SAMPLE_COLLECTION_SET.has(input.collection) ||
    !input.comfort
  ) {
    return false
  }

  const bookmark: SampleBookmark = {
    lookId: input.lookId,
    weather: input.weather as GuestSampleWeatherKey,
    collection: input.collection as SampleCollectionFilter,
    comfort: {
      runsColdWarm: input.comfort.runsColdWarm,
      windTolerance: input.comfort.windTolerance,
      precipPreparedness: input.comfort.precipPreparedness,
    },
    swaps,
  }
  const result = selectSampleOutfit(
    openSampleBookmark(bookmark, { votes: {}, swaps: {} }),
    catalog
  )
  return (
    result.look?.id === input.lookId &&
    !result.explanation.some((item) => item.key === 'swap-ignored') &&
    Object.entries(swaps).every(([category, swapId]) =>
      result.garments.some(
        (garment) => garment.category === category && garment.id === swapId
      )
    )
  )
}

/**
 * Checks whether a saved look (`style_piece` or `home_sample`) still resolves cleanly
 * against the live anchor garment tags and current sample catalog rules.
 * Non-catalog synthetic look IDs (e.g. unit-test fixtures like `look-01`) return `true`.
 */
export function doesSavedLookResolve(
  input: {
    source: SavedLookSourceKind
    lookId: string
    weather: string
    anchorCategory?: SampleGarmentCategory | null
    anchorComfortRange?: ComfortRange | null
    swaps?: Readonly<Partial<Record<SampleGarmentCategory, string>>> | null
    collection?: string | null
    comfort?: SavedLookComfortPayload | null
    composition?: readonly Pick<
      SavedLookCompositionSlotPayload,
      'category' | 'kind' | 'itemId'
    >[]
  },
  catalog: SampleCatalog = SAMPLE_CATALOG
): boolean {
  if (input.source === 'today') return true
  if (!SAMPLE_LOOK_ID_PATTERN.test(input.lookId)) {
    return true
  }
  const swaps = cleanSwaps(input.swaps ?? undefined)
  if (input.source === 'style_piece') {
    return doesStylePieceLookResolve(input, swaps, catalog)
  }
  if (!input.comfort && input.composition) {
    // A first-run save stores the exact pieces without carrying account preferences.
    return (
      catalog.looks.some((look) => look.id === input.lookId) &&
      input.composition.length > 0 &&
      input.composition.every(
        (slot) =>
          slot.kind === 'catalog' &&
          catalog.garments.some(
            (item) => item.id === slot.itemId && item.category === slot.category
          )
      )
    )
  }
  return doesHomeSampleLookResolve(input, swaps, catalog)
}

function buildFallbackHomeSampleComposition(
  bookmark: SampleBookmark,
  result: SampleOutfitResult,
  catalog: SampleCatalog
): SavedLookCompositionSlotPayload[] {
  const catalogGarments = new Map(catalog.garments.map((item) => [item.id, item]))
  const byCategory = new Map<SampleGarmentCategory, string>()
  const catalogLook = catalog.looks.find((look) => look.id === bookmark.lookId)
  const seedGarments = catalogLook
    ? catalogLook.core.map((id) => catalogGarments.get(id)!)
    : result.garments

  for (const garment of seedGarments) {
    byCategory.set(garment.category, garment.id)
  }

  for (const [category, swapId] of Object.entries(cleanSwaps(bookmark.swaps)) as [
    SampleGarmentCategory,
    string,
  ][]) {
    byCategory.set(category, swapId)
  }

  const orderedCategories = HOME_SAMPLE_DISPLAY_ORDER.filter((category) =>
    byCategory.has(category)
  )

  if (orderedCategories.length === 0 && catalog.garments[0]) {
    return [
      {
        slotIndex: 0,
        category: catalog.garments[0].category,
        kind: 'catalog' as const,
        itemId: catalog.garments[0].id,
      },
    ]
  }

  return orderedCategories.map((category, index) => ({
    slotIndex: index,
    category,
    kind: 'catalog' as const,
    itemId: byCategory.get(category)!,
  }))
}

/**
 * Parses a member's legacy `couturecast.member-sample-bookmarks.<owner>` JSON payload for
 * account import. Valid legacy records that no longer resolve against current catalog rules
 * are preserved (with `resolvesCleanly: false`) so they import into `"Needs review"`.
 */
export function parseLegacyHomeSampleBookmarksForImport(
  raw: string | null,
  owner: string,
  catalog: SampleCatalog = SAMPLE_CATALOG
): {
  entries: LegacySavedLookImportEntry<SampleBookmark>[]
  hadInvalidEntries: boolean
  malformedPayload: boolean
} {
  if (raw === null) {
    return { entries: [], hadInvalidEntries: false, malformedPayload: false }
  }
  if (raw.length === 0 || raw.length > MAX_SAMPLE_BOOKMARK_BYTES) {
    return { entries: [], hadInvalidEntries: true, malformedPayload: true }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { entries: [], hadInvalidEntries: true, malformedPayload: true }
  }

  if (!Array.isArray(parsedJson)) {
    return { entries: [], hadInvalidEntries: true, malformedPayload: true }
  }

  let hadInvalidEntries = false
  const seenLookIds = new Set<string>()
  const entries: LegacySavedLookImportEntry<SampleBookmark>[] = []

  for (const candidate of parsedJson) {
    if (entries.length >= MAX_LEGACY_IMPORT_ITEMS) {
      hadInvalidEntries = true
      break
    }
    const parsedBookmark = legacySampleBookmarkSchema.safeParse(candidate)
    if (!parsedBookmark.success) {
      hadInvalidEntries = true
      continue
    }
    const bookmark = parsedBookmark.data
    if (seenLookIds.has(bookmark.lookId)) {
      hadInvalidEntries = true
      continue
    }
    seenLookIds.add(bookmark.lookId)

    const resolvesCleanly = doesSavedLookResolve(
      {
        source: 'home_sample',
        lookId: bookmark.lookId,
        weather: bookmark.weather,
        swaps: bookmark.swaps,
        collection: bookmark.collection,
        comfort: bookmark.comfort,
      },
      catalog
    )
    const result = selectSampleOutfit(
      openSampleBookmark(bookmark, { votes: {}, swaps: {} }),
      catalog
    )
    const cleanedSwaps = cleanSwaps(bookmark.swaps)
    const payload: CreateSavedLookPayload = resolvesCleanly
      ? {
          ...buildHomeSampleSavedLookInput(result)!,
          swaps: cleanedSwaps,
        }
      : {
          source: 'home_sample',
          lookId: bookmark.lookId,
          weather: bookmark.weather,
          collection: bookmark.collection,
          comfort: {
            runsColdWarm: bookmark.comfort.runsColdWarm,
            windTolerance: bookmark.comfort.windTolerance,
            precipPreparedness: bookmark.comfort.precipPreparedness,
          },
          composition: buildFallbackHomeSampleComposition(bookmark, result, catalog),
          swaps: cleanedSwaps,
        }

    const sourceId = `home_sample:${owner}:${bookmark.lookId}`
    const idempotencyKey = createDeterministicIdempotencyKey(
      `legacy-import:v1:${sourceId}`
    )

    entries.push({
      sourceId,
      idempotencyKey,
      payload,
      rawEntry: bookmark,
      resolvesCleanly,
    })
  }

  return { entries, hadInvalidEntries, malformedPayload: false }
}

function findCompatibleStylePieceAnchor(
  recipe: StylePieceRecipe,
  currentAnchor: StylePieceAnchor | null | undefined,
  catalog: SampleCatalog
): { anchor: StylePieceAnchor; base: StylePieceLook } | null {
  const candidates: StylePieceAnchor[] = []
  if (currentAnchor) {
    for (const comfortRange of COMFORT_RANGES) {
      candidates.push({ category: currentAnchor.category, comfortRange })
    }
    for (const category of SAMPLE_GARMENT_CATEGORIES) {
      if (category !== currentAnchor.category) {
        candidates.push({ category, comfortRange: currentAnchor.comfortRange })
      }
    }
  }
  for (const category of SAMPLE_GARMENT_CATEGORIES) {
    for (const comfortRange of COMFORT_RANGES) {
      candidates.push({ category, comfortRange })
    }
  }

  const checked = new Set<string>()
  for (const anchor of candidates) {
    const key = `${anchor.category}:${anchor.comfortRange}`
    if (checked.has(key)) continue
    checked.add(key)
    const { looks } = stylePieceLooks(anchor, recipe.weather, catalog)
    const base = looks.find((entry) => entry.recipe.lookId === recipe.lookId)
    if (base) {
      return { anchor, base }
    }
  }
  return null
}

function buildFallbackStylePieceCompanions(
  recipe: StylePieceRecipe,
  slotZeroCategory: SampleGarmentCategory,
  base: StylePieceLook | undefined,
  catalog: SampleCatalog
): { category: SampleGarmentCategory; id: string }[] {
  const cleanedSwaps = cleanSwaps(recipe.swaps)
  const catalogGarments = new Map(catalog.garments.map((item) => [item.id, item]))
  const catalogLook = catalog.looks.find((look) => look.id === recipe.lookId)
  const seedCompanions =
    base?.companions ?? (catalogLook?.core ?? []).map((id) => catalogGarments.get(id)!)
  const companions = seedCompanions
    .filter((item) => item.category !== slotZeroCategory)
    .map((item) => ({
      category: item.category,
      id: cleanedSwaps[item.category] ?? item.id,
    }))

  for (const [category, swapId] of Object.entries(cleanedSwaps) as [
    SampleGarmentCategory,
    string,
  ][]) {
    if (
      category !== slotZeroCategory &&
      !companions.some((item) => item.category === category)
    ) {
      companions.push({ category, id: swapId })
    }
  }

  if (companions.length === 0) {
    const fallback = catalog.garments.find((item) => item.category !== slotZeroCategory)!
    companions.push({ category: fallback.category, id: fallback.id })
  }

  return companions.slice(0, 11)
}

function buildLegacyStylePieceImportPayload(params: {
  recipe: StylePieceRecipe
  garmentId: string
  cleanedSwaps: Partial<Record<SampleGarmentCategory, string>>
  currentAnchor: StylePieceAnchor | null | undefined
  resolvesCleanly: boolean
  catalog: SampleCatalog
}): CreateSavedLookPayload {
  const { recipe, garmentId, cleanedSwaps, currentAnchor, resolvesCleanly, catalog } =
    params
  if (resolvesCleanly && currentAnchor) {
    const currentBase = stylePieceLooks(
      currentAnchor,
      recipe.weather,
      catalog
    ).looks.find((entry) => entry.recipe.lookId === recipe.lookId)!
    const companions = currentBase.companions.map((companion) => {
      const swapId = cleanedSwaps[companion.category]
      return swapId ? { ...companion, id: swapId } : companion
    })
    return buildStylePieceSavedLookInput(
      {
        id: garmentId,
        category: currentAnchor.category,
        comfortRange: currentAnchor.comfortRange,
      },
      {
        recipe: { ...currentBase.recipe, swaps: cleanedSwaps },
        companions,
      }
    )
  }

  const currentBase = currentAnchor
    ? stylePieceLooks(currentAnchor, recipe.weather, catalog).looks.find(
        (entry) => entry.recipe.lookId === recipe.lookId
      )
    : undefined
  const compatible = currentBase
    ? { anchor: currentAnchor!, base: currentBase }
    : findCompatibleStylePieceAnchor(recipe, currentAnchor, catalog)
  const snapshotAnchor: StylePieceAnchor = compatible?.anchor ??
    currentAnchor ?? {
      category: 'top',
      comfortRange: 'mild',
    }
  const slotZeroCategory = currentAnchor?.category ?? snapshotAnchor.category
  const companions = buildFallbackStylePieceCompanions(
    recipe,
    slotZeroCategory,
    compatible?.base,
    catalog
  )
  return {
    source: 'style_piece',
    lookId: recipe.lookId,
    weather: recipe.weather,
    anchorGarmentId: garmentId,
    anchorSnapshot: {
      garmentId,
      category: snapshotAnchor.category,
      comfortRange: snapshotAnchor.comfortRange,
    },
    composition: [
      {
        slotIndex: 0,
        category: slotZeroCategory,
        kind: 'garment',
        itemId: garmentId,
      },
      ...companions.map((companion, index) => ({
        slotIndex: index + 1,
        category: companion.category,
        kind: 'catalog' as const,
        itemId: companion.id,
      })),
    ],
    swaps: cleanedSwaps,
  }
}

/**
 * Parses a member's legacy `couturecast.style-piece.<scope>` JSON payload for account import.
 * Valid legacy recipes that no longer resolve against `currentAnchor` or current catalog rules
 * are preserved (with `resolvesCleanly: false`) so they import into `"Needs review"`.
 */
export function parseLegacyStylePieceRecipesForImport(
  raw: string | null,
  owner: string,
  garmentId: string,
  currentAnchor?: StylePieceAnchor | null,
  catalog: SampleCatalog = SAMPLE_CATALOG
): {
  entries: LegacySavedLookImportEntry<StylePieceRecipe>[]
  hadInvalidEntries: boolean
  malformedPayload: boolean
} {
  if (raw === null) {
    return { entries: [], hadInvalidEntries: false, malformedPayload: false }
  }
  if (raw.length === 0 || raw.length > MAX_STYLE_PIECE_STORAGE_BYTES) {
    return { entries: [], hadInvalidEntries: true, malformedPayload: true }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { entries: [], hadInvalidEntries: true, malformedPayload: true }
  }

  if (!Array.isArray(parsedJson)) {
    return { entries: [], hadInvalidEntries: true, malformedPayload: true }
  }

  let hadInvalidEntries = false
  const seenRecipeKeys = new Set<string>()
  const entries: LegacySavedLookImportEntry<StylePieceRecipe>[] = []

  for (const candidate of parsedJson) {
    if (entries.length >= MAX_LEGACY_IMPORT_ITEMS) {
      hadInvalidEntries = true
      break
    }
    const parsedRecipe = legacyStylePieceRecipeSchema.safeParse(candidate)
    if (!parsedRecipe.success) {
      hadInvalidEntries = true
      continue
    }
    const recipe = parsedRecipe.data
    const recipeKey = stylePieceRecipeKey(recipe)
    if (seenRecipeKeys.has(recipeKey)) {
      hadInvalidEntries = true
      continue
    }
    seenRecipeKeys.add(recipeKey)

    const cleanedSwaps = cleanSwaps(recipe.swaps)
    const resolvesCleanly = Boolean(
      currentAnchor &&
        doesSavedLookResolve(
          {
            source: 'style_piece',
            lookId: recipe.lookId,
            weather: recipe.weather,
            anchorCategory: currentAnchor.category,
            anchorComfortRange: currentAnchor.comfortRange,
            swaps: cleanedSwaps,
          },
          catalog
        )
    )

    const payload = buildLegacyStylePieceImportPayload({
      recipe,
      garmentId,
      cleanedSwaps,
      currentAnchor,
      resolvesCleanly,
      catalog,
    })

    const sourceId = `style_piece:${owner}:${garmentId}:${recipeKey}`
    const idempotencyKey = createDeterministicIdempotencyKey(
      `legacy-import:v1:${sourceId}`
    )

    entries.push({
      sourceId,
      idempotencyKey,
      payload,
      rawEntry: recipe,
      resolvesCleanly,
    })
  }

  return { entries, hadInvalidEntries, malformedPayload: false }
}

function stylePieceComposition(
  garment: Pick<StylePieceSelection, 'id' | 'category'>,
  look: StylePieceLook
): SavedLookCompositionSlotPayload[] {
  return [
    {
      slotIndex: 0,
      category: garment.category,
      kind: 'garment',
      itemId: garment.id,
    },
    ...look.companions.map((companion, index) => ({
      slotIndex: index + 1,
      category: companion.category,
      kind: isStylePieceOwnedCompanion(companion)
        ? ('garment' as const)
        : ('catalog' as const),
      itemId: companion.id,
    })),
  ]
}

function sameOrderedComposition(
  stored: readonly SavedLookCompositionSlotPayload[],
  expected: readonly SavedLookCompositionSlotPayload[]
) {
  const ordered = [...stored].sort((a, b) => a.slotIndex - b.slotIndex)
  return (
    ordered.length === expected.length &&
    expected.every((slot, index) => {
      const previous = ordered[index]
      return (
        previous?.slotIndex === slot.slotIndex &&
        previous.kind === slot.kind &&
        previous.category === slot.category &&
        previous.itemId === slot.itemId
      )
    })
  )
}

/** Builds the saved payload with the anchor followed by companions in display order. */
export function buildStylePieceSavedLookInput(
  garment: StylePieceSelection,
  look: StylePieceLook
): CreateSavedLookPayload {
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
    composition: stylePieceComposition(garment, look),
    swaps: cleanSwaps(
      Object.fromEntries(
        look.companions.flatMap((companion) =>
          !isStylePieceOwnedCompanion(companion) &&
          look.recipe.swaps[companion.category] === companion.id
            ? [[companion.category, companion.id]]
            : []
        )
      )
    ),
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

type StylePieceEditorSavedLook = SavedLookLike & {
  availabilityStatus: string
  composition: readonly SavedLookCompositionSlotPayload[]
}

export function savedStylePieceEditorRecipe(
  saved: StylePieceEditorSavedLook
): StylePieceRecipe | null {
  const recipe = savedLookToStylePieceRecipe(saved)
  if (!recipe) return null
  return {
    ...recipe,
    swaps: {},
    savedCompanions: Object.fromEntries(
      saved.composition
        .filter((slot) => slot.slotIndex !== 0)
        .map(({ category, kind, itemId }) => [category, { kind, itemId }])
    ),
  }
}

/** Confirm the editor can restore the saved slots in order with the current inventory. */
export function reopenStylePieceRecipe(
  saved: StylePieceEditorSavedLook,
  anchor: StylePieceSelection,
  owned: readonly StylePieceOwnedCompanion[]
): StylePieceRecipe | null {
  if (saved.availabilityStatus !== 'ready' || saved.anchorGarmentId !== anchor.id)
    return null
  const recipe = savedStylePieceEditorRecipe(saved)
  if (!recipe) return null
  const base = stylePieceLooks(anchor, recipe.weather).looks.find(
    (look) => look.recipe.lookId === recipe.lookId
  )
  if (!base) return null
  const restored = applyStylePieceRecipe(base, recipe, SAMPLE_CATALOG, owned)
  return sameOrderedComposition(
    saved.composition,
    stylePieceComposition(anchor, restored)
  )
    ? recipe
    : null
}

export function reopenStylePieceAnchor<
  G extends Parameters<typeof stylePieceOwnedCompanions>[0][number],
>(saved: StylePieceEditorSavedLook, garments: readonly G[]): G | null {
  const garment = garments.find(({ id }) => id === saved.anchorGarmentId)
  if (!garment) return null
  const anchor = stylePieceAnchor(garment)
  if (!anchor) return null
  return reopenStylePieceRecipe(
    saved,
    { ...anchor, id: garment.id },
    stylePieceOwnedCompanions(garments, garment.id)
  )
    ? garment
    : null
}

export function stylePieceLookHasCurrentCompanions(
  look: StylePieceLook,
  owned: readonly StylePieceOwnedCompanion[]
) {
  return look.companions.every(
    (companion) =>
      !isStylePieceOwnedCompanion(companion) ||
      owned.some(
        (item) =>
          item.id === companion.id &&
          item.category === companion.category &&
          stylePieceCompanionSuitsWeather(item, look.recipe.weather)
      )
  )
}

/** Extracts a `SampleBookmark` for reopening a Home sample saved look. */
export function savedLookToSampleBookmark(
  savedLook: SavedLookLike
): SampleBookmark<SampleWeatherKey> | null {
  if (savedLook.source !== 'home_sample' || savedLook.wornOn) return null
  if (!SAMPLE_WEATHER_SET.has(savedLook.weather)) return null
  if (!savedLook.collection || !SAMPLE_COLLECTION_SET.has(savedLook.collection)) {
    return null
  }
  if (!savedLook.comfort) return null
  return {
    lookId: savedLook.lookId,
    weather: savedLook.weather as SampleWeatherKey,
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
  look: StylePieceLook,
  anchorCategory?: SampleGarmentCategory
): boolean {
  if (
    savedLook.source !== 'style_piece' ||
    savedLook.anchorGarmentId !== garmentId ||
    savedLook.lookId !== look.recipe.lookId ||
    savedLook.weather !== look.recipe.weather
  )
    return false
  if (!savedLook.composition) {
    return swapsEqual(cleanSwaps(savedLook.swaps), cleanSwaps(look.recipe.swaps))
  }
  const anchor = savedLook.composition.find((slot) => slot.slotIndex === 0)
  return Boolean(
    anchor &&
      sameOrderedComposition(
        savedLook.composition,
        stylePieceComposition(
          { id: garmentId, category: anchorCategory ?? anchor.category },
          look
        )
      )
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
    !savedLook.wornOn &&
    savedLook.lookId === input.lookId &&
    savedLook.weather === input.weather &&
    savedLook.collection === input.collection &&
    savedLook.comfort?.runsColdWarm === input.comfort?.runsColdWarm &&
    savedLook.comfort?.windTolerance === input.comfort?.windTolerance &&
    savedLook.comfort?.precipPreparedness === input.comfort?.precipPreparedness &&
    swapsEqual(cleanSwaps(savedLook.swaps), input.swaps)
  )
}
