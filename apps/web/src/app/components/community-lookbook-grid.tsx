// Story 3.5 Task 2 step 1 owner: implement community lookbook filter chips, card grid, and ARIA live regions in apps/web/src/app/components/community-lookbook-grid.tsx
'use client'

import Image from 'next/image'
import posthog from 'posthog-js'
import { CHIP_NAVIGATION_HEIGHT_PX } from './chip-navigation'
import type { ChipCategory } from './chip-navigation'
import { formatGarmentAltText } from '@couture/utils'

export type FilterCategory = 'New' | 'Following' | 'Near me' | 'Brands'

export interface LookbookCardItem {
  id: string
  title: string
  location: string
  weatherTag: string
  imageUrl: string
  description: string
  saves: number
  imports: number
  applauds: number
}

const FILTER_TABS: FilterCategory[] = ['New', 'Following', 'Near me', 'Brands']

const MOCK_LOOKBOOK_ITEMS: Record<FilterCategory, LookbookCardItem[]> = {
  New: [
    {
      id: 'look-1',
      title: 'Milan Autumn Wool Trench',
      location: 'Milan, IT',
      weatherTag: '14°C Crisp Air',
      imageUrl:
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&auto=format&fit=crop',
      description:
        'Structured wool trench paired with silk scarf and leather Chelsea boots for transitional autumn humidity.',
      saves: 142,
      imports: 38,
      applauds: 210,
    },
    {
      id: 'look-2',
      title: 'Tokyo Rain Resilience Layer',
      location: 'Tokyo, JP',
      weatherTag: '18°C Drizzle',
      imageUrl:
        'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&auto=format&fit=crop',
      description:
        'Water-repellent technical blazer with tailored ankle trousers and waterproof footwear.',
      saves: 98,
      imports: 24,
      applauds: 156,
    },
  ],
  Following: [
    {
      id: 'look-3',
      title: 'Parisian Silk & Cashmere Blend',
      location: 'Paris, FR',
      weatherTag: '16°C Breezy',
      imageUrl:
        'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&auto=format&fit=crop',
      description:
        'Lightweight cashmere turtleneck with pleated midi skirt and oversized gold hoops.',
      saves: 312,
      imports: 89,
      applauds: 450,
    },
  ],
  'Near me': [
    {
      id: 'look-4',
      title: 'SoHo Commuter Minimalist',
      location: 'New York, US',
      weatherTag: '21°C Sun',
      imageUrl:
        'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?w=600&auto=format&fit=crop',
      description:
        'Breathable linen blend trousers with monochrome poplin shirt and leather tote.',
      saves: 85,
      imports: 19,
      applauds: 120,
    },
  ],
  Brands: [
    {
      id: 'look-5',
      title: 'Couture House Archive Ensemble',
      location: 'London, UK',
      weatherTag: '15°C Overcast',
      imageUrl:
        'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&auto=format&fit=crop',
      description:
        'Tailored houndstooth jacket with recycled wool knitwear and signature gold buttons.',
      saves: 520,
      imports: 140,
      applauds: 890,
    },
  ],
}

export function findLookbookFilterByCardId(cardId: string): FilterCategory | undefined {
  return FILTER_TABS.find((filter) =>
    MOCK_LOOKBOOK_ITEMS[filter].some((item) => item.id === cardId)
  )
}

export interface LookbookFilterNavProps {
  activeTab: FilterCategory
  isMobilePreview: boolean
  onTabChange: (tab: FilterCategory) => void
}

