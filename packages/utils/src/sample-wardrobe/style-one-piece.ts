import { z } from 'zod'
import type { ComfortRange } from '../comfort-rules'
import { MAX_SAMPLE_BOOKMARK_BYTES } from './bookmarks'
import { SAMPLE_CATALOG } from './catalog'
import {
  buildSampleContext,
  DEFAULT_SAMPLE_COMFORT,
  garmentSuitsRange,
  sampleSwapCandidates,
  selectSampleOutfit,
  type SampleWeatherKey,
} from './selector'
import {
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_GARMENT_ID_PATTERN,
  SAMPLE_LOOK_ID_PATTERN,
  type SampleCatalog,
  type SampleGarment,
  type SampleGarmentCategory,
} from './types'

export type StylePieceAnchor = {
  category: SampleGarmentCategory
  comfortRange: ComfortRange
}

type WardrobePhoto = { url: string; expiresAt: string }
type StylePieceItem = {
  retentionStatus: string
  imageAccess: WardrobePhoto | null
  status: string
  category: SampleGarmentCategory | null
  comfortRange: ComfortRange | null
}

export function isStylePieceTagged(
  item: StylePieceItem
): item is StylePieceItem & StylePieceAnchor {
  return (
    item.status === 'ready' &&
    item.retentionStatus === 'active' &&
    item.category !== null &&
    item.comfortRange !== null
  )
}

export function stylePieceAnchor(item: StylePieceItem, now = Date.now()) {
  if (!isStylePieceTagged(item)) return null
  const { category, comfortRange, imageAccess: photo } = item
  return photo && Date.parse(photo.expiresAt) > now
    ? { category, comfortRange, photo }
    : null
}

export function nextStylePiecePhotoExpiry(items: readonly StylePieceItem[], now: number) {
  let next = Infinity
  for (const item of items) {
    const anchor = stylePieceAnchor(item, now)
    if (anchor) next = Math.min(next, Date.parse(anchor.photo.expiresAt))
  }
  return next
}

export type StylePiecePhotoAnchor = NonNullable<ReturnType<typeof stylePieceAnchor>>
export type StylePieceSelection = StylePieceAnchor & { id: string }
type InventoryItem = StylePieceItem & { id: string }

export function selectStylePieceAnchor(items: readonly InventoryItem[], id: string) {
  const item = items.find((entry) => entry.id === id)
  return item ? stylePieceAnchor(item) : null
}

export function scheduleStylePiecePhotoExpiry(expiresAt: number, onExpiry: () => void) {
  if (!Number.isFinite(expiresAt)) return
  let timer: ReturnType<typeof setTimeout>
  const schedule = () => {
    timer = setTimeout(
      () => {
        if (Date.now() < expiresAt) schedule()
        else onExpiry()
      },
      Math.min(Math.max(0, expiresAt - Date.now()), 2_147_483_647)
    )
  }
  schedule()
  return () => clearTimeout(timer)
}

const STYLE_PIECE_REFRESH_MS = 60_000

export function createStylePieceRefresh({
  garmentId,
  load,
  isCurrent,
  onAnchor,
}: {
  garmentId: string
  load: (signal: AbortSignal) => Promise<readonly InventoryItem[] | null>
  isCurrent: () => boolean
  onAnchor: (anchor: StylePiecePhotoAnchor | null | undefined) => void
}) {
  let stopped = false
  let latest: StylePiecePhotoAnchor | null = null
  let interval: ReturnType<typeof setInterval> | undefined
  let cancelExpiry: (() => void) | undefined
  let flight:
    | { controller: AbortController; result: Promise<StylePiecePhotoAnchor | null> }
    | undefined
  const active = () => !stopped && interval !== undefined && isCurrent()

  const publish = (anchor: StylePiecePhotoAnchor | null) => {
    latest = anchor
    cancelExpiry?.()
    cancelExpiry = anchor
      ? scheduleStylePiecePhotoExpiry(Date.parse(anchor.photo.expiresAt), () => {
          if (active()) publish(null)
        })
      : undefined
    onAnchor(anchor)
  }

  const refresh = () => {
    if (!active()) return Promise.resolve(null)
    if (flight) return flight.result
    const controller = new AbortController()
    const valid = () => !controller.signal.aborted && active()
    const result = Promise.resolve()
      .then(async () => {
        try {
          if (!valid()) return null
          const items = await load(controller.signal)
          if (!valid()) return null
          const anchor = items ? selectStylePieceAnchor(items, garmentId) : null
          publish(anchor)
          return anchor
        } catch {
          if (valid()) publish(null)
          return null
        }
      })
      .finally(() => {
        if (flight?.controller === controller) flight = undefined
      })
    flight = { controller, result }
    return result
  }

  const pause = () => {
    clearInterval(interval)
    interval = undefined
    flight?.controller.abort()
    flight = undefined
    cancelExpiry?.()
    cancelExpiry = undefined
    latest = null
  }

  return {
    refresh,
    currentAnchor() {
      return active() && latest && Date.parse(latest.photo.expiresAt) > Date.now()
        ? latest
        : null
    },
    setVisible(visible: boolean) {
      if (stopped || !isCurrent()) return
      if (visible && interval === undefined) {
        interval = setInterval(() => void refresh(), STYLE_PIECE_REFRESH_MS)
        void refresh()
      } else if (!visible && interval !== undefined) {
        pause()
        onAnchor(undefined)
      }
    },
    stop() {
      stopped = true
      pause()
    },
  }
}

