'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackAffiliateCtaShown } from '@couture/api-client'
import type { ScenarioOutfit } from '@couture/api-client/contracts/http'
import { browserAnalytics } from '../../analytics/browser-analytics'
import { getI18n } from '../../i18n'
import {
  beginAffiliatePartnerHandoff,
  mintAffiliateClickFromWeb,
  resolveAffiliateLocaleRegion,
} from '../../lib/commerce'
import { isLiveScope } from '../../lib/use-web-session'

export function TodayOutfitCommerce({
  outfit,
  offer,
  scope,
  shown,
}: {
  outfit: ScenarioOutfit
  offer: NonNullable<ScenarioOutfit['shopThisLook']>
  scope: string | null
  shown: Set<string>
}) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (shown.has(outfit.id) || !isLiveScope(scope)) return
    shown.add(outfit.id)
    try {
      const event = trackAffiliateCtaShown(
        {
          partnerId: offer.partnerId,
          scenario: outfit.scenario,
          surface: 'web_hero',
          localeRegion: resolveAffiliateLocaleRegion(i18n.language),
          recommendationId: outfit.id,
        },
        browserAnalytics.getDistinctId() || 'web-anonymous-user'
      )
      browserAnalytics.capture(event.event, event.properties)
    } catch {
      // Analytics is independent of the offer.
    }
  }, [i18n.language, offer.partnerId, outfit.id, outfit.scenario, scope, shown])

  const activate = async () => {
    if (request.current || !isLiveScope(scope)) return
    const handoff = beginAffiliatePartnerHandoff()
    if (!handoff) {
      setState('error')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setState('loading')
    try {
      const url = await mintAffiliateClickFromWeb(
        {
          offerId: offer.offerId,
          recommendationId: outfit.id,
          surface: 'web_hero',
        },
        controller.signal
      )
      if (controller.signal.aborted || !isLiveScope(scope)) {
        handoff.cancel()
        return
      }
      handoff.navigate(url)
      setState('idle')
    } catch {
      handoff.cancel()
      if (!controller.signal.aborted && isLiveScope(scope)) setState('error')
    } finally {
      request.current = null
    }
  }

  return (
    <div
      data-testid="shop-this-look-block"
      className="space-y-2 rounded-lg border border-line p-3 text-sm"
    >
      <p data-testid="shop-this-look-disclosure">
        {t('commerce.shopThisLook.disclosure')}
      </p>
      <p data-testid="shop-this-look-partner">
        {t('commerce.shopThisLook.partnerLabel', { partner: offer.partnerDisplayName })}
      </p>
      <p data-testid="shop-this-look-offer-title" className="font-semibold">
        {offer.offerTitle}
      </p>
      <button
        type="button"
        data-testid="shop-this-look-cta"
        aria-busy={state === 'loading'}
        aria-disabled={state === 'loading'}
        className="min-h-11 rounded-lg border border-line-strong px-3 font-semibold"
        onClick={() => void activate()}
      >
        {t(`commerce.shopThisLook.${state === 'loading' ? 'loading' : 'cta'}`)}
      </button>
      <p data-testid="shop-this-look-opens-in-browser" className="text-xs text-ink-muted">
        {t('commerce.shopThisLook.opensInBrowser')}
      </p>
      {state === 'error' && <p role="alert">{t('commerce.shopThisLook.error')}</p>}
    </div>
  )
}