export function LookbookFilterNav({
  activeTab,
  isMobilePreview,
  onTabChange,
}: LookbookFilterNavProps) {
  const handleTabClick = (tab: FilterCategory) => {
    onTabChange(tab)
    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('layout_interaction', {
          action: 'filter_chip_click',
          target: tab.toLowerCase(),
        })
      }
    } catch {
      // Telemetry fallback
    }
  }

  return (
    <nav
      aria-label="Lookbook Filters"
      style={{ top: CHIP_NAVIGATION_HEIGHT_PX }}
      className="sticky z-10 flex flex-col gap-3 border-b border-[#E6E6ED] bg-[#FFFFFF]/95 py-3 backdrop-blur"
    >
      <div className="flex items-center justify-between">
        <h2 className="lookbook-display text-2xl font-semibold text-[#111111]">
          Living Community Lookbook
        </h2>
        <span className="lookbook-metrics text-xs uppercase text-[#8A691F]">
          Live Stream
        </span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto">
        {FILTER_TABS.map((tab) => {
          const isActive = activeTab === tab
          const tabletStyles = isMobilePreview
            ? ''
            : 'min-[768px]:rounded-full min-[768px]:border min-[768px]:px-4 min-[768px]:py-2'
          const activeStyles = isActive
            ? isMobilePreview
              ? 'border-[#C9A14A] text-[#111111]'
              : 'border-[#C9A14A] text-[#111111] min-[768px]:bg-[#C9A14A]'
            : isMobilePreview
              ? 'border-transparent text-[#5C5C66]'
              : 'border-transparent text-[#5C5C66] min-[768px]:border-[#E6E6ED] min-[768px]:bg-[#F5F5F7]'

          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              aria-pressed={isActive}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium uppercase tracking-wider motion-safe:transition-colors motion-safe:duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A] ${tabletStyles} ${activeStyles}`}
            >
              {tab}
            </button>
          )
        })}
      </div>
      <div aria-live="polite" role="status" className="sr-only">
        Showing {activeTab} lookbook posts
      </div>
    </nav>
  )
}

export interface CommunityLookbookGridProps {
  activeTab: FilterCategory
  isMobilePreview: boolean
  chipCategory?: ChipCategory
  highlightedCardId?: string
}

export function CommunityLookbookGrid({
  activeTab,
  isMobilePreview,
  chipCategory = 'Personal',
  highlightedCardId,
}: CommunityLookbookGridProps) {
  const currentItems = MOCK_LOOKBOOK_ITEMS[activeTab]

  return (
    <aside aria-label="Community Lookbook" className="flex flex-col gap-6">
      <div
        data-testid="community-card-grid"
        data-chip-category={chipCategory}
        className={`grid gap-6 ${
          isMobilePreview ? 'grid-cols-1' : 'grid-cols-1 min-[768px]:grid-cols-2'
        }`}
      >
        {currentItems.map((item) => {
          const isHighlighted = item.id === highlightedCardId
          return (
            <article
              key={item.id}
              id={`lookbook-card-${item.id}`}
              aria-labelledby={`lookbook-card-title-${item.id}`}
              tabIndex={-1}
              data-highlighted={isHighlighted ? 'true' : 'false'}
              className={`flex flex-col overflow-hidden rounded-[8px] border bg-[#F5F5F7] shadow-sm motion-safe:transition-[border-color,box-shadow] motion-safe:duration-300 motion-safe:hover:border-[#C9A14A] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A] ${
                isHighlighted
                  ? 'border-[#C9A14A] outline outline-2 outline-[#111111] ring-2 ring-[#C9A14A] ring-offset-2 shadow-lg'
                  : 'border-[#E6E6ED]'
              }`}
            >
              <div
                data-testid={`lookbook-image-${item.id}`}
                className="relative flex h-64 w-full items-center justify-center overflow-hidden bg-gradient-to-br from-[#E6E6ED] to-[#C9A14A]/40"
              >
                <span
                  aria-hidden="true"
                  className="lookbook-display text-4xl text-[#361F1F]/30"
                >
                  CC
                </span>
                <Image
                  src={item.imageUrl}
                  alt={formatGarmentAltText(item.title, [item.description], 'en-US')}
                  fill
                  unoptimized
                  sizes="(min-width: 768px) 50vw, 100vw"
                  onError={(event) => {
                    event.currentTarget.hidden = true
                  }}
                  className="object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:scale-[1.02] motion-reduce:transition-none"
                />
                <div className="absolute left-3 top-3 flex items-center gap-2">
                  <span className="lookbook-metrics rounded-md border border-[#E6E6ED] bg-[#FFFFFF]/95 px-2.5 py-1 text-[10px] uppercase text-[#111111]">
                    {item.location}
                  </span>
                  <span className="lookbook-metrics rounded-md bg-[#C9A14A] px-2.5 py-1 text-[10px] font-semibold uppercase text-[#111111]">
                    {item.weatherTag}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col justify-between gap-3 p-6">
                <div className="space-y-2">
                  <h3
                    id={`lookbook-card-title-${item.id}`}
                    className="lookbook-display text-lg font-semibold text-[#111111]"
                  >
                    {item.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-[#36363D]">
                    {item.description}
                  </p>
                </div>

                <div className="lookbook-metrics flex items-center justify-between border-t border-[#E6E6ED] pt-3 text-xs text-[#5C5C66]">
                  <div className="flex items-center gap-4">
                    <span>❤️ {item.saves} saves</span>
                    <span>🔄 {item.imports} imports</span>
                  </div>
                  <span className="text-[#8A691F]">👏 {item.applauds}</span>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </aside>
  )
}
