import type { ClimateBand } from './climate-band'

export function communityFeedClimate(
  servedMode: 'auto' | 'all' | ClimateBand | null,
  viewerBand: ClimateBand | null,
  bandResolved: boolean
): ClimateBand | null {
  if (servedMode === 'auto') return bandResolved ? viewerBand : null
  return servedMode === 'all' ? null : servedMode
}

type Look = { id: string; climateBand: ClimateBand | null }

/** Keeps server order within each source, letting eligible ranked copies lead. */
export function mergeCommunityLooks<T extends Look, Ranked extends Look>(
  ranked: readonly Ranked[],
  ordinary: readonly T[],
  climate: ClimateBand | null,
  teaserTarget: string | null
): (T | Ranked)[] {
  const shown = new Map<string, T | Ranked>()
  for (const post of ranked) {
    if (
      (climate === null || post.climateBand === climate || post.id === teaserTarget) &&
      !shown.has(post.id)
    )
      shown.set(post.id, post)
  }
  for (const post of ordinary) {
    if (!shown.has(post.id)) {
      shown.set(post.id, post)
    }
  }
  return [...shown.values()]
}
