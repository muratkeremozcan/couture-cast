// Story 3.5 Task 1 step 1 owner: orchestrate responsive grid breakpoints and hero/community panels in apps/web/src/app/components/lookbook-prism-layout.tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { WeatherAlertDeepLinkTarget } from '@couture/api-client'
import type { ClimateBand } from '@couture/api-client/contracts/http'
import posthog from 'posthog-js'
import { I18nextProvider } from 'react-i18next'
import { getI18n } from '../../i18n'
import { processWebDeepLink } from '../lib/deep-link-handler'
import { LayoutControls } from './layout-controls'
import { CommunityLookbookGrid, LookbookFilterNav } from './community-lookbook-grid'
import type { FilterCategory } from './community-lookbook-grid'
import { PlannerRail } from './planner-rail'
import { ChipNavigation } from './chip-navigation'
import type { ChipCategory } from './chip-navigation'
import { StickyBottomNav } from './sticky-bottom-nav'
import { InfoBanner } from './info-banner'

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
 * Story 3.5 design copy. Every field here is hardcoded demonstration content —
 * the garment chips below the card are too — and it is what the hero renders
 * until a real recommendation feed reaches this surface.
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
 * So this entry describes the view a reader selected, brand-oriented looks, and
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
const HERO_RECOMMENDATIONS: Record<
  ChipCategory,
  { eyebrow: string; score: string; title: string; description: string }
> = {
  Personal: {
    eyebrow: 'Commute Ready',
    score: '96%',
    title: 'Double-Breasted Blazer & Silk Knit',
    description:
      'Optimized for 18°C morning train commute transitioning into air-conditioned office.',
  },
  Community: {
    eyebrow: 'Community Trending',
    score: '93%',
    title: 'Parisian Silk & Cashmere Blend',
    description:
      'Community favorites pair light cashmere with a pleated midi skirt for the breezy forecast.',
  },
  Sponsored: {
    eyebrow: 'Brand Picks',
    score: '90%',
    title: 'Couture House Archive Ensemble',
    description:
      'Brand-forward pairings built around recycled wool and signature gold details.',
  },
}

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

