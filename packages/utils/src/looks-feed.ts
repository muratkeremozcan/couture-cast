// Story CC-7.12 D3 owner: one newest-first feed of saved looks and capsules for the Looks tab.
// Both lists page from the API in `sort=created_desc` order; this merge decides which loaded
// items are safe to show (no unloaded item can sort before them) and which list to read next.
// Web and native share it so both apps agree on the order.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { SAMPLE_CATALOG } from './sample-wardrobe/catalog'
import { createMemberSampleOutfit } from './sample-wardrobe/member-outfit'
import { selectSampleOutfit } from './sample-wardrobe/selector'
import { activeStyleDay, type StyleSampleInputs } from './sample-wardrobe/style-profile'
import type { SampleGarment, SampleLook } from './sample-wardrobe/types'

/** The fields the merge reads from a saved look or a capsule. */
export interface LooksFeedRecord {
  readonly id: string
  /** ISO timestamp. */
  readonly createdAt: string
}

/** One paged list, loaded from offset 0 in server order. */
export interface LooksFeedSource<T extends LooksFeedRecord> {
  readonly items: readonly T[]
  /** The server's total; `items.length < total` means more pages exist. */
  readonly total: number
  /** False until the first page answered; an unread source blocks every item. */
  readonly loaded: boolean
}

export type LooksFeedKind = 'look' | 'capsule'

export type LooksFeedEntry<L extends LooksFeedRecord, C extends LooksFeedRecord> =
  | {
      readonly kind: 'look'
      readonly id: string
      readonly createdAt: string
      readonly item: L
    }
  | {
      readonly kind: 'capsule'
      readonly id: string
      readonly createdAt: string
      readonly item: C
    }

export interface LooksFeedView<L extends LooksFeedRecord, C extends LooksFeedRecord> {
  /** Items in feed order that no unloaded item can precede. */
  readonly entries: readonly LooksFeedEntry<L, C>[]
  /** The list Load more reads next, or null when both lists are complete. */
  readonly next: LooksFeedKind | null
}

/** A source with nothing in it, already complete: for filters that read one list only. */
export const EMPTY_LOOKS_FEED_SOURCE: LooksFeedSource<never> = {
  items: [],
  total: 0,
  loaded: true,
}

const KIND_ORDER: Record<LooksFeedKind, number> = { look: 0, capsule: 1 }

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Feed order: newest `createdAt` first, then saved looks before capsules on a tie (TEA P3), then id ascending.
 * Within one kind this is the server's `created_at desc, id asc`.
 */
