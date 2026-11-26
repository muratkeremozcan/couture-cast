// Story 3.6 Task 1 step 1 owner: implement sticky chip navigation with keyboard arrow traversal and telemetry in apps/web/src/app/components/chip-navigation.tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

export type ChipCategory = 'Personal' | 'Community' | 'Sponsored'

export const CHIP_NAVIGATION_HEIGHT_PX = 77

const CHIP_CATEGORIES: ChipCategory[] = ['Personal', 'Community', 'Sponsored']

/** Story CC-7.9 D9: the chip labels come from the catalogs; the category ids stay English. */
const CHIP_LABEL_KEYS: Record<ChipCategory, string> = {
  Personal: 'landing.chips.personal',
  Community: 'landing.chips.community',
  Sponsored: 'landing.chips.sponsored',
}

export interface ChipNavigationProps {
  activeCategory: ChipCategory
  onCategoryChange: (category: ChipCategory) => void
  surface?: 'web' | 'mobile'
}

export function ChipNavigation({
  activeCategory,
  onCategoryChange,
  surface = 'web',
}: ChipNavigationProps) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const activeIndex = CHIP_CATEGORIES.indexOf(activeCategory)
  const [focusIndex, setFocusIndex] = useState(activeIndex)

  useEffect(() => {
    setFocusIndex(activeIndex)
  }, [activeIndex])

  const handleSelectCategory = (category: ChipCategory) => {
    if (category === activeCategory) return
    const previousCategory = activeCategory
    onCategoryChange(category)

    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('chip_changed', {
          chipCategory: category,
          previousCategory,
          surface,
        })
      }
    } catch {
      // Telemetry failure isolation guard
    }
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      nextIndex = (index + 1) % CHIP_CATEGORIES.length
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      nextIndex = (index - 1 + CHIP_CATEGORIES.length) % CHIP_CATEGORIES.length
    } else if (event.key === 'Home') {
      event.preventDefault()
      nextIndex = 0
    } else if (event.key === 'End') {
      event.preventDefault()
      nextIndex = CHIP_CATEGORIES.length - 1
    }

    if (nextIndex !== null) {
      const targetButton = buttonRefs.current[nextIndex]
      if (targetButton) {
        setFocusIndex(nextIndex)
        targetButton.focus()
        const category = CHIP_CATEGORIES[nextIndex]
        if (category) {
          handleSelectCategory(category)
        }
      }
    }
  }

  return (
    <nav
      aria-label={t('landing.chips.navLabel')}
      data-testid="chip-navigation-bar"
      style={{ height: CHIP_NAVIGATION_HEIGHT_PX }}
      className="sticky top-0 z-20 flex flex-col gap-2 border-b border-line bg-page/95 py-3 backdrop-blur"
    >
      <div
        role="group"
        aria-label={t('landing.chips.groupLabel')}
        className="flex items-center gap-2 overflow-x-auto snap-x snap-mandatory px-4 py-1 scrollbar-none"
      >
        {CHIP_CATEGORIES.map((category, index) => {
          const isActive = activeCategory === category

          return (
            <button
              key={category}
              ref={(el) => {
                buttonRefs.current[index] = el
              }}
              type="button"
              aria-pressed={isActive}
              tabIndex={focusIndex === index ? 0 : -1}
              onClick={() => {
                setFocusIndex(index)
                handleSelectCategory(category)
              }}
              onKeyDown={(e) => handleKeyDown(e, index)}
              data-testid={`chip-${category.toLowerCase()}`}
              className={`snap-start shrink-0 min-h-11 whitespace-nowrap rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-wider motion-safe:transition-all motion-safe:duration-200 motion-reduce:transition-none ${
                isActive
                  ? 'border-inverse bg-inverse text-on-inverse'
                  : 'border-line-strong bg-card text-ink-muted hover:text-ink'
              }`}
            >
              {t(CHIP_LABEL_KEYS[category])}
            </button>
          )
        })}
      </div>

      <div aria-live="polite" role="status" className="sr-only">
        {t('landing.chips.showing', { category: t(CHIP_LABEL_KEYS[activeCategory]) })}
      </div>
    </nav>
  )
}
