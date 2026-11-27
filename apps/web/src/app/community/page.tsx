'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseDeepLink } from '@couture/utils'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { isLiveScope, useWebSessionScope } from '../../lib/use-web-session'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { CommunityLookbookGrid } from '../components/community-lookbook-grid'
import { InfoBanner } from '../components/info-banner'
import { ScreenGate } from '../components/screen-gate'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import {
  canFocusWebSpotlightActivation,
  processWebDeepLink,
} from '../lib/deep-link-handler'

export default function CommunityPage() {
  return (
    <AppPage className="overflow-x-clip">
      <AppTopBar titleKey="nav.community" />
      <main
        id="main-content"
        tabIndex={-1}
        data-testid="community-page"
        className={APP_MAIN_NARROW_CLASS}
      >
        <ScreenGate
          screen="community"
          reads={COMMUNITY_GATE_READS}
          placeholderClassName="min-h-[60vh] w-full rounded-xl bg-card-muted"
        >
          <CommunityContent />
        </ScreenGate>
      </main>
      <StickyBottomNav />
    </AppPage>
  )
}

function CommunityContent() {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const [query, setQuery] = useState('')
  const rawParams = Object.fromEntries(new URLSearchParams(query))
  const payload = parseDeepLink(rawParams).payload
  const isSpotlightLink = payload?.focus === 'spotlight'
  const isNotificationLink = rawParams.type === 'community' && !isSpotlightLink
  const scope = useWebSessionScope()
  const intentScope = useRef<{ query: string; scope: string } | null>(null)
  if (intentScope.current?.query !== query) intentScope.current = null
  if (scope && !intentScope.current) intentScope.current = { query, scope }
  const intentAllowed = scope !== null && intentScope.current?.scope === scope
  const [answer, setAnswer] = useState<{
    query: string
    scope: string
    cardId?: string
    invalid: boolean
  } | null>(null)
  const current = answer?.query === query && answer.scope === scope ? answer : null

  useEffect(() => {
    if (!scope || !intentAllowed || !isNotificationLink) return
    const rawParams = Object.fromEntries(new URLSearchParams(query))
    const controller = new AbortController()
    const result: NonNullable<typeof answer> = { query, scope, invalid: false }
    const now = new Date()
    void processWebDeepLink({
      rawParams,
      scenarioContext: { now, nextForecastAt: now, timeZone: 'UTC' },
      setChipCategory: () => undefined,
      setActiveTab: () => undefined,
      setFocusedWeatherAlert: () => undefined,
      setHighlightedCardId: (cardId) => {
        result.cardId = cardId
      },
      setLiveAnnouncement: () => undefined,
      setIsInvalidDeepLink: (invalid) => {
        result.invalid = invalid
      },
      signal: controller.signal,
    })
      .catch(() => {
        result.invalid = true
      })
      .finally(() => {
        if (!controller.signal.aborted && isLiveScope(scope)) setAnswer(result)
      })
    return () => controller.abort()
  }, [intentAllowed, isNotificationLink, query, scope])

  const spotlightIntent =
    scope &&
    intentAllowed &&
    isSpotlightLink &&
    payload.cardId &&
    payload.focusToken &&
    canFocusWebSpotlightActivation(payload.focusToken, scope)
      ? { cardId: payload.cardId, focusToken: payload.focusToken }
      : null
  return (
    <>
      <Suspense>
        <CommunityQuery onChange={setQuery} />
      </Suspense>
      {current?.invalid && (
        <InfoBanner
          message={t('community.deepLink.invalid')}
          onDismiss={() => setAnswer({ ...current, invalid: false })}
        />
      )}
      <CommunityLookbookGrid
        showFilterNav
        filterNavStickyTop={0}
        returnPath="/community"
        newPostEmphasis="primary"
        highlightedCardId={current?.cardId}
        spotlightFocusIntent={spotlightIntent}
      />
    </>
  )
}

function CommunityQuery({ onChange }: { onChange: (query: string) => void }) {
  const query = useSearchParams().toString()
  useEffect(() => onChange(query), [onChange, query])
  return null
}

const COMMUNITY_GATE_READS = ['feed', 'spotlight'] as const
