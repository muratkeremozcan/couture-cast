// Story CC-7.12 D1, D5, P10 owner: the native Looks addresses. The segment and filter live in the
// Looks tab params, and a saved look's screen carries the Saved filter it was opened from.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import type { LooksFilter } from '@couture/utils'

/** The Looks Saved address a detail returns to, keeping the filter it was opened from. */
export function savedLooksRoute(filter: LooksFilter = 'all') {
  return { pathname: '/looks' as const, params: { segment: 'saved', filter } }
}

/**
 * A saved look's address. A Saved tile passes the filter it sits under (`all` included), so
 * Remove can go back to that page (TEA T2); View on a save confirmation passes none.
 */
export function savedLookRoute(savedLookId: string, from?: LooksFilter) {
  return {
    pathname: '/saved-look/[savedLookId]' as const,
    params: from === undefined ? { savedLookId } : { savedLookId, from },
  }
}