const MAX_SAVED_LOOKS = 8
const MAX_IDEAS = 3
export const STYLE_PIECE_WEATHER_KEYS = [
  'cool-windy',
  'mild-dry',
  'warm-rainy',
] as const satisfies readonly SampleWeatherKey[]
export type StylePieceWeatherKey = (typeof STYLE_PIECE_WEATHER_KEYS)[number]
export const MAX_STYLE_PIECE_STORAGE_BYTES = MAX_SAMPLE_BOOKMARK_BYTES

const savedStylePieceRecipeSchema = z
  .object({
    lookId: z.string().regex(SAMPLE_LOOK_ID_PATTERN),
    weather: z.enum(STYLE_PIECE_WEATHER_KEYS),
    swaps: z.partialRecord(
      z.enum(SAMPLE_GARMENT_CATEGORIES),
      z.string().regex(SAMPLE_GARMENT_ID_PATTERN)
    ),
  })
  .strict()

export type StylePieceRecipe = z.infer<typeof savedStylePieceRecipeSchema>

function stylePieceInput(weather: StylePieceWeatherKey) {
  return { weather, collection: 'all', comfort: DEFAULT_SAMPLE_COMFORT } as const
}

function isReplaced(slot: SampleGarmentCategory, anchor: SampleGarmentCategory) {
  return slot === anchor || (anchor === 'dress' && (slot === 'top' || slot === 'bottom'))
}

function hasCompleteCore(categories: Set<SampleGarmentCategory>) {
  if (!categories.has('shoes')) return false
  return categories.has('dress')
    ? !categories.has('top') && !categories.has('bottom')
    : categories.has('top') && categories.has('bottom')
}

function projectCatalog(catalog: SampleCatalog, anchor: SampleGarmentCategory) {
  const garments = new Map(catalog.garments.map((garment) => [garment.id, garment]))
  const looks = catalog.looks.flatMap((look) => {
    const categories = new Set<SampleGarmentCategory>([anchor])
    const core = look.core.filter((id) => {
      const garment = garments.get(id)
      if (!garment || isReplaced(garment.category, anchor)) return false
      categories.add(garment.category)
      return true
    })
    if (look.core.some((id) => !garments.has(id)) || !hasCompleteCore(categories))
      return []
    return [{ ...look, core }]
  })
  return { ...catalog, looks }
}

export type StylePieceLook = {
  recipe: StylePieceRecipe
  companions: SampleGarment[]
}

export function stylePieceLooks(
  anchor: StylePieceAnchor,
  weather: StylePieceWeatherKey,
  catalog = SAMPLE_CATALOG
) {
  const input = { ...stylePieceInput(weather), votes: {}, swaps: {} }
  const context = buildSampleContext(input)
  if (anchor.category === 'outerwear' && (context.windLayer || context.rainReady))
    return { reason: 'protection' as const, looks: [] }
  if (!garmentSuitsRange({ comfortRanges: [anchor.comfortRange] }, context.range))
    return { reason: 'comfort' as const, looks: [] }

  const needsSampleLayer =
    anchor.category !== 'outerwear' &&
    (context.coldLayer || context.windLayer || context.rainReady)
  // The sample selector adds the first eligible layer whenever the context calls for one.
  if (
    needsSampleLayer &&
    sampleSwapCandidates(catalog, 'outerwear', input, context).length === 0
  )
    return { reason: 'no-looks' as const, looks: [] }

  const projected = projectCatalog(catalog, anchor.category)
  const ranked = selectSampleOutfit(input, projected)
  const looks: StylePieceLook[] = ranked.eligibleLookIds.map((lookId) => {
    const selected = selectSampleOutfit({ ...input, selectedLookId: lookId }, projected)
    const companions = selected.garments.filter(
      (item) => item.category !== anchor.category
    )
    return { recipe: { lookId, weather, swaps: {} }, companions }
  })
  return { reason: looks.length ? null : ('no-looks' as const), looks }
}

export function initialStylePieceWeather(anchor: StylePieceAnchor): StylePieceWeatherKey {
  const preferred = 'mild-dry'
  const weatherByPreference = [
    preferred,
    ...STYLE_PIECE_WEATHER_KEYS.filter((value) => value !== preferred),
  ] as const
  return (
    weatherByPreference.find(
      (weather) => stylePieceLooks(anchor, weather).looks.length > 0
    ) ?? preferred
  )
}

