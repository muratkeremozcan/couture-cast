'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AffiliateCommunitySurface } from '@couture/api-client/contracts/http'
import { SPOTLIGHT_CARD_SCOPE } from './community-spotlight'

const COMMUNITY_FALLBACK = '[data-share-card-focus-fallback="community"]'

/** The card control, on the surface it came from, that opened a post's detail. */
export function detailOpenerSelector(
  surface: AffiliateCommunitySurface,
  commentsFocus: boolean,
  postId: string
): string {
  const scope = surface === 'community_spotlight' ? SPOTLIGHT_CARD_SCOPE : ''
  const control = commentsFocus ? 'comments-button' : 'lookbook-open'
  return `[data-testid="${scope}${control}-${postId}"]`
}

/**
 * The card control that opened the open detail, by surface and post. Re-verification
 * remounts every card, so closing the detail looks that control up again by id. It
 * belongs to one open detail: it is forgotten whenever no post is open, whatever
 * closed it (the dialog, eviction, sign-out, denial, a comment retire), and is
 * ignored for any post other than the one it was recorded for.
 */
export function useDetailOpener(opened: { id: string } | null) {
  const openedId = opened === null ? null : opened.id
  const [opener, setOpener] = useState<{ postId: string; selector: string } | null>(null)
  useEffect(() => {
    if (openedId === null) setOpener(null)
  }, [openedId])
  const record = useCallback(
    (surface: AffiliateCommunitySurface, commentsFocus: boolean, postId: string) =>
      setOpener({
        postId,
        selector: detailOpenerSelector(surface, commentsFocus, postId),
      }),
    []
  )
  const clear = useCallback(() => setOpener(null), [])
  // That control first; the community section only when its card is gone.
  const restoreFocus =
    opener !== null && opener.postId === openedId
      ? [opener.selector, COMMUNITY_FALLBACK]
      : undefined
  return { restoreFocus, record, clear }
}
