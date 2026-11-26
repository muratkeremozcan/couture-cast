// Story 3.5 Task 1 step 1 owner: orchestrate responsive grid breakpoints and hero/community panels in apps/web/src/app/components/lookbook-prism-layout.tsx
// Story 5.5 Task 7 step 3 owner: own the Plan week control, the closed default and the 1440px variant decision in `apps/web/src/app/components/lookbook-prism-layout.tsx`
'use client'

import { HomeRitual } from './home-ritual'

import React, { useEffect, useRef, useState } from 'react'
import type { WeatherAlertDeepLinkTarget } from '@couture/api-client'
import posthog from 'posthog-js'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { getGuestPreviewStrings } from '@couture/utils'
import { getI18n } from '../../i18n'
import { processWebDeepLink } from '../lib/deep-link-handler'
import { LayoutControls } from './layout-controls'
import { CommunityLookbookGrid, type FilterCategory } from './community-lookbook-grid'
import { PlannerRail } from './planner-rail'
import { ChipNavigation, type ChipCategory } from './chip-navigation'
import { StickyBottomNav } from './sticky-bottom-nav'
import { InfoBanner } from './info-banner'
import {
  HomeSpotlightTeaserSlot,
  useHomeSpotlightTeaserLink,
} from './home-spotlight-teaser'
import { useScreenGateOpen, useScreenGateRead } from './screen-gate'
import { useHydrating } from '../../lib/use-web-session'

/**
 * Story 6.1: every chip category lands on the `auto` feed.
 *
 * The chip category still drives the hero copy and `data-chip-category`; it no
 * longer selects a feed filter, because `New`, `Following` and `Brands` were
 * chips with no server behind them and the spec's Boundaries forbid that.
 */
const CHIP_DEFAULT_FILTER: Record<ChipCategory, FilterCategory> = {
  Personal: 'auto',
  Community: 'auto',
  Sponsored: 'auto',
}

/**
 * Story 3.5 design copy. Every entry names hardcoded demonstration content (its
 * copy lives under `home.lookbook.recommendations.<key>` in the web catalogs since
 * Story CC-7.9 D9; the garment chips below the card are demonstration too), and
 * it is what the hero renders until a real recommendation feed reaches this surface.
 *
 * THE `Sponsored` ENTRY MUST NOT CLAIM A COMMERCIAL RELATIONSHIP. It used to
 * read `'Sponsored Selection'` over `'A clearly labeled brand selection...'`,
 * which is a paid-placement disclosure attached to content with no partner
 * behind it and no `AffiliateOffer` row anywhere near it. It was reachable in
 * ordinary use: `Sponsored` is a real chip category, and `deep-link-handler.ts`
 * routes the `evening` deep link straight to it.
 *
 * The vocabulary for genuine paid placement is owned by story 5.1 and lives in
 * the `commerce.shopThisLook.*` catalog keys — "Paid partnership. CoutureCast
 * may earn a commission." and "Presented by {{partner}}" — rendered only beside
 * an offer that exists. `prd.md:192` requires sponsored content to be labeled.
 * Placeholder copy borrowing that language is the inverse failure: a disclosure
 * with nothing to disclose, which is a claim rather than a caveat.
 *
 * So the `brands` entry describes the view a reader selected, brand-oriented looks, and
 * says nothing about who paid for it. `lookbook-prism-layout.test.tsx` asserts
 * that, so restoring the old wording turns a test red rather than shipping
 * quietly.
 *
 * Story 6.1 note: the chip category no longer selects a community feed filter.
 * Every `CHIP_DEFAULT_FILTER` entry now maps to `auto`, because the four legacy
 * filters (`New`, `Following`, `Near me`, `Brands`) had no server behavior and
 * the spec forbids an active chip without one. The category still drives this
 * hero copy and `data-chip-category`, which is why the disclosure rule above
 * still governs it.
 */
const HERO_RECOMMENDATIONS: Record<ChipCategory, { key: string; score: string }> = {
  Personal: { key: 'personal', score: '96%' },
  Community: { key: 'community', score: '93%' },
  Sponsored: { key: 'brands', score: '90%' },
}

/** The demonstration garment chips under the hero look (catalog keys under `home.lookbook.demo.garments`). */
const DEMO_GARMENT_KEYS = ['blazer', 'scarf', 'loafers'] as const

