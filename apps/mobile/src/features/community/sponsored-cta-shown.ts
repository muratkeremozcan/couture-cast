// Story 6.7b owner: the seam between a rendered sponsored block and the screen
// that owns its `affiliate_cta_shown` event. It imports no analytics client, so
// the card and the teaser stay free of PostHog; `sponsored-cta-impressions.tsx`
// provides the tracker.
import { createContext, useContext, useEffect, useRef } from 'react'
import type {
  AffiliateCommunitySurface,
  CommunitySponsorship,
} from '@couture/api-client/contracts/http'

export interface SponsoredCtaImpressionTracker {
  /** Changes on every visit, so a block still on screen is counted again. */
  visit: number
  report: (
    surface: AffiliateCommunitySurface,
    postId: string,
    sponsorship: CommunitySponsorship
  ) => void
}

export const SponsoredCtaImpressionContext =
  createContext<SponsoredCtaImpressionTracker | null>(null)

/**
 * Reports a rendered sponsored block to the screen's tracker; `null` (no block)
 * reports nothing, and so does a tree with no tracker or an unfocused screen.
 */
export function useSponsoredCtaShown(
  surface: AffiliateCommunitySurface,
  postId: string,
  sponsorship: CommunitySponsorship | null
): void {
  const tracker = useContext(SponsoredCtaImpressionContext)
  const partnerId = sponsorship?.partnerId
  const offerId = sponsorship?.offerId
  const latest = useRef(sponsorship)
  latest.current = sponsorship
  useEffect(() => {
    if (!tracker || !partnerId || !offerId || !latest.current) return
    tracker.report(surface, postId, latest.current)
  }, [tracker, surface, postId, partnerId, offerId])
}
