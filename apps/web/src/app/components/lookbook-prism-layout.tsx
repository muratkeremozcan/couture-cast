'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { ScenarioName } from '@couture/api-client/contracts/http'
import type { WeatherAlertDeepLinkTarget } from '@couture/api-client'
import { hasDeepLinkIntent, parseDeepLink } from '@couture/utils'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import {
  currentWebSessionScope,
  useWebSession,
  useWebSessionScope,
} from '../../lib/use-web-session'
import { processWebDeepLink } from '../lib/deep-link-handler'
import { GuestPreviewEntry } from './guest-preview/guest-preview-entry'
import { HomeRitual } from './home-ritual'
import {
  HomeSpotlightTeaserSlot,
  useHomeSpotlightTeaserLink,
} from './home-spotlight-teaser'
import { InfoBanner } from './info-banner'
import { useScreenGateOpen, useScreenGateRead } from './screen-gate'

type TodayLinkState = {
  scope: string | null
  alert: WeatherAlertDeepLinkTarget | null
  scenario?: ScenarioName
  invalid: boolean
  announcement: string | null
}

export function LookbookPrismLayout() {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const router = useRouter()
  const scope = useWebSessionScope()
  const { status } = useWebSession()
  const alertRef = useRef<HTMLDivElement>(null)
  const todayRef = useRef<HTMLDivElement>(null)
  const linkScopeRef = useRef<string | null | undefined>(undefined)
  const [link, setLink] = useState<TodayLinkState | null>(null)
  const input = link?.scope === scope ? link : null
  // A link that already resolved for another scope must not replay when the account changes.
  useScreenGateRead('deeplink', link !== null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const rawParams = Object.fromEntries(params)
    const parsed = parseDeepLink(rawParams)
    if (parsed.valid && parsed.payload?.type === 'community' && parsed.payload.cardId) {
      router.replace(`/community?${params.toString()}`)
      return
    }

    const linkScope = currentWebSessionScope()
    if (hasDeepLinkIntent(rawParams)) {
      if (status === 'checking') return
      if (linkScopeRef.current !== undefined && linkScopeRef.current !== linkScope) {
        setLink({ scope: linkScope, alert: null, invalid: false, announcement: null })
        return
      }
      linkScopeRef.current = linkScope
    }
    const controller = new AbortController()
    const answer: TodayLinkState = {
      scope: linkScope,
      alert: null,
      invalid: false,
      announcement: null,
    }
    const now = new Date()
    void processWebDeepLink({
      rawParams,
      scenarioContext: {
        now,
        nextForecastAt: new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      setChipCategory: () => undefined,
      setActiveTab: () => undefined,
      setScenario: (scenario) => {
        answer.scenario = scenario
      },
      setFocusedWeatherAlert: (alert) => {
        answer.alert = alert
      },
      setHighlightedCardId: () => undefined,
      setLiveAnnouncement: (announcement) => {
        answer.announcement = announcement
      },
      setIsInvalidDeepLink: (invalid) => {
        answer.invalid = invalid
      },
      signal: controller.signal,
    })
      .catch(() => {
        answer.invalid = true
      })
      .finally(() => {
        if (controller.signal.aborted) return
        // If authentication changed during a private read, settle without replaying it.
        setLink(
          currentWebSessionScope() === linkScope
            ? answer
            : { scope: linkScope, alert: null, invalid: false, announcement: null }
        )
      })
    return () => controller.abort()
  }, [router, status])

  const gateOpen = useScreenGateOpen()
  const focusedAlert = input?.alert
  useEffect(() => {
    if (!focusedAlert || !gateOpen) return
    const frame = requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView?.({ block: 'center' })
      alertRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedAlert, gateOpen])

  return (
    <div
      ref={todayRef}
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-4 outline-none"
    >
      {input?.invalid && (
        <InfoBanner
          message={t('community.deepLink.invalid')}
          onDismiss={() =>
            setLink((current) => current && { ...current, invalid: false })
          }
        />
      )}
      {focusedAlert && (
        <div
          ref={alertRef}
          role="alert"
          aria-atomic="true"
          aria-label={t('landing.lookbook.alert.label')}
          data-testid="severe-weather-alert-focused"
          tabIndex={-1}
          className="space-y-2 rounded-xl border border-danger-line bg-danger-surface p-4"
        >
          <p className="text-sm font-semibold text-danger-ink">
            {t('landing.lookbook.alert.severity', {
              severity: focusedAlert.event.data.severity,
            })}
            {` (#${focusedAlert.id})`}
          </p>
          <h2 className="text-lg font-semibold">{focusedAlert.event.data.location}</h2>
          <p className="text-sm">{focusedAlert.event.data.message}</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold underline underline-offset-4">
            <button
              type="button"
              className="min-h-11"
              onClick={() => {
                const action = todayRef.current?.querySelector<HTMLElement>(
                  '[data-testid="today-primary-action"], [data-testid="home-set-city"]'
                )
                if (action?.getAttribute('aria-expanded') === 'false') action.click()
                action?.focus()
              }}
            >
              {t('landing.lookbook.alert.adjustOutfit')}
            </button>
            <Link
              href="/looks?segment=plan"
              className="inline-flex min-h-11 items-center"
            >
              {t('commerce.premium.planner.openControl')}
            </Link>
          </div>
        </div>
      )}
      {input?.announcement && (
        <p aria-live="polite" role="status" className="sr-only">
          {input.announcement}
        </p>
      )}
      <HomeRitual demo={<GuestPreviewEntry />} scenario={input?.scenario} />
      <TodaySpotlight
        key={scope}
        onLeaveWhileFocused={() => {
          const primary = todayRef.current?.querySelector<HTMLElement>(
            '[data-testid="today-primary-action"], [data-testid="home-set-city"]'
          )
          const target = primary ?? todayRef.current
          target?.focus()
        }}
      />
    </div>
  )
}

function TodaySpotlight({ onLeaveWhileFocused }: { onLeaveWhileFocused: () => void }) {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const teaser = useHomeSpotlightTeaserLink()
  useScreenGateRead('teaser', teaser.settled)
  return (
    <HomeSpotlightTeaserSlot
      teaser={teaser}
      t={t}
      onLeaveWhileFocused={onLeaveWhileFocused}
    />
  )
}