export function compareLooksFeedEntries(
  a: { kind: LooksFeedKind; id: string; createdAt: string },
  b: { kind: LooksFeedKind; id: string; createdAt: string }
): number {
  const byTime = time(b.createdAt) - time(a.createdAt)
  if (byTime !== 0) return byTime
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (byKind !== 0) return byKind
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function hasMore(source: LooksFeedSource<LooksFeedRecord>): boolean {
  return !source.loaded || source.items.length < source.total
}

/**
 * Merges both lists. An item shows only when it sorts at or before the last loaded item of
 * every list that still has pages, since an unloaded item of that list sorts after its last
 * loaded one. `next` is the list whose last loaded item limits the view (an unread list first).
 */
export function mergeLooksFeed<L extends LooksFeedRecord, C extends LooksFeedRecord>(
  looks: LooksFeedSource<L>,
  capsules: LooksFeedSource<C>
): LooksFeedView<L, C> {
  const all: LooksFeedEntry<L, C>[] = []
  const seen = new Set<string>()
  for (const item of looks.items) {
    if (seen.has(`look:${item.id}`)) continue
    seen.add(`look:${item.id}`)
    all.push({ kind: 'look', id: item.id, createdAt: item.createdAt, item })
  }
  for (const item of capsules.items) {
    if (seen.has(`capsule:${item.id}`)) continue
    seen.add(`capsule:${item.id}`)
    all.push({ kind: 'capsule', id: item.id, createdAt: item.createdAt, item })
  }
  all.sort(compareLooksFeedEntries)

  type Limit = { kind: LooksFeedKind; last: LooksFeedEntry<L, C> | null }
  const limits: Limit[] = []
  const sources: [LooksFeedKind, LooksFeedSource<LooksFeedRecord>][] = [
    ['look', looks],
    ['capsule', capsules],
  ]
  for (const [kind, source] of sources) {
    if (!hasMore(source)) continue
    const own = all.filter((entry) => entry.kind === kind)
    limits.push({ kind, last: source.loaded ? (own[own.length - 1] ?? null) : null })
  }

  // An unread list, or a list with more pages but none loaded, limits the view to nothing.
  const blocking = limits.find((limit) => limit.last === null)
  if (blocking) return { entries: [], next: blocking.kind }
  if (limits.length === 0) return { entries: all, next: null }

  const tightest = limits.reduce((best, limit) =>
    compareLooksFeedEntries(limit.last!, best.last!) < 0 ? limit : best
  )
  const entries = all.filter(
    (entry) => compareLooksFeedEntries(entry, tightest.last!) <= 0
  )
  return { entries, next: tightest.kind }
}

/** Story CC-7.12 D9: one Ideas tile: a sample look with its garments resolved. */
export interface LooksIdea {
  readonly look: SampleLook
  readonly garments: readonly SampleGarment[]
}

const GARMENTS_BY_ID = new Map(
  SAMPLE_CATALOG.garments.map((garment) => [garment.id, garment])
)

function resolveIdea(look: SampleLook): LooksIdea {
  return {
    look,
    garments: look.core
      .map((id) => GARMENTS_BY_ID.get(id))
      .filter((garment): garment is SampleGarment => garment !== undefined),
  }
}

/** The unchanged catalog order also supplies historical looks and the sample week. */
export function looksIdeas(inputs?: StyleSampleInputs): readonly LooksIdea[] {
  if (!inputs) return SAMPLE_CATALOG.looks.map(resolveIdea)
  const result = createMemberSampleOutfit(undefined, inputs)
  const { avoid, preferences, weather } = result.input
  if (
    !avoid &&
    !preferences &&
    weather === 'mild-dry' &&
    !activeStyleDay(inputs.day)?.temperature
  )
    return SAMPLE_CATALOG.looks.map(resolveIdea)
  return result.eligibleLookIds.flatMap((selectedLookId) => {
    const { look, garments } = selectSampleOutfit(
      { ...result.input, selectedLookId },
      SAMPLE_CATALOG
    )
    return look ? [{ look, garments }] : []
  })
}

/** Story CC-7.12 D10: one row of the free Plan preview's sample week. */
export interface SampleWeekDay {
  /** 0 is the first day shown (today), 6 the last. */
  readonly offset: number
  readonly idea: LooksIdea
}

/** Seven sample days starting today, each with a sample look, the same on web and native. */
export function sampleWeek(): readonly SampleWeekDay[] {
  const ideas = looksIdeas()
  return Array.from({ length: 7 }, (_, offset) => ({
    offset,
    idea: ideas[offset % ideas.length]!,
  }))
}

/** Story CC-7.12 D2: the one state line a Saved tile shows, first match wins. */
export type LooksTileState =
  | { readonly kind: 'missing'; readonly count: number }
  | { readonly kind: 'needsReview' }
  | { readonly kind: 'saved'; readonly createdAt: string }

/** A saved look's state line: missing pieces, then needs review, else its saved date. */
export function savedLookTileState(look: {
  readonly availabilityStatus: 'ready' | 'missing_garment' | 'needs_review'
  readonly missingGarmentIds: readonly string[]
  readonly createdAt: string
}): LooksTileState {
  if (
    look.availabilityStatus === 'missing_garment' ||
    look.missingGarmentIds.length > 0
  ) {
    return { kind: 'missing', count: Math.max(1, look.missingGarmentIds.length) }
  }
  if (look.availabilityStatus === 'needs_review') return { kind: 'needsReview' }
  return { kind: 'saved', createdAt: look.createdAt }
}

/** A capsule's state line: missing pieces, else its saved date. */
export function capsuleTileState(capsule: {
  readonly availabilityStatus: 'ready' | 'needs_repair'
  readonly unavailableGarmentCount: number
  readonly createdAt: string
}): LooksTileState {
  if (
    capsule.availabilityStatus === 'needs_repair' ||
    capsule.unavailableGarmentCount > 0
  ) {
    return { kind: 'missing', count: Math.max(1, capsule.unavailableGarmentCount) }
  }
  return { kind: 'saved', createdAt: capsule.createdAt }
}

/** The address segments and filters of the Looks tab (D1, D4). */
export const LOOKS_SEGMENTS = ['saved', 'ideas', 'plan'] as const
export type LooksSegment = (typeof LOOKS_SEGMENTS)[number]
export const LOOKS_FILTERS = ['all', 'today', 'capsules'] as const
export type LooksFilter = (typeof LOOKS_FILTERS)[number]

export function parseLooksSegment(value: unknown): LooksSegment | null {
  return typeof value === 'string' &&
    (LOOKS_SEGMENTS as readonly string[]).includes(value)
    ? (value as LooksSegment)
    : null
}

export function parseLooksFilter(value: unknown): LooksFilter {
  return typeof value === 'string' && (LOOKS_FILTERS as readonly string[]).includes(value)
    ? (value as LooksFilter)
    : 'all'
}
