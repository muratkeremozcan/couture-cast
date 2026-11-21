import { z } from 'zod'
import {
  SAMPLE_COLLECTION_FILTERS,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_LOOK_ID_PATTERN,
  type SampleCatalog,
  type SampleGarmentCategory,
} from './types'
import {
  SAMPLE_WEATHER_KEYS,
  selectSampleOutfit,
  type SampleOutfitResult,
  type SampleSelectionInput,
} from './selector'

const MAX_SAMPLE_BOOKMARKS = 8
export const MAX_SAMPLE_BOOKMARK_BYTES = 8 * 1024
const tolerance = z.enum(['low', 'medium', 'high'])
const sampleBookmarkSchema = z
  .object({
    lookId: z.string().regex(SAMPLE_LOOK_ID_PATTERN),
    weather: z.enum(SAMPLE_WEATHER_KEYS),
    collection: z.enum(SAMPLE_COLLECTION_FILTERS),
    comfort: z
      .object({
        runsColdWarm: z.enum(['cold', 'neutral', 'warm']),
        windTolerance: tolerance,
        precipPreparedness: tolerance,
      })
      .strict(),
    swaps: z.partialRecord(z.enum(SAMPLE_GARMENT_CATEGORIES), z.string().max(64)),
  })
  .strict()

export const sampleBookmarksSchema = z
  .array(sampleBookmarkSchema)
  .max(MAX_SAMPLE_BOOKMARKS)
export type SampleBookmark = z.infer<typeof sampleBookmarkSchema>

export function parseSampleBookmarks(
  raw: string | null,
  catalog: SampleCatalog
): SampleBookmark[] {
  if (!raw || raw.length > MAX_SAMPLE_BOOKMARK_BYTES) return []
  try {
    const parsed = sampleBookmarksSchema.safeParse(JSON.parse(raw))
    return parsed.success ? keepSampleBookmarks(parsed.data, catalog) : []
  } catch {
    return []
  }
}

export function keepSampleBookmarks(bookmarks: SampleBookmark[], catalog: SampleCatalog) {
  const seen = new Set<string>()
  return bookmarks.flatMap((bookmark) => {
    if (seen.has(bookmark.lookId)) return []
    const result = selectSampleOutfit(
      openSampleBookmark(bookmark, { votes: {}, swaps: {} }),
      catalog
    )
    if (result.look?.id !== bookmark.lookId) return []
    seen.add(bookmark.lookId)
    const swaps: Partial<Record<SampleGarmentCategory, string>> = {}
    for (const garment of result.garments) {
      if (bookmark.swaps[garment.category] === garment.id)
        swaps[garment.category] = garment.id
    }
    return [{ ...bookmark, swaps }]
  })
}

export function saveSampleBookmark(
  bookmarks: SampleBookmark[],
  result: SampleOutfitResult
): SampleBookmark[] {
  const lookId = result.look?.id
  if (!lookId) return bookmarks
  const { weather, collection, comfort } = result.input
  const bookmarkWeather = sampleBookmarkSchema.shape.weather.safeParse(weather)
  if (!bookmarkWeather.success) return bookmarks
  const swaps: SampleBookmark['swaps'] = {}
  for (const garment of result.garments) {
    if (result.input.swaps[lookId]?.[garment.category] === garment.id) {
      swaps[garment.category] = garment.id
    }
  }
  return [
    { lookId, weather: bookmarkWeather.data, collection, comfort, swaps },
    ...bookmarks.filter((bookmark) => bookmark.lookId !== lookId),
  ].slice(0, MAX_SAMPLE_BOOKMARKS)
}

export function openSampleBookmark(
  bookmark: SampleBookmark,
  input: Pick<SampleSelectionInput, 'votes' | 'swaps'>
) {
  const { lookId, weather, collection, comfort, swaps } = bookmark
  const votes = { ...input.votes }
  if (votes[lookId] === 'dislike') delete votes[lookId]
  return {
    weather,
    collection,
    comfort,
    selectedLookId: lookId,
    votes,
    swaps: { ...input.swaps, [lookId]: swaps },
  }
}