export function LookbookPrismLayout() {
  // Not `useTranslation()`: this route (`/`, via `page.tsx`) mounts no
  // `I18nextProvider` -- unlike `/settings`, `/palette`, etc. -- and the two
  // providers this file does render are scoped to the planner slots only
  // (see `DesktopPlannerRailSlot`/`PlannerOverlaySlot` above), not an
  // ancestor of this component's own render. `getI18n()` directly, matching
  // the old locked-panel code this replaces, for the two "Plan week" labels
  // below.
  const i18n = getI18n()
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
  const [isNarrowViewport, setIsNarrowViewport] = useState(false)
  const plannerOpenerRef = useRef<HTMLElement | null>(null)
  const [activeTab, setActiveTab] = useState<FilterCategory>('auto')
  const [chipCategory, setChipCategory] = useState<ChipCategory>('Personal')
  // The grid is the only thing on this page that sees the feed response, and
  // this slot renders a second `LookbookFilterNav` from the same filter state.
  // Without lifting the resolved band, the two navs answer "which climate am I
  // seeing" differently: the grid's names the band, this one says "Your climate".
  const [viewerBand, setViewerBand] = useState<ClimateBand | null>(null)

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

  const heroRecommendation = HERO_RECOMMENDATIONS[chipCategory]

  const handleChipCategoryChange = (category: ChipCategory) => {
    setChipCategory(category)
    setActiveTab(CHIP_DEFAULT_FILTER[category])
  }

  const handleMobilePreviewToggle = () => {
    const willEnablePreview = !isMobilePreview
    setIsMobilePreview(willEnablePreview)
    if (willEnablePreview) {
      requestAnimationFrame(() => {
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
      }).catch(() => setIsInvalidDeepLink(true))
    } catch {
      setIsInvalidDeepLink(true)
    }
  }, [])

  useEffect(() => {
    function handleResize() {
      setIsNarrowViewport(window.innerWidth < 1440)
    }
    // Correct the SSR-safe `false` default to the real viewport immediately
    // on mount -- this runs after hydration has already committed with the
    // matching `false`, so it costs one extra render rather than a mismatch.
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!focusedWeatherAlert) {
      return
    }
    requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView?.({ block: 'center' })
      alertRef.current?.focus()
    })
  }, [focusedWeatherAlert])

  useEffect(() => {
    if (!highlightedCardId) {
      return
    }
    requestAnimationFrame(() => {
      const card = document.getElementById(`lookbook-card-${highlightedCardId}`)
      card?.scrollIntoView?.({ block: 'center' })
      card?.focus()
    })
  }, [activeTab, highlightedCardId])

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
    <div
      ref={containerRef}
      data-focus-surface="light"
      data-testid="lookbook-prism-container"
      className={`lookbook-body relative w-full bg-[#FFFFFF] text-[#111111] motion-safe:transition-[max-width,box-shadow] motion-safe:duration-300 motion-reduce:transition-none ${
        isMobilePreview
          ? 'my-6 mx-auto max-h-[812px] max-w-[375px] overflow-x-hidden overflow-y-auto rounded-[32px] border-4 border-[#111111] bg-[#FFFFFF] p-4 shadow-2xl'
          : 'mx-auto max-w-[1440px] px-4 py-8 sm:px-6'
      }`}
    >
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="lookbook-metrics text-xs uppercase tracking-[0.3em] text-[#8A691F]">
            Lookbook Prism
          </span>
          <h2
            className={`lookbook-display font-semibold tracking-tight text-[#111111] ${
              isMobilePreview ? 'text-3xl' : 'text-3xl sm:text-4xl'
            }`}
          >
            Weather-Aware Wardrobe & Community
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
          className="min-h-[44px] rounded-lg border border-[#C9A14A] bg-[#FFFFFF] px-4 py-2 text-sm font-semibold text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
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
          data-focus-surface="dark"
          aria-label="Severe Weather Alert Details"
          data-testid="severe-weather-alert-focused"
          tabIndex={-1}
          className="my-4 rounded-xl border border-[#B91C1C] bg-[#361F1F] p-5 text-[#FFFFFF] ring-2 ring-[#C9A14A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFFFFF]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#F87171]">
              ⚠️ {focusedWeatherAlert.event.data.severity} weather alert
              {` (#${focusedWeatherAlert.id})`}
            </span>
            <span className="text-xs text-[#E6E6ED]">
              {focusedWeatherAlert.event.data.location}
            </span>
          </div>
          <h3 className="mt-2 text-lg font-semibold">
            {focusedWeatherAlert.event.data.alertType.replace('_', ' ')} advisory
          </h3>
          <p className="mt-1 text-sm text-[#E6E6ED]">
            {focusedWeatherAlert.event.data.message}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              data-focus-surface="light"
              onClick={() => handleChipCategoryChange('Personal')}
              className="rounded-lg bg-[#C9A14A] px-4 py-2 text-xs font-semibold text-[#111111] hover:bg-[#b58e3c]"
            >
              Adjust outfit
            </button>
            <button
              type="button"
              onClick={(event) => {
                plannerOpenerRef.current = event.currentTarget
                setIsPlannerRailOpen(true)
              }}
              className="rounded-lg border border-[#E6E6ED] bg-transparent px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
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
            : 'grid-cols-1 min-[1280px]:grid-cols-2 min-[1440px]:grid-cols-[1fr_1fr_320px]'
        }`}
      >
        {/* Left Column / Slot 1: Hero Ritual Canvas */}
        <section
          aria-label="Hero Ritual Canvas"
          className={`flex flex-col gap-6 rounded-[8px] border border-[#E6E6ED] bg-[#F5F5F7] p-6 shadow-sm ${
            isMobilePreview ? '' : 'sm:p-8'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="lookbook-metrics text-xs uppercase tracking-widest text-[#8A691F]">
              Daily Hero Ritual
            </span>
            <span className="lookbook-metrics rounded-full border border-[#E6E6ED] bg-[#FFFFFF] px-3 py-1 text-xs text-[#111111]">
              08:30 AM • NYC
            </span>
          </div>

          {/* Weather Numerical Banner */}
          <div className="flex items-baseline gap-4">
            <span className="lookbook-metrics text-5xl font-bold text-[#111111]">
              18°C
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#111111]">Mild Humidity • 65%</p>
              <p className="lookbook-metrics text-xs text-[#5C5C66]">
                +3°C from yesterday commute
              </p>
            </div>
          </div>

          <LookbookFilterNav
            activeTab={activeTab}
            isMobilePreview={isMobilePreview}
            onTabChange={setActiveTab}
            viewerBand={viewerBand}
          />

          {/* Outfit Tiles */}
          <div className="space-y-4">
            <h3 className="lookbook-display text-xl font-semibold text-[#111111]">
              Primary Recommended Look
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
                // Single Primary Card
                <div className="group rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-6 motion-safe:transition-colors motion-safe:duration-300 motion-safe:hover:border-[#C9A14A] motion-reduce:transition-none">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="lookbook-metrics text-xs uppercase text-[#8A691F]">
                      {heroRecommendation.eyebrow}
                    </span>
                    <span className="lookbook-metrics text-xs text-[#5C5C66]">
                      Match Score: {heroRecommendation.score}
                    </span>
                  </div>
                  <h4
                    data-testid="hero-recommendation-title"
                    className="lookbook-display mb-2 text-lg font-semibold text-[#111111]"
                  >
                    {heroRecommendation.title}
                  </h4>
                  <p className="mb-4 text-xs leading-relaxed text-[#36363D]">
                    {heroRecommendation.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="lookbook-metrics rounded-md border border-[#E6E6ED] bg-[#F5F5F7] px-2.5 py-1 text-[11px] text-[#36363D]">
                      Onyx Blazer
                    </span>
                    <span className="lookbook-metrics rounded-md border border-[#E6E6ED] bg-[#F5F5F7] px-2.5 py-1 text-[11px] text-[#36363D]">
                      Merlot Silk Scarf
                    </span>
                    <span className="lookbook-metrics rounded-md border border-[#E6E6ED] bg-[#F5F5F7] px-2.5 py-1 text-[11px] text-[#36363D]">
                      Leather Loafers
                    </span>
                  </div>
                </div>
              ) : (
                // Dual Outfit Cards (Comparison Mode)
                <div
                  data-testid="comparison-container"
                  className={`grid gap-4 ${
                    isMobilePreview
                      ? 'grid-cols-1'
                      : 'grid-cols-1 min-[768px]:max-[1279px]:grid-flow-col min-[768px]:max-[1279px]:auto-cols-[60%] min-[768px]:max-[1279px]:grid-cols-none min-[1280px]:grid-cols-2'
                  }`}
                >
                  {/* Look A */}
                  <div className="space-y-3 rounded-[8px] border border-[#C9A14A] bg-[#FFFFFF] p-5">
                    <div className="lookbook-metrics flex items-center justify-between text-xs text-[#8A691F]">
                      <span>LOOK A (Primary)</span>
                      <span>96%</span>
                    </div>
                    <h4 className="lookbook-display text-base font-semibold text-[#111111]">
                      Blazer & Silk Knit
                    </h4>
                    <p className="text-xs text-[#36363D]">
                      Warmth level tuned for brisk morning wind.
                    </p>
                  </div>

                  {/* Look B */}
                  <div className="space-y-3 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-5">
                    <div className="lookbook-metrics flex items-center justify-between text-xs text-[#5C5C66]">
                      <span>LOOK B (Alternative)</span>
                      <span>91%</span>
                    </div>
                    <h4 className="lookbook-display text-base font-semibold text-[#111111]">
                      Trench & Merino Cardigan
                    </h4>
                    <p className="text-xs text-[#36363D]">
                      Higher wind protection with water-resistant shell.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right Column / Slot 2: Community Lookbook Grid */}
        <section aria-label="Community Section" className="w-full">
          <CommunityLookbookGrid
            activeTab={activeTab}
            isMobilePreview={isMobilePreview}
            chipCategory={chipCategory}
            highlightedCardId={highlightedCardId}
            onViewerBandChange={setViewerBand}
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

      <div className="mt-8 flex justify-end">
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
