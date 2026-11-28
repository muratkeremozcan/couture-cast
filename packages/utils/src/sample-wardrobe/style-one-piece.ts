import { z } from 'zod'
import type { ComfortRange } from '../comfort-rules'
import { MAX_SAMPLE_BOOKMARK_BYTES } from './bookmarks'
import { SAMPLE_CATALOG } from './catalog'
import type { GarmentSubtype } from './garment-subtypes'
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
  subtype?: GarmentSubtype | null
}

type WardrobePhoto = { url: string; expiresAt: string }
type StylePieceItem = {
  retentionStatus: string
  imageAccess: WardrobePhoto | null
  status: string
  category: SampleGarmentCategory | null
  comfortRange: ComfortRange | null
  subtype?: GarmentSubtype | null
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
  const { category, comfortRange, subtype, imageAccess: photo } = item
  return photo && Date.parse(photo.expiresAt) > now
    ? { category, comfortRange, ...(subtype && { subtype }), photo }
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

export type StylePieceOwnedCompanion = StylePieceSelection & {
  kind: 'garment'
  photo: WardrobePhoto | null
}

function withoutExpiredCompanionPhotos(
  owned: readonly StylePieceOwnedCompanion[],
  now: number
) {
  return owned.map((item) =>
    item.photo && Date.parse(item.photo.expiresAt) <= now
      ? { ...item, photo: null }
      : item
  )
}

export function stylePieceOwnedCompanions(
  items: readonly InventoryItem[],
  anchorId: string,
  now = Date.now()
): StylePieceOwnedCompanion[] {
  return items.flatMap((item) =>
    item.id !== anchorId && isStylePieceTagged(item)
      ? [
          {
            id: item.id,
            kind: 'garment' as const,
            category: item.category,
            comfortRange: item.comfortRange,
            subtype: item.subtype,
            photo:
              item.imageAccess && Date.parse(item.imageAccess.expiresAt) > now
                ? item.imageAccess
                : null,
          },
        ]
      : []
  )
}

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

export type StylePieceActionRefreshResult =
  | { status: 'ok'; anchor: StylePiecePhotoAnchor }
  | { status: 'revoked' }
  | { status: 'error'; error: unknown }

function isAuthOrDeadlineRevocationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    name?: unknown
    status?: unknown
    message?: unknown
    response?: { status?: unknown }
    cause?: unknown
  }
  if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return true
  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.response?.status === 'number'
        ? candidate.response.status
        : undefined
  if (status === 401 || status === 403) return true
  if (
    typeof candidate.message === 'string' &&
    /\b(401|403|unauthorized|forbidden|session expired|sign in again)\b/i.test(
      candidate.message
    )
  ) {
    return true
  }
  if (candidate.cause && candidate.cause !== error) {
    return isAuthOrDeadlineRevocationError(candidate.cause)
  }
  return false
}