interface PlannerSlotProps {
  isMobilePreview: boolean
  isNarrowViewport: boolean
  isPlannerRailOpen: boolean
  onClose: () => void
  plannerOpenerRef: React.RefObject<HTMLElement | null>
}

/**
 * The >=1440px third-column rail slot. Split out of `LookbookPrismLayout`
 * (alongside {@link PlannerOverlaySlot}) purely to keep that function's
 * cyclomatic complexity under this repo's ceiling of 15 -- the four
 * `isMobilePreview`/`isNarrowViewport`/`isPlannerRailOpen` conditions live
 * here instead, following `palette-advisor-panel.tsx`'s same rationale for
 * its own extracted blocks.
 *
 * Each slot carries its own `I18nextProvider` rather than one wrapping all of
 * `LookbookPrismLayout`: the `/` route mounts none (unlike `/settings`,
 * `/palette`, etc.), and scoping it to just the two places that render
 * `PlannerRail` -- the only consumer of `useTranslation()` on this page --
 * keeps the rest of this static-English file's indentation untouched.
 */
function DesktopPlannerRailSlot({
  isMobilePreview,
  isNarrowViewport,
  isPlannerRailOpen,
  onClose,
  plannerOpenerRef,
}: PlannerSlotProps) {
  if (isMobilePreview || isNarrowViewport) return null
  return (
    <div className="hidden min-[1440px]:block">
      {isPlannerRailOpen && (
        <I18nextProvider i18n={getI18n()}>
          <PlannerRail
            isOpen
            onClose={onClose}
            variant="rail"
            invokingElementRef={plannerOpenerRef}
          />
        </I18nextProvider>
      )}
    </div>
  )
}

/** The below-1440px focus-trapped overlay drawer, rendered outside the grid entirely. */
function PlannerOverlaySlot({
  isMobilePreview,
  isNarrowViewport,
  isPlannerRailOpen,
  onClose,
  plannerOpenerRef,
}: PlannerSlotProps) {
  if (isMobilePreview || !isNarrowViewport || !isPlannerRailOpen) return null
  return (
    <I18nextProvider i18n={getI18n()}>
      <PlannerRail
        isOpen
        onClose={onClose}
        variant="overlay"
        invokingElementRef={plannerOpenerRef}
      />
    </I18nextProvider>
  )
}

/**
 * Story CC-7.7 D4: the teaser's place is known once the viewport is measured; it shows only when
 * the layout stacks, and then the gate waits for its read.
 */
function teaserGateSettled(
  measured: boolean,
  stacked: boolean,
  settled: boolean
): boolean {
  return measured && (!stacked || settled)
}

