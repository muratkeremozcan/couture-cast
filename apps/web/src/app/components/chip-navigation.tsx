// Story 3.6 Task 1 step 1 owner: implement sticky chip navigation with keyboard arrow traversal and telemetry in apps/web/src/app/components/chip-navigation.tsx
'use client'

import React, { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'

export type ChipCategory = 'Personal' | 'Community' | 'Sponsored'

export const CHIP_NAVIGATION_HEIGHT_PX = 77

const CHIP_CATEGORIES: ChipCategory[] = ['Personal', 'Community', 'Sponsored']

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
      aria-label="Filter recommendations by category"
      data-testid="chip-navigation-bar"
      style={{ height: CHIP_NAVIGATION_HEIGHT_PX }}
      className="sticky top-0 z-20 flex flex-col gap-2 border-b border-[#E6E6ED] bg-[#FFFFFF]/95 py-3 backdrop-blur"
    >
      <div
        role="group"
        aria-label="Category filters"
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
              className={`snap-start min-h-[44px] whitespace-nowrap rounded-full border px-5 py-2.5 text-xs font-semibold uppercase tracking-wider motion-safe:transition-all motion-safe:duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A] ${
                isActive
                  ? 'border-[#C9A14A] bg-[#C9A14A] text-[#111111] shadow-sm'
                  : 'border-[#E6E6ED] bg-[#F5F5F7] text-[#5C5C66] hover:border-[#C9A14A]/60 hover:text-[#111111]'
              }`}
            >
              {category}
            </button>
          )
        })}
      </div>

      <div aria-live="polite" role="status" className="sr-only">
        Showing {activeCategory} recommendations
      </div>
    </nav>
  )
}
