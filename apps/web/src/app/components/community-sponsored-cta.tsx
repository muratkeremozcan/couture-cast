// Story 6.7b owner: the "Shop this look" CTA a sponsored community post renders
// on a feed card, a spotlight card, the detail dialog and the Home teaser.
//
// Three things about the shape here are load-bearing:
//
// - **It is always a sibling of the host's open action.** A button nested in the
//   card's open button or the teaser's link is invalid interactive content, and
//   a click on it would also open the look. Every host renders it outside.
// - **It renders only from a live response's `sponsorship` block.** The block is
//   never cached or rebuilt from ids, so a link the owner ended disappears on the
//   next read, and the click is re-checked server-side anyway.
// - **Focus stays on the button.** Loading and error are shown beside it and
//   announced once through the host's polite live region; nothing moves focus,
//   so a failed handoff is retried from where the reader already is.
'use client'

import React, { useEffect, useRef, useState } from 'react'
import { trackAffiliateCtaShown } from '@couture/api-client'
import type {
  AffiliateCommunitySurface,
  CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import { browserAnalytics } from '../../analytics/browser-analytics'
import {
  mintAffiliateClickFromWeb,
  beginAffiliatePartnerHandoff,
  resolveAffiliateLocaleRegion,
} from '../../lib/commerce'

const MERLOT = '#7A1F2D'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Blocks already reported as shown during this screen visit. */
export type SponsoredShownRegistry = Set<string>

/**
 * One registry per screen visit, owned by the surface that lives for the visit
 * (the community grid, the Home layout's teaser lifecycle), so a card that
 * re-renders, pages out and back, or opens into the detail dialog reports its
 * block once.
 */
export function useSponsoredShownRegistry(): SponsoredShownRegistry {
  const [registry] = useState<SponsoredShownRegistry>(() => new Set())
  return registry
}

/**
 * `affiliate_cta_shown` for a community block, through the shared builder so the
 * strict community member refuses anything beyond partner, offer, surface and
 * region. No post, author, caption or user id reaches PostHog. Fail-open: an
 * analytics failure never hides the CTA.
 */
function reportShown(
  sponsorship: CommunitySponsorship,
  surface: AffiliateCommunitySurface,
  language: string
): void {
  try {
    const payload = trackAffiliateCtaShown(
      {
        partnerId: sponsorship.partnerId,
        offerId: sponsorship.offerId,
        surface,
        localeRegion: resolveAffiliateLocaleRegion(language),
      },
      browserAnalytics.getDistinctId() || 'web-anonymous-user'
    )
    browserAnalytics.capture(payload.event, payload.properties)
  } catch {
    // Analytics must never block the CTA.
  }
}

export interface CommunitySponsoredCtaProps {
  postId: string
  sponsorship: CommunitySponsorship
  surface: AffiliateCommunitySurface
  /** Prefix for every test id and element id, so two copies of a post never collide. */
  scope: string
  /** The active UI language; its region subtag keys the shown event. */
  language: string
  t: Translate
  shown: SponsoredShownRegistry
  /** Hands one message key to the host's polite live region. */
  announce: (key: string) => void
}

type CtaState = 'idle' | 'loading' | 'error'

const STATUS_KEYS: Record<Exclude<CtaState, 'idle'>, string> = {
  loading: 'commerce.shopThisLook.loading',
  error: 'commerce.shopThisLook.error',
}

export function CommunitySponsoredCta({
  postId,
  sponsorship,
  surface,
  scope,
  language,
  t,
  shown,
  announce,
}: CommunitySponsoredCtaProps) {
  const [state, setState] = useState<CtaState>('idle')
  const stateRef = useRef<CtaState>('idle')
  const mountedRef = useRef(true)
  const languageRef = useRef(language)
  languageRef.current = language
  const announceRef = useRef(announce)
  announceRef.current = announce

  useEffect(() => {
    // The registry decides "once": a re-render that hands over a new copy of
    // the same block finds its key already there.
    const key = `${surface}:${postId}:${sponsorship.partnerId}:${sponsorship.offerId}`
    if (shown.has(key)) return
    shown.add(key)
    reportShown(sponsorship, surface, languageRef.current)
  }, [surface, postId, sponsorship, shown])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const move = (next: CtaState) => {
    stateRef.current = next
    if (!mountedRef.current) return
    setState(next)
    if (next !== 'idle') announceRef.current(STATUS_KEYS[next])
  }

  const activate = async () => {
    // `aria-disabled` keeps the focused button focusable while a mint is in
    // flight; a second press returns here.
    if (stateRef.current === 'loading') return
    // Claimed before the first await, while the press still counts as a user
    // gesture. A blocked tab mints nothing.
    const handoff = beginAffiliatePartnerHandoff()
    if (!handoff) {
      move('error')
      return
    }
    move('loading')
    try {
      const redirectUrl = await mintAffiliateClickFromWeb({
        offerId: sponsorship.offerId,
        // A community surface sends the post id; the server re-checks the live
        // sponsorship link for this post, offer and viewer before minting.
        recommendationId: postId,
        surface,
        platform: 'web',
      })
      // Only a recorded click navigates.
      handoff.navigate(redirectUrl)
      move('idle')
    } catch {
      handoff.cancel()
      move('error')
    }
  }

  const ctaId = `${scope}sponsored-cta-${postId}`
  const opensId = `${ctaId}-opens`
  const statusId = `${ctaId}-status`

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        id={ctaId}
        data-testid={ctaId}
        aria-describedby={state === 'idle' ? opensId : `${opensId} ${statusId}`}
        aria-disabled={state === 'loading' ? 'true' : undefined}
        aria-busy={state === 'loading' ? 'true' : undefined}
        onClick={() => {
          void activate()
        }}
        className="min-h-[44px] rounded-full bg-[#C9A14A] px-5 py-2 text-xs font-semibold text-[#111111] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--theme-secondary,#111111)] motion-safe:transition-colors aria-disabled:cursor-progress aria-disabled:opacity-80"
      >
        {t('community.card.shopCta', { partner: sponsorship.partnerDisplayName })}
      </button>
      <span
        id={opensId}
        data-testid={`${ctaId}-opens`}
        className="text-[10px] text-neutral-600"
      >
        {t('community.card.shopOpensInBrowser')}
      </span>
      {state !== 'idle' && (
        <span
          id={statusId}
          data-testid={`${ctaId}-status`}
          data-state={state}
          className="text-xs"
          style={state === 'error' ? { color: MERLOT } : undefined}
        >
          {t(STATUS_KEYS[state])}
        </span>
      )}
    </div>
  )
}
