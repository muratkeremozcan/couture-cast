// Story 6.7b owner: the `affiliate_cta_shown` event for sponsored community
// CTAs, once per rendered block per screen visit.
//
// The feed is a virtualized list, so a card mounts again every time it scrolls
// back into view, and the spotlight detail renders a second copy of a module
// card. A per-card ref would count each of those as a new impression. The dedupe
// set therefore lives with the screen, and a new visit (the screen regains
// focus) starts it over.
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
} from '@couture/api-client/contracts/http'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { trackMobileAffiliateCtaShown } from '@/src/analytics/track-events'
import { resolveAffiliateLocaleRegion } from '@/src/lib/commerce'
import {
  SponsoredCtaImpressionContext,
  type SponsoredCtaImpressionTracker,
} from './sponsored-cta-shown'

/**
 * Owns one screen's shown events: one `affiliate_cta_shown` per rendered block
 * per screen visit.
 *
 * A visit starts when the screen gains navigation focus and ends when it loses
 * it. The app going to the background and back (including the round trip
 * through the in-app browser the CTA opens) does not start a new visit. While
 * the screen is unfocused nothing is reported, because a block on a screen the
 * member left is not being shown.
 *
 * Ordering: children report from their own effects, which run before this
 * component's effects in the same commit. So the tracker stays null from the
 * render that sees focus arrive until this component's effect has started the
 * visit with an empty dedupe set; only then do children report, once.
 */
export function SponsoredCtaImpressions({
  focused,
  children,
}: PropsWithChildren<{ focused: boolean }>) {
  const analytics = useMobileAnalytics()
  const { i18n } = useTranslation()
  // The hero's rule, input for input: the UI language's region subtag.
  const activeLocale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  /** The visit in progress, or null between visits. */
  const [visit, setVisit] = useState<number | null>(null)
  const visitCount = useRef(0)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    if (!focused) {
      setVisit(null)
      return
    }
    seen.current = new Set()
    visitCount.current += 1
    setVisit(visitCount.current)
  }, [focused])

  const tracker = useMemo<SponsoredCtaImpressionTracker | null>(() => {
    if (!focused || visit === null) return null
    return {
      visit,
      report(surface, postId, sponsorship) {
        const key = [surface, postId, sponsorship.partnerId, sponsorship.offerId].join(
          '\u0000'
        )
        if (seen.current.has(key)) return
        seen.current.add(key)
        try {
          trackMobileAffiliateCtaShown(
            analytics,
            analytics.getDistinctId() || 'mobile-anonymous-user',
            {
              partnerId: sponsorship.partnerId,
              offerId: sponsorship.offerId,
              surface,
              localeRegion: resolveAffiliateLocaleRegion(activeLocale),
            }
          )
        } catch {
          // Measurement only: a payload the strict schema refuses is dropped and
          // never takes the card down with it.
        }
      },
    }
  }, [activeLocale, analytics, focused, visit])

  return (
    <SponsoredCtaImpressionContext.Provider value={tracker}>
      {children}
    </SponsoredCtaImpressionContext.Provider>
  )
}
