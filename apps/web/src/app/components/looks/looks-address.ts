// Story CC-7.12 D1, D5 owner: the Looks addresses. Segment and filter live in the query, and each
// saved look has its own path that remembers the Saved filter it was opened from (TEA P10).
import type { LooksFilter, LooksSegment } from '@couture/utils'

/** The Looks tab on `segment`, with `filter` when Saved is open. */
export function looksHref(segment: LooksSegment, filter: LooksFilter = 'all'): string {
  if (segment !== 'saved') return `/looks?segment=${segment}`
  return filter === 'all'
    ? '/looks?segment=saved'
    : `/looks?segment=saved&filter=${filter}`
}

/** The Saved address a saved look returns to. */
export function savedLooksHref(filter: LooksFilter = 'all'): string {
  return looksHref('saved', filter)
}

/**
 * A saved look's address. A Saved tile passes its filter (`from`, `all` included), so the
 * detail knows it was opened from Looks; View on a save confirmation passes none.
 */
export function savedLookHref(savedLookId: string, from?: LooksFilter): string {
  const path = `/looks/saved/${encodeURIComponent(savedLookId)}`
  return from === undefined ? path : `${path}?from=${from}`
}