export function stylePieceSwapOptions(
  look: StylePieceLook,
  category: SampleGarmentCategory,
  catalog = SAMPLE_CATALOG
) {
  if (!look.companions.some((garment) => garment.category === category)) return []
  return sampleSwapCandidates(catalog, category, stylePieceInput(look.recipe.weather))
}

function companionSignature(companions: readonly SampleGarment[]) {
  return companions
    .map(({ id }) => id)
    .sort()
    .join('|')
}

function applyStylePieceRecipe(
  base: StylePieceLook,
  recipe: StylePieceRecipe,
  catalog: SampleCatalog
): StylePieceLook {
  const swaps: StylePieceRecipe['swaps'] = {}
  const companions = base.companions.map((garment) => {
    const { category } = garment
    const id = recipe.swaps[category]
    if (id === undefined || id === garment.id) return garment
    const replacement = stylePieceSwapOptions(base, category, catalog).find(
      (candidate) => candidate.id === id
    )
    if (!replacement) return garment
    swaps[category] = replacement.id
    return replacement
  })
  return { recipe: { ...base.recipe, swaps }, companions }
}

export function visibleStylePieceLooks(
  bases: readonly StylePieceLook[],
  edits: Readonly<Record<string, StylePieceRecipe>>,
  {
    reopenedLookId,
    editedLookId,
    catalog = SAMPLE_CATALOG,
  }: { reopenedLookId?: string; editedLookId?: string; catalog?: SampleCatalog } = {}
) {
  const reopened = bases.find(({ recipe }) => recipe.lookId === reopenedLookId)
  const ordered = reopened
    ? [reopened, ...bases.filter((look) => look !== reopened)]
    : bases
  const rendered = ordered.map((base) => {
    const edit = edits[base.recipe.lookId]
    const look =
      edit?.weather === base.recipe.weather
        ? applyStylePieceRecipe(base, edit, catalog)
        : base
    return { look, signature: companionSignature(look.companions) }
  })
  // The member's last edit owns its combination, even when an earlier idea already had it.
  const latestEdit = rendered.find(({ look }) => look.recipe.lookId === editedLookId)
  const seen = new Set<string>()
  const visible: StylePieceLook[] = []
  for (const entry of rendered) {
    if (entry.signature === latestEdit?.signature && entry !== latestEdit) continue
    if (seen.has(entry.signature)) continue
    seen.add(entry.signature)
    visible.push(entry.look)
  }
  const ideas = visible.slice(0, MAX_IDEAS)
  return latestEdit && !ideas.includes(latestEdit.look)
    ? [...ideas.slice(0, MAX_IDEAS - 1), latestEdit.look]
    : ideas
}

export function stylePieceRecipeKey({ weather, lookId }: StylePieceRecipe) {
  return `${weather}:${lookId}`
}

function keepStylePieceRecipes(
  recipes: readonly StylePieceRecipe[],
  anchor: StylePieceAnchor,
  catalog: SampleCatalog
) {
  const basesByWeather = new Map<StylePieceWeatherKey, StylePieceLook[]>()
  const seen = new Set<string>()
  return recipes.flatMap((recipe) => {
    const key = stylePieceRecipeKey(recipe)
    if (seen.has(key)) return []
    let bases = basesByWeather.get(recipe.weather)
    if (!bases) {
      bases = stylePieceLooks(anchor, recipe.weather, catalog).looks
      basesByWeather.set(recipe.weather, bases)
    }
    const base = bases.find((look) => look.recipe.lookId === recipe.lookId)
    if (!base) return []
    seen.add(key)
    return [applyStylePieceRecipe(base, recipe, catalog)]
  })
}

export function parseStylePieceRecipes(
  raw: string | null,
  anchor: StylePieceAnchor,
  catalog = SAMPLE_CATALOG
) {
  if (!raw || raw.length > MAX_STYLE_PIECE_STORAGE_BYTES) return []
  try {
    const parsed = z.array(z.unknown()).max(MAX_SAVED_LOOKS).safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    const recipes = parsed.data.flatMap((entry) => {
      const result = savedStylePieceRecipeSchema.safeParse(entry)
      return result.success ? [result.data] : []
    })
    return keepStylePieceRecipes(recipes, anchor, catalog)
  } catch {
    return []
  }
}

export function saveStylePieceRecipe(
  saved: readonly StylePieceLook[],
  look: StylePieceLook
) {
  const key = stylePieceRecipeKey(look.recipe)
  return [
    look,
    ...saved.filter(({ recipe }) => stylePieceRecipeKey(recipe) !== key),
  ].slice(0, MAX_SAVED_LOOKS)
}

export function stylePieceStorageKey(owner: string, garmentId: string) {
  // Keep the account and garment tuple unambiguous and safe as a native filename.
  const scope = encodeURIComponent(JSON.stringify([owner, garmentId]))
    .replaceAll('~', '%7E')
    .replaceAll('%', '~')
  return `couturecast.style-piece.${scope}`
}