export function createStylePieceRefresh({
  garmentId,
  load,
  isCurrent,
  onAnchor,
}: {
  garmentId: string
  load: (signal: AbortSignal) => Promise<readonly InventoryItem[] | null>
  isCurrent: () => boolean
  onAnchor: (
    anchor: StylePiecePhotoAnchor | null | undefined,
    owned: readonly StylePieceOwnedCompanion[]
  ) => void
}) {
  let stopped = false
  let latest: StylePiecePhotoAnchor | null = null
  let owned: StylePieceOwnedCompanion[] = []
  let interval: ReturnType<typeof setInterval> | undefined
  let cancelExpiry: (() => void) | undefined
  let flight:
    | { controller: AbortController; result: Promise<StylePiecePhotoAnchor | null> }
    | undefined
  let requestSeq = 0
  let latestAuthoritativeSeq = 0
  const actionControllers = new Set<AbortController>()
  const active = () => !stopped && interval !== undefined && isCurrent()

  const currentValidAnchor = () =>
    active() && latest && Date.parse(latest.photo.expiresAt) > Date.now() ? latest : null

  const publishPhotos = () => {
    cancelExpiry?.()
    if (!latest) {
      owned = []
      cancelExpiry = undefined
      onAnchor(null, owned)
      return
    }
    const now = Date.now()
    owned = withoutExpiredCompanionPhotos(owned, now)
    const expiresAt = owned.reduce(
      (expiry, item) =>
        item.photo ? Math.min(expiry, Date.parse(item.photo.expiresAt)) : expiry,
      Date.parse(latest.photo.expiresAt)
    )
    cancelExpiry = scheduleStylePiecePhotoExpiry(expiresAt, () => {
      if (!active()) return
      if (currentValidAnchor()) publishPhotos()
      else publish(null)
    })
    onAnchor(latest, owned)
  }

  const publish = (
    anchor: StylePiecePhotoAnchor | null,
    seq?: number,
    items: readonly InventoryItem[] = []
  ) => {
    if (seq !== undefined) {
      if (seq < latestAuthoritativeSeq) return
      latestAuthoritativeSeq = seq
    } else {
      latestAuthoritativeSeq = ++requestSeq
    }
    latest = anchor
    owned = anchor ? stylePieceOwnedCompanions(items, garmentId) : []
    publishPhotos()
  }

  const refresh = () => {
    if (!active()) return Promise.resolve(null)
    if (flight) return flight.result
    const seq = ++requestSeq
    const controller = new AbortController()
    const valid = () => !controller.signal.aborted && active()
    const result = Promise.resolve()
      .then(async () => {
        try {
          if (!valid()) return null
          const items = await load(controller.signal)
          if (!valid()) return null
          if (seq < latestAuthoritativeSeq) return currentValidAnchor()
          const anchor = items ? selectStylePieceAnchor(items, garmentId) : null
          publish(anchor, seq, items ?? [])
          return anchor
        } catch {
          if (valid() && seq >= latestAuthoritativeSeq) publish(null, seq)
          return null
        }
      })
      .finally(() => {
        if (flight?.controller === controller) flight = undefined
      })
    flight = { controller, result }
    return result
  }

  const refreshForAction = async (): Promise<StylePieceActionRefreshResult> => {
    if (!active()) return { status: 'revoked' }
    if (!currentValidAnchor()) {
      publish(null)
      return { status: 'revoked' }
    }
    const seq = ++requestSeq
    const controller = new AbortController()
    actionControllers.add(controller)
    const valid = () => !controller.signal.aborted && active()
    try {
      const items = await load(controller.signal)
      if (!valid()) return { status: 'revoked' }
      if (seq < latestAuthoritativeSeq) {
        const authoritative = currentValidAnchor()
        return authoritative
          ? { status: 'ok', anchor: authoritative }
          : { status: 'revoked' }
      }
      const anchor = items ? selectStylePieceAnchor(items, garmentId) : null
      if (!anchor) {
        publish(null, seq)
        return { status: 'revoked' }
      }
      publish(anchor, seq, items ?? [])
      return { status: 'ok', anchor }
    } catch (error) {
      if (!valid()) return { status: 'revoked' }
      if (seq < latestAuthoritativeSeq) {
        return currentValidAnchor() ? { status: 'error', error } : { status: 'revoked' }
      }
      if (isAuthOrDeadlineRevocationError(error) || !currentValidAnchor()) {
        publish(null, seq)
        return { status: 'revoked' }
      }
      // Transient transport or 5xx error while the anchor is still valid & unexpired:
      // preserve the on-screen look so the caller can show Failed/Retry or Offline.
      return { status: 'error', error }
    } finally {
      actionControllers.delete(controller)
    }
  }

  const pause = () => {
    latestAuthoritativeSeq = ++requestSeq
    clearInterval(interval)
    interval = undefined
    flight?.controller.abort()
    flight = undefined
    for (const controller of actionControllers) controller.abort()
    actionControllers.clear()
    cancelExpiry?.()
    cancelExpiry = undefined
    latest = null
    owned = []
  }

  return {
    refresh,
    refreshForAction,
    currentAnchor() {
      return currentValidAnchor()
    },
    currentCompanions() {
      return currentValidAnchor() ? withoutExpiredCompanionPhotos(owned, Date.now()) : []
    },
    setVisible(visible: boolean) {
      if (stopped || !isCurrent()) return
      if (visible && interval === undefined) {
        interval = setInterval(() => void refresh(), STYLE_PIECE_REFRESH_MS)
        void refresh()
      } else if (!visible && interval !== undefined) {
        pause()
        onAnchor(undefined, [])
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

type StylePieceSavedSlot = { kind: 'garment' | 'catalog'; itemId: string }

export type StylePieceRecipe = z.infer<typeof savedStylePieceRecipeSchema> & {
  savedCompanions?: Readonly<Partial<Record<SampleGarmentCategory, StylePieceSavedSlot>>>
}

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

export type StylePieceCompanion = SampleGarment | StylePieceOwnedCompanion

export function isStylePieceOwnedCompanion(
  item: StylePieceCompanion
): item is StylePieceOwnedCompanion {
  return 'kind' in item
}

export type StylePieceLook = {
  recipe: StylePieceRecipe
  companions: StylePieceCompanion[]
}

type CatalogStylePieceLook = StylePieceLook & { companions: SampleGarment[] }

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
  const matchingItems = new Set(
    catalog.garments
      .filter(
        (garment) =>
          garment.category === anchor.category && garment.subtype === anchor.subtype
      )
      .map(({ id }) => id)
  )
  const matchingLooks = new Set(
    anchor.subtype
      ? catalog.looks
          .filter(
            ({ core, layer }) =>
              core.some((id) => matchingItems.has(id)) ||
              (layer && matchingItems.has(layer))
          )
          .map(({ id }) => id)
      : []
  )
  const eligibleLookIds = [
    ...ranked.eligibleLookIds.filter((id) => matchingLooks.has(id)),
    ...ranked.eligibleLookIds.filter((id) => !matchingLooks.has(id)),
  ]
  const looks: CatalogStylePieceLook[] = eligibleLookIds.map((lookId) => {
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

export function stylePieceCompanionSuitsWeather(
  companion: Pick<StylePieceOwnedCompanion, 'category' | 'comfortRange'>,
  weather: string
) {
  const selected = STYLE_PIECE_WEATHER_KEYS.find((option) => option === weather)
  if (!selected) return false
  const context = buildSampleContext(stylePieceInput(selected))
  return (
    garmentSuitsRange({ comfortRanges: [companion.comfortRange] }, context.range) &&
    (companion.category !== 'outerwear' || (!context.windLayer && !context.rainReady))
  )
}

export function stylePieceCompanionOptions(
  look: StylePieceLook,
  category: SampleGarmentCategory,
  owned: readonly StylePieceOwnedCompanion[],
  catalog = SAMPLE_CATALOG
): StylePieceCompanion[] {
  const current = look.companions.find((item) => item.category === category)
  if (!current) return []
  const weather = look.recipe.weather
  const { range } = buildSampleContext(stylePieceInput(weather))
  const eligible = owned.filter(
    (item) => item.category === category && stylePieceCompanionSuitsWeather(item, weather)
  )
  eligible.sort(
    (a, b) =>
      Number(b.comfortRange === range) - Number(a.comfortRange === range) ||
      Number(Boolean(b.subtype && b.subtype === current.subtype)) -
        Number(Boolean(a.subtype && a.subtype === current.subtype)) ||
      (a.id < b.id ? -1 : Number(a.id > b.id))
  )
  return [...eligible, ...stylePieceSwapOptions(look, category, catalog)]
}

function companionSignature(companions: readonly StylePieceCompanion[]) {
  return companions
    .map(({ id }) => id)
    .sort()
    .join('|')
}

export function applyStylePieceRecipe(
  base: CatalogStylePieceLook,
  recipe: StylePieceRecipe,
  catalog: SampleCatalog,
  owned: readonly StylePieceOwnedCompanion[] = []
): StylePieceLook {
  const swaps: StylePieceRecipe['swaps'] = {}
  const companions = base.companions.map((garment) => {
    const { category } = garment
    const saved = recipe.savedCompanions?.[category]
    const swapId = recipe.swaps[category]
    const options = stylePieceCompanionOptions(base, category, owned, catalog)
    const fallback = saved
      ? (options.find(
          (item) =>
            item.id === saved.itemId &&
            (isStylePieceOwnedCompanion(item) ? 'garment' : 'catalog') === saved.kind
        ) ?? garment)
      : options[0] && isStylePieceOwnedCompanion(options[0])
        ? options[0]
        : garment
    const swap = options.find((item) => item.id === swapId)
    if (
      swap &&
      (swap.id !== fallback.id ||
        isStylePieceOwnedCompanion(swap) !== isStylePieceOwnedCompanion(fallback))
    ) {
      swaps[category] = swap.id
    }
    return swap ?? fallback
  })
  return { recipe: { ...recipe, swaps }, companions }
}

function renderedStylePieceLooks(
  bases: readonly CatalogStylePieceLook[],
  edits: Readonly<Record<string, StylePieceRecipe>>,
  {
    reopenedLookId,
    editedLookId,
    catalog = SAMPLE_CATALOG,
    owned = [],
  }: {
    reopenedLookId?: string
    editedLookId?: string
    catalog?: SampleCatalog
    owned?: readonly StylePieceOwnedCompanion[]
  }
) {
  const reopened = bases.find(({ recipe }) => recipe.lookId === reopenedLookId)
  const ordered = reopened
    ? [reopened, ...bases.filter((look) => look !== reopened)]
    : bases
  const rendered = ordered.map((base) => {
    const edit = edits[base.recipe.lookId]
    const recipe = edit?.weather === base.recipe.weather ? edit : base.recipe
    const look = applyStylePieceRecipe(base, recipe, catalog, owned)
    return { look, signature: companionSignature(look.companions) }
  })
  // The member's last edit owns its combination, even when an earlier idea already had it.
  const latestEdit = rendered.find(
    ({ look }) => look.recipe.lookId === (editedLookId ?? reopenedLookId)
  )
  const seen = new Set<string>()
  const visible: StylePieceLook[] = []
  for (const entry of rendered) {
    if (entry.signature === latestEdit?.signature && entry !== latestEdit) continue
    if (seen.has(entry.signature)) continue
    seen.add(entry.signature)
    visible.push(entry.look)
  }
  return {
    visible,
    rendered: rendered.map(({ look }) => look),
    latestEdit: latestEdit?.look,
  }
}

export function visibleStylePieceLooks(
  bases: readonly CatalogStylePieceLook[],
  edits: Readonly<Record<string, StylePieceRecipe>>,
  options: Parameters<typeof renderedStylePieceLooks>[2] = {}
) {
  const { visible, latestEdit } = renderedStylePieceLooks(bases, edits, options)
  const ideas = visible.slice(0, MAX_IDEAS)
  return latestEdit && !ideas.includes(latestEdit)
    ? [...ideas.slice(0, MAX_IDEAS - 1), latestEdit]
    : ideas
}

const OCCASION_STYLES = {
  school: ['classic', 'cozy', 'active', 'chic'],
  weekend: ['active', 'cozy', 'classic', 'chic'],
  goingOut: ['chic', 'classic', 'cozy', 'active'],
} as const

export type StylePieceOccasion = keyof typeof OCCASION_STYLES
export type StylePieceOccasionLook = StylePieceLook & { occasion: StylePieceOccasion }

function distinctOwnedLook(
  look: StylePieceLook,
  usedSignatures: ReadonlySet<string>,
  owned: readonly StylePieceOwnedCompanion[],
  catalog: SampleCatalog
) {
  const signature = companionSignature(look.companions)
  if (!usedSignatures.has(signature)) return look
  for (const companion of look.companions) {
    if (!isStylePieceOwnedCompanion(companion)) continue
    for (const alternative of stylePieceCompanionOptions(
      look,
      companion.category,
      owned,
      catalog
    )) {
      if (!isStylePieceOwnedCompanion(alternative)) break
      if (alternative.id === companion.id) continue
      const companions = look.companions.map((item) =>
        item === companion ? alternative : item
      )
      if (usedSignatures.has(companionSignature(companions))) continue
      return {
        companions,
        recipe: {
          ...look.recipe,
          swaps: { ...look.recipe.swaps, [companion.category]: alternative.id },
        },
      }
    }
  }
  return null
}

export function stylePieceOccasionLooks(
  bases: readonly CatalogStylePieceLook[],
  edits: Readonly<Record<string, StylePieceRecipe>>,
  options: Parameters<typeof renderedStylePieceLooks>[2] = {}
): StylePieceOccasionLook[] {
  const { visible, rendered, latestEdit } = renderedStylePieceLooks(bases, edits, options)
  const catalog = options.catalog ?? SAMPLE_CATALOG
  const styles = new Map(catalog.looks.map((item) => [item.id, item.preferences?.style]))
  const used = new Set<StylePieceLook>()
  const owned = options.owned ?? []
  const hasOwnedCompanions = rendered.some((look) =>
    look.companions.some(isStylePieceOwnedCompanion)
  )
  const usedSignatures = new Set<string>()
  if (latestEdit) usedSignatures.add(companionSignature(latestEdit.companions))
  const ideas = (Object.keys(OCCASION_STYLES) as StylePieceOccasion[]).flatMap(
    (occasion) => {
      const preference: readonly (string | undefined)[] = OCCASION_STYLES[occasion]
      const rank = (look: StylePieceLook) => {
        const index = preference.indexOf(styles.get(look.recipe.lookId))
        return index === -1 ? preference.length : index
      }
      const sorted = (looks: StylePieceLook[]) =>
        looks.filter((look) => !used.has(look)).sort((a, b) => rank(a) - rank(b))
      const ranked = sorted(rendered)
      for (const source of hasOwnedCompanions ? ranked : sorted(visible)) {
        const locked = source === latestEdit || edits[source.recipe.lookId] !== undefined
        if (
          locked &&
          source !== latestEdit &&
          usedSignatures.has(companionSignature(source.companions))
        )
          continue
        const look = locked
          ? source
          : distinctOwnedLook(source, usedSignatures, owned, catalog)
        if (!look) continue
        used.add(source)
        usedSignatures.add(companionSignature(look.companions))
        return [{ source, look, occasion }]
      }
      // A small closet can have fewer than three different compatible outfits.
      const source =
        ranked.find(
          (look) =>
            companionSignature(look.companions) !==
            (latestEdit && companionSignature(latestEdit.companions))
        ) ?? ranked[0]
      if (!source) return []
      used.add(source)
      usedSignatures.add(companionSignature(source.companions))
      return [{ source, look: source, occasion }]
    }
  )
  if (latestEdit && !used.has(latestEdit) && ideas.length > 0) {
    const last = ideas[ideas.length - 1]!
    last.source = latestEdit
    last.look = latestEdit
  }
  return ideas
    .sort((a, b) => rendered.indexOf(a.source) - rendered.indexOf(b.source))
    .map(({ look, occasion }) => ({ ...look, occasion }))
}

export function stylePieceRecipeKey({ weather, lookId }: StylePieceRecipe) {
  return `${weather}:${lookId}`
}

function keepStylePieceRecipes(
  recipes: readonly StylePieceRecipe[],
  anchor: StylePieceAnchor,
  catalog: SampleCatalog
) {
  const basesByWeather = new Map<StylePieceWeatherKey, CatalogStylePieceLook[]>()
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
