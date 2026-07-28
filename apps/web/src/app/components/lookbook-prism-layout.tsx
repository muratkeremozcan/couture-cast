// Story 3.5 Task 1 step 1 owner: orchestrate responsive grid breakpoints and hero/community panels in apps/web/src/app/components/lookbook-prism-layout.tsx
'use client'

import React, { useEffect, useState } from 'react'
import posthog from 'posthog-js'
import { LayoutControls } from './layout-controls'
import { CommunityLookbookGrid, LookbookFilterNav } from './community-lookbook-grid'
import type { FilterCategory } from './community-lookbook-grid'
import { PlannerRail } from './planner-rail'

export function LookbookPrismLayout() {
  const [isComparisonMode, setIsComparisonMode] = useState(false)
  const [isMobilePreview, setIsMobilePreview] = useState(false)
  const [isPlannerRailOpen, setIsPlannerRailOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterCategory>('New')

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
      data-testid="lookbook-prism-container"
      className={`lookbook-body w-full bg-[#FFFFFF] text-[#111111] motion-safe:transition-[max-width,box-shadow] motion-safe:duration-300 motion-reduce:transition-none ${
        isMobilePreview
          ? 'my-6 mx-auto max-w-[375px] overflow-hidden rounded-[32px] border-4 border-[#111111] bg-[#FFFFFF] p-4 shadow-2xl'
          : 'mx-auto max-w-[1440px] px-4 py-8 sm:px-6'
      }`}
    >
      <div className="mb-8">
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
      </div>

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
          tabIndex={0}
          className={`flex flex-col gap-6 rounded-[8px] border border-[#E6E6ED] bg-[#F5F5F7] p-6 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A] ${
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
                <div
                  tabIndex={0}
                  className="group rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-6 motion-safe:transition-colors motion-safe:duration-300 motion-safe:hover:border-[#C9A14A] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span className="lookbook-metrics text-xs uppercase text-[#8A691F]">
                      Commute Ready
                    </span>
                    <span className="lookbook-metrics text-xs text-[#5C5C66]">
                      Match Score: 96%
                    </span>
                  </div>
                  <h4 className="lookbook-display mb-2 text-lg font-semibold text-[#111111]">
                    Double-Breasted Blazer & Silk Knit
                  </h4>
                  <p className="mb-4 text-xs leading-relaxed text-[#36363D]">
                    Optimized for 18°C morning train commute transitioning into
                    air-conditioned office.
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
                  <div
                    tabIndex={0}
                    className="space-y-3 rounded-[8px] border border-[#C9A14A] bg-[#FFFFFF] p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
                  >
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
                  <div
                    tabIndex={0}
                    className="space-y-3 rounded-[8px] border border-[#E6E6ED] bg-[#FFFFFF] p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
                  >
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
          />
        </section>

        {/* Ultrawide Column / Slot 3: Planner Rail Container */}
        {!isMobilePreview && (
          <div className="hidden min-[1440px]:block">
            {isPlannerRailOpen ? (
              <PlannerRail isOpen onClose={() => setIsPlannerRailOpen(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setIsPlannerRailOpen(true)}
                className="w-full rounded-[8px] border border-[#C9A14A] bg-[#FFFFFF] px-4 py-3 text-sm font-semibold text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
              >
                Open planner rail
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <LayoutControls
          isComparisonMode={isComparisonMode}
          onToggleComparison={() => setIsComparisonMode((currentValue) => !currentValue)}
          isMobilePreview={isMobilePreview}
          onToggleMobilePreview={() =>
            setIsMobilePreview((currentValue) => !currentValue)
          }
        />
      </div>
    </div>
  )
}
