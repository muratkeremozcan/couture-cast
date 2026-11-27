'use client'

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { parseDeepLink } from '@couture/utils'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import {
  currentWebSessionScope,
  useWebSession,
  useWebSessionScope,
} from '../../lib/use-web-session'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import {
  CommunityLookbookGrid,
  type SpotlightFocusIntent,
} from '../components/community-lookbook-grid'
import { InfoBanner } from '../components/info-banner'
import {
  ScreenGate,
  useScreenGateOpen,
  useScreenGateRead,
} from '../components/screen-gate'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import {
  processWebDeepLink,
  takeWebCommunityHandoff,
  takeWebSpotlightActivation,
} from '../lib/deep-link-handler'

export default function CommunityPage() {
  const [postActionSlot, setPostActionSlot] = useState<HTMLDivElement | null>(null)
  return (
    <AppPage className="overflow-x-clip">
      <AppTopBar
        titleKey="nav.community"
        wrapTitle
        trailing={<div className="min-w-0" ref={setPostActionSlot} />}
      />
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
          <CommunityContent postActionSlot={postActionSlot} />
        </ScreenGate>
      </main>
      <StickyBottomNav />
    </AppPage>
  )
}

type NotificationAnswer = {
  query: string
  scope: string | null
  cardId?: string
  invalid: boolean
  announcement?: string
}

function CommunityContent({ postActionSlot }: { postActionSlot: HTMLElement | null }) {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const [query, setQuery] = useState<string | null>(null)
  const scope = useWebSessionScope()
  const { status } = useWebSession()
  // Capture identity before the suspended query reader reports. Session restoration
  // may supply the first identity, while an account change cannot replace it.
  const entryScope = useRef<string | null | undefined>(scope ?? undefined)
  if (entryScope.current === undefined && (scope || status !== 'checking')) {
    entryScope.current = scope
  }
  const originallyScopedTo = entryScope.current
  const [answer, setAnswer] = useState<NotificationAnswer | null>(null)
  const receiveQuery = useCallback((next: string) => {
    setQuery(next)
    setAnswer((current) => (current?.query === next ? current : null))
  }, [])
  const current = answer?.query === query && answer.scope === scope ? answer : null
  const hasNotification = isCommunityNotification(query)
  const intentSettled = query !== null && (!hasNotification || answer?.query === query)
  useScreenGateRead('deeplink', intentSettled)

  const gateOpen = useScreenGateOpen()
  const overlayQuery = useRef<string | null>(null)
  useLayoutEffect(() => {
    // A warm gate or its deadline can already be showing the feed. A late
    // notice overlays it so it never moves a card the member is reading.
    if (scope && gateOpen && query && !intentSettled) overlayQuery.current = query
  }, [gateOpen, intentSettled, query, scope])

  useCommunityNotification(query, hasNotification, originallyScopedTo, scope, setAnswer)
  const spotlightIntent = useCommunitySpotlightFocus(query, originallyScopedTo, scope)
  const alertOverlay = overlayQuery.current === query

  return (
    <div className="relative">
      <Suspense>
        <CommunityQuery onChange={receiveQuery} />
      </Suspense>
      {current?.invalid && (
        <div className={alertOverlay ? 'absolute inset-x-0 top-0 z-10' : undefined}>
          <InfoBanner
            key={current.query}
            message={t('community.deepLink.invalid')}
            onDismiss={() =>
              setAnswer({ ...current, invalid: false, announcement: undefined })
            }
          />
        </div>
      )}
      {current?.announcement && !current.invalid && (
        <p
          role="status"
          data-testid="community-deep-link-announcement"
          className="sr-only"
        >
          {current.announcement}
        </p>
      )}
      <CommunityLookbookGrid
        postActionSlot={postActionSlot}
        returnPath="/community"
        newPostEmphasis="primary"
        highlightedCardId={current?.cardId}
        spotlightFocusIntent={spotlightIntent}
      />
    </div>
  )
}

function isCommunityNotification(query: string | null) {
  if (!query) return false
  const rawParams = Object.fromEntries(new URLSearchParams(query))
  return (
    rawParams.type === 'community' &&
    parseDeepLink(rawParams).payload?.focus !== 'spotlight'
  )
}

function useCommunityNotification(
  query: string | null,
  active: boolean,
  entryScope: string | null | undefined,
  scope: string | null,
  onAnswer: (answer: NotificationAnswer) => void
) {
  const origin = useRef<{ query: string; scope: string | null } | null>(null)
  useEffect(() => {
    if (!query || !active || entryScope === undefined) return
    if (origin.current?.query !== query) {
      origin.current = { query, scope: takeWebCommunityHandoff(query) ?? entryScope }
    }

    const result: NotificationAnswer = { query, scope, invalid: false }
    if (origin.current.scope !== scope || currentWebSessionScope() !== scope) {
      onAnswer(result)
      return
    }

    const controller = new AbortController()
    const rawParams = Object.fromEntries(new URLSearchParams(query))
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
      setLiveAnnouncement: (announcement) => {
        result.announcement = announcement ?? undefined
      },
      setIsInvalidDeepLink: (invalid) => {
        result.invalid = invalid
      },
      signal: controller.signal,
      communityScope: scope,
    })
      .catch(() => {
        result.invalid = true
      })
      .finally(() => {
        if (!controller.signal.aborted && currentWebSessionScope() === scope)
          onAnswer(result)
      })
    return () => controller.abort()
  }, [active, entryScope, onAnswer, query, scope])
}

function useCommunitySpotlightFocus(
  query: string | null,
  entryScope: string | null | undefined,
  scope: string | null
) {
  const handled = useRef<string | null>(null)
  const [activation, setActivation] = useState<{
    query: string
    scope: string
    intent: SpotlightFocusIntent
  } | null>(null)

  useEffect(() => {
    if (query === null || entryScope === undefined) return
    if (handled.current === query) {
      setActivation((current) => (current?.scope === scope ? current : null))
      return
    }
    handled.current = query
    const payload = parseDeepLink(Object.fromEntries(new URLSearchParams(query))).payload
    if (
      scope &&
      scope === entryScope &&
      currentWebSessionScope() === scope &&
      payload?.focus === 'spotlight' &&
      payload.cardId &&
      payload.focusToken &&
      takeWebSpotlightActivation(payload.focusToken, scope, payload.cardId)
    ) {
      setActivation({
        query,
        scope,
        intent: { cardId: payload.cardId, focusToken: payload.focusToken },
      })
    }
  }, [entryScope, query, scope])

  return activation?.query === query && activation.scope === scope
    ? activation.intent
    : null
}

function CommunityQuery({ onChange }: { onChange: (query: string) => void }) {
  const query = useSearchParams().toString()
  useLayoutEffect(() => onChange(query), [onChange, query])
  return null
}

const COMMUNITY_GATE_READS = ['feed', 'spotlight', 'deeplink'] as const