export function LookbookPrismLayout() {
  const { i18n } = useTranslation(undefined, { i18n: getI18n() })
  const containerRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const [isComparisonMode, setIsComparisonMode] = useState(false)
  const [isMobilePreview, setIsMobilePreview] = useState(false)
  // Story 5.5 Decision 7: closed by default, opened only by the "Plan week"
  // control. `PlannerRail` is self-contained below this -- it owns its own
  // `checking | entitled | locked | error` state and fetches nothing until
  // this turns true, so there is no separate entitlement effect in this
  // component any more (Story 5.2's used to live here).
  const [isPlannerRailOpen, setIsPlannerRailOpen] = useState(false)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('planner') !== '1') return
    setIsPlannerRailOpen(true)
    url.searchParams.delete('planner')
    window.history.replaceState(window.history.state, '', url)
  }, [])
  // >=1440px renders the rail inline as the third grid column (no focus trap,
  // ordinary page content); narrower renders it as a focus-trapped overlay
  // drawer. `window.innerWidth` matches this file's own existing posthog
  // layout-mode check below rather than introducing `matchMedia`, which has
  // no other user in this codebase.
  //
  // The initial value must be a literal, not a `window`-dependent lazy
  // initializer: SSR has no `window` (`isNarrowViewport` would resolve to
  // `false`), but React reuses that SAME initializer for the client's first
  // hydration render too, where `window` DOES exist -- so a real narrow
  // viewport made the client's first render disagree with the server's,
  // which is exactly React error #418 ("Minified React error #418",
  // hydration mismatch). `false` matches the server unconditionally; the
  // effect below corrects it immediately on mount, one render after
  // hydration completes, which is the standard fix for viewport-dependent
  // state in an SSR'd component.
  //
  // Story CC-7.7 D5: only hydration needs that literal. A client-side mount (a return to Home)
  // measures at once, so its first frame already holds the stacked teaser it will keep.
  const hydrating = useHydrating()
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => !hydrating && window.innerWidth < 1440
  )
  // Story 6.7: below 1280px the hero sits above the community section. Same
  // SSR-safe `false` default as above, measured after mount.
  const [isBelowSplit, setIsBelowSplit] = useState(
    () => !hydrating && window.innerWidth < 1280
  )
  // True once the effect below measured the viewport: until then nobody knows whether the
  // layout stacks, so whether the teaser shows is unknown too.
  const [isMeasured, setIsMeasured] = useState(!hydrating)
  const isStacked = isMobilePreview || isBelowSplit
  const heroCanvasRef = useRef<HTMLElement>(null)
  const teaser = useHomeSpotlightTeaserLink({ stacked: isStacked })
  // Story CC-7.7 D4: the teaser sits inside the hero, above the community section, so Home's
  // screen gate waits for it wherever it shows (stacked layouts).
  useScreenGateRead('teaser', teaserGateSettled(isMeasured, isStacked, teaser.settled))
  const plannerOpenerRef = useRef<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState<FilterCategory>('auto')
  const [chipCategory, setChipCategory] = useState<ChipCategory>('Personal')
  const [communityBanned, setCommunityBanned] = useState(false)

  // Deep Link & Notification States
  const [isInvalidDeepLink, setIsInvalidDeepLink] = useState(false)
  // Mobile routes the same string through `t('common.invalid_link')`; a `tr-TR`
  // or `de-DE` reader saw English here on exactly the path the catalogs carry
  // copy for.
  const invalidDeepLinkMessage = i18n.t('community.deepLink.invalid')
  const [focusedWeatherAlert, setFocusedWeatherAlert] =
    useState<WeatherAlertDeepLinkTarget | null>(null)
  const [highlightedCardId, setHighlightedCardId] = useState<string | undefined>(
    undefined
  )
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null)
  // Story CC-7.7 D4: an invalid-link banner or a focused weather alert lands above the prism
  // grid when the deep link resolves, which can take a network read. Home's gate waits for it,
  // so neither moves the grid after the body appeared.
  const [deepLinkSettled, setDeepLinkSettled] = useState(false)
  useScreenGateRead('deeplink', deepLinkSettled)

  const heroRecommendation = HERO_RECOMMENDATIONS[chipCategory]

  const handleChipCategoryChange = (category: ChipCategory) => {
    setChipCategory(category)
    setActiveTab(CHIP_DEFAULT_FILTER[category])
  }

  // The frame that scrolls the preview into view; an unmount cancels it, so it
  // never runs against a layout that is gone.
  const previewScrollFrameRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (previewScrollFrameRef.current !== null)
        cancelAnimationFrame(previewScrollFrameRef.current)
    },
    []
  )

  const handleMobilePreviewToggle = () => {
    const willEnablePreview = !isMobilePreview
    setIsMobilePreview(willEnablePreview)
    if (willEnablePreview) {
      if (previewScrollFrameRef.current !== null)
        cancelAnimationFrame(previewScrollFrameRef.current)
      previewScrollFrameRef.current = requestAnimationFrame(() => {
        previewScrollFrameRef.current = null
        containerRef.current?.scrollIntoView({ block: 'start' })
      })
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const searchParams = new URLSearchParams(window.location.search)
      const rawParams: Record<string, string> = {}
      searchParams.forEach((value, key) => {
        rawParams[key] = value
      })

      const now = new Date()
      void processWebDeepLink({
        rawParams,
        scenarioContext: {
          now,
          nextForecastAt: new Date(
            Math.ceil(now.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000
          ),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        setChipCategory,
        setActiveTab,
        setFocusedWeatherAlert,
        setHighlightedCardId,
        setLiveAnnouncement,
        setIsInvalidDeepLink,
      })
        .catch(() => setIsInvalidDeepLink(true))
        .finally(() => setDeepLinkSettled(true))
    } catch {
      setIsInvalidDeepLink(true)
      setDeepLinkSettled(true)
    }
  }, [])

  useEffect(() => {
    function handleResize() {
      setIsNarrowViewport(window.innerWidth < 1440)
      setIsBelowSplit(window.innerWidth < 1280)
      setIsMeasured(true)
    }
    // Correct the SSR-safe `false` default to the real viewport immediately
    // on mount -- this runs after hydration has already committed with the
    // matching `false`, so it costs one extra render rather than a mismatch.
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Story CC-7.7 (CI, 61d7156e): Home's gate hides the body until its reads settle, and focus
  // on a hidden element is dropped, so a deep-link target takes focus once the gate is open.
  const gateOpen = useScreenGateOpen()
  useEffect(() => {
    if (!focusedWeatherAlert || !gateOpen) {
      return
    }
    requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView?.({ block: 'center' })
      alertRef.current?.focus()
    })
  }, [focusedWeatherAlert, gateOpen])

  useEffect(() => {
    if (!highlightedCardId || !gateOpen) {
      return
    }
    requestAnimationFrame(() => {
      const card = document.getElementById(`lookbook-card-${highlightedCardId}`)
      card?.scrollIntoView?.({ block: 'center' })
      card?.focus()
    })
  }, [activeTab, highlightedCardId, gateOpen])

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('lookbook_prism_viewed', {
          viewportWidth: window.innerWidth,
          layoutMode:
            window.innerWidth >= 1280
              ? 'split'
              : window.innerWidth >= 768
                ? 'stacked'
                : 'mobile',
        })
      }
    } catch {
      // Fallback
    }
  }, [])

  return (
    // Story CC-7.9 D7: the lookbook sits straight on the page surface (the light inset card and
    // its frame are gone); the hero canvas below is the one card level. The phone preview keeps
    // its device frame.
    <div
      ref={containerRef}
      data-testid="lookbook-prism-container"
      className={`relative w-full text-ink motion-safe:transition-[max-width,box-shadow] motion-safe:duration-200 motion-reduce:transition-none ${
        isMobilePreview
          ? 'my-6 mx-auto max-h-[812px] max-w-[375px] overflow-x-hidden overflow-y-auto rounded-xl border-4 border-ink bg-page p-4 shadow-overlay'
          : 'mx-auto max-w-[1440px]'
      }`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4 sm:mb-8">
        <div data-landing="guest">
          <span className="text-xs uppercase tracking-[0.3em] text-ink-muted">
            {i18n.t('home.lookbook.eyebrow')}
          </span>
          <h2 className="text-3xl font-semibold tracking-tight text-ink">
            {i18n.t('home.lookbook.title')}
          </h2>
        </div>
        {/*
          Story 5.5 Decision 7: the "ordinary Plan week control near the hero
          actions" that opens the planner. Present at every viewport --
          `PlannerRail` itself decides rail vs overlay chrome below.
        */}
        <button
          type="button"
          data-testid="planner-open-control"
          onClick={(event) => {
            plannerOpenerRef.current = event.currentTarget
            setIsPlannerRailOpen(true)
          }}
          className="min-h-11 rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-semibold text-ink"
        >
          {i18n.t('commerce.premium.planner.openControl')}
        </button>
      </div>

      {isInvalidDeepLink && (
        <InfoBanner
          message={invalidDeepLinkMessage}
          onDismiss={() => setIsInvalidDeepLink(false)}
        />
      )}

      {focusedWeatherAlert && (
        <div
          ref={alertRef}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          aria-label={i18n.t('home.lookbook.alert.label')}
          data-testid="severe-weather-alert-focused"
          tabIndex={-1}
          className="my-4 rounded-xl border border-danger-line bg-danger-surface p-5 text-ink"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-danger-ink">
              ⚠️{' '}
              {i18n.t('home.lookbook.alert.severity', {
                severity: focusedWeatherAlert.event.data.severity,
              })}
              {` (#${focusedWeatherAlert.id})`}
            </span>
            <span className="text-xs text-ink-soft">
              {focusedWeatherAlert.event.data.location}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-semibold">
            {i18n.t('home.lookbook.alert.advisory', {
              type: focusedWeatherAlert.event.data.alertType.replace('_', ' '),
            })}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {focusedWeatherAlert.event.data.message}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => handleChipCategoryChange('Personal')}
              className="rounded-lg border border-line-strong bg-page px-4 py-2 text-xs font-semibold text-ink"
            >
              {i18n.t('home.lookbook.alert.adjustOutfit')}
            </button>
            <button
              type="button"
              onClick={(event) => {
                plannerOpenerRef.current = event.currentTarget
                setIsPlannerRailOpen(true)
              }}
              className="rounded-lg border border-line-strong bg-transparent px-4 py-2 text-xs font-semibold text-ink hover:bg-ink/5"
            >
              {i18n.t('commerce.premium.planner.openControl')}
            </button>
          </div>
        </div>
      )}

      {liveAnnouncement && (
        <div aria-live="polite" role="status" className="sr-only">
          {liveAnnouncement}
        </div>
      )}

      <ChipNavigation
        activeCategory={chipCategory}
        onCategoryChange={handleChipCategoryChange}
        surface="web"
      />

      {/* Main Grid Engine */}
      <div
        data-testid="lookbook-prism-grid"
        className={`grid gap-8 ${
          isMobilePreview
            ? 'grid-cols-1'
            : // `minmax(0,1fr)`, because a bare `1fr` track floors at its content's
              // min-content: the hero's non-wrapping filter chips then claimed the
              // whole row and crushed the community column off the right edge.
              'grid-cols-1 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]'
        }`}
      >
        {/* Left Column / Slot 1: Hero Ritual Canvas */}
        <section
          ref={heroCanvasRef}
          aria-label={i18n.t('home.lookbook.heroLabel')}
          // Focusable from code, so focus has somewhere to land when the teaser leaves.
          tabIndex={-1}
          // Story CC-7.9 D7: the hero canvas is the one card; the looks inside it are sections.
          data-surface="card"
          className={`flex min-w-0 self-start flex-col gap-6 rounded-xl border border-line bg-card p-6 shadow-card ${
            isMobilePreview ? '' : 'sm:p-8'
          }`}
        >
          <HomeRitual
            demo={
              <>
                <div className="flex items-center justify-between">
                  <h2
                    tabIndex={-1}
                    data-share-card-focus-fallback="hero"
                    className="text-xs uppercase tracking-widest text-ink-muted"
                  >
                    {i18n.t('home.lookbook.demo.heading')}
                  </h2>
                  <span className="rounded-full border border-line bg-page px-3 py-1 text-xs text-ink">
                    {i18n.t('home.lookbook.demo.timeCity')}
                  </span>
                </div>

                {/* Weather Numerical Banner */}
                <div className="flex items-baseline gap-4">
                  <span className="text-3xl font-bold text-ink">
                    {i18n.t('home.lookbook.demo.temperature')}
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-ink">
                      {i18n.t('home.lookbook.demo.humidity')}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {i18n.t('home.lookbook.demo.change')}
                    </p>
                  </div>
                </div>

                {/* Outfit Tiles */}
                <div className="space-y-4">
                  <h3 className="text-xl font-semibold text-ink">
                    {i18n.t('home.lookbook.demo.primaryLook')}
                    {/* Story 6.16 D9: this hero is a demonstration, never a visitor's result. */}
                    <span
                      data-testid="hero-example-label"
                      className="ml-3 rounded-full border border-line-strong px-2 py-0.5 align-middle text-xs uppercase text-ink-muted"
                    >
                      {getGuestPreviewStrings(i18n.language).chrome.exampleLabel}
                    </span>
                  </h3>

                  <div
                    data-testid="outfit-scroll"
                    className={
                      isMobilePreview
                        ? ''
                        : 'min-[768px]:max-[1279px]:overflow-x-auto min-[768px]:max-[1279px]:px-16'
                    }
                  >
                    {!isComparisonMode ? (
                      // Single Primary Look: a section inside the hero card (D7), not a card.
                      <div className="border-t border-line pt-4">
                        <div className="mb-4 flex items-center justify-between">
                          <span className="text-xs uppercase text-ink-muted">
                            {i18n.t(
                              `home.lookbook.recommendations.${heroRecommendation.key}.eyebrow`
                            )}
                          </span>
                          <span className="text-xs text-ink-muted">
                            {i18n.t('home.lookbook.demo.matchScore', {
                              score: heroRecommendation.score,
                            })}
                          </span>
                        </div>
                        <h4
                          data-testid="hero-recommendation-title"
                          className="mb-2 text-lg font-semibold text-ink"
                        >
                          {i18n.t(
                            `home.lookbook.recommendations.${heroRecommendation.key}.title`
                          )}
                        </h4>
                        <p className="mb-4 text-xs leading-relaxed text-ink-soft">
                          {i18n.t(
                            `home.lookbook.recommendations.${heroRecommendation.key}.description`
                          )}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {DEMO_GARMENT_KEYS.map((garment) => (
                            <span
                              key={garment}
                              className="rounded-md border border-line bg-page px-2 py-1 text-xs text-ink-soft"
                            >
                              {i18n.t(`home.lookbook.demo.garments.${garment}`)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      // Dual Outfit Looks (Comparison Mode): sections inside the hero card.
                      <div
                        data-testid="comparison-container"
                        className={`grid gap-4 ${
                          isMobilePreview
                            ? 'grid-cols-1'
                            : 'grid-cols-1 min-[768px]:max-[1279px]:grid-flow-col min-[768px]:max-[1279px]:auto-cols-[60%] min-[768px]:max-[1279px]:grid-cols-none min-[1280px]:grid-cols-2'
                        }`}
                      >
                        {/* Look A */}
                        <div className="space-y-3 border-t border-line pt-4">
                          <div className="flex items-center justify-between text-xs font-semibold text-ink">
                            <span>{i18n.t('home.lookbook.demo.lookA.label')}</span>
                            <span>96%</span>
                          </div>
                          <h4 className="text-base font-semibold text-ink">
                            {i18n.t('home.lookbook.demo.lookA.title')}
                          </h4>
                          <p className="text-xs text-ink-soft">
                            {i18n.t('home.lookbook.demo.lookA.body')}
                          </p>
                        </div>

                        {/* Look B */}
                        <div className="space-y-3 border-t border-line pt-4">
                          <div className="flex items-center justify-between text-xs text-ink-muted">
                            <span>{i18n.t('home.lookbook.demo.lookB.label')}</span>
                            <span>91%</span>
                          </div>
                          <h4 className="text-base font-semibold text-ink">
                            {i18n.t('home.lookbook.demo.lookB.title')}
                          </h4>
                          <p className="text-xs text-ink-soft">
                            {i18n.t('home.lookbook.demo.lookB.body')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            }
          />

          {/* Story 6.7: only while stacked; the value itself lives above. */}
          <HomeSpotlightTeaserSlot
            stacked={isStacked}
            teaser={
              communityBanned ? { ...teaser, value: null, reservedHeight: null } : teaser
            }
            t={(key, options) => i18n.t(key, options)}
            onLeaveWhileFocused={() => {
              requestAnimationFrame(() => heroCanvasRef.current?.focus())
            }}
          />
        </section>

        {/* Right Column / Slot 2: Community Lookbook Grid */}
        <section
          aria-label={i18n.t('home.lookbook.communityLabel')}
          className="w-full min-w-0"
        >
          <CommunityLookbookGrid
            activeTab={activeTab}
            isMobilePreview={isMobilePreview}
            chipCategory={chipCategory}
            highlightedCardId={highlightedCardId}
            // The heading, explainer and climate chips sit with the feed they filter. They used
            // to render in the hero column, which on a phone put the outfit cards between the
            // chips and the looks.
            showFilterNav
            onTabChange={setActiveTab}
            onBannedChange={setCommunityBanned}
            spotlightFocusIntent={teaser.focusIntent}
          />
        </section>

        {/*
        Ultrawide Column / Slot 3: Planner Rail Container.
        Story 5.5 Decision 7: >=1440px reserves the third grid column and
        renders the rail inline there when open; below that, the overlay
        variant renders itself as a fixed drawer outside the grid entirely
        (see `PlannerOverlaySlot` below), so this slot stays empty.
      */}
        <DesktopPlannerRailSlot
          isMobilePreview={isMobilePreview}
          isNarrowViewport={isNarrowViewport}
          isPlannerRailOpen={isPlannerRailOpen}
          onClose={() => setIsPlannerRailOpen(false)}
          plannerOpenerRef={plannerOpenerRef}
        />
      </div>

      <PlannerOverlaySlot
        isMobilePreview={isMobilePreview}
        isNarrowViewport={isNarrowViewport}
        isPlannerRailOpen={isPlannerRailOpen}
        onClose={() => setIsPlannerRailOpen(false)}
        plannerOpenerRef={plannerOpenerRef}
      />

      <div data-landing="guest" className="mt-8 flex justify-end">
        <LayoutControls
          isComparisonMode={isComparisonMode}
          onToggleComparison={() => setIsComparisonMode((currentValue) => !currentValue)}
          isMobilePreview={isMobilePreview}
          onToggleMobilePreview={handleMobilePreviewToggle}
        />
      </div>

      {isMobilePreview && <StickyBottomNav isMobilePreview />}
    </div>
  )
}
