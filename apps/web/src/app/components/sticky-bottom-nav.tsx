// Story 3.6 Task 2 step 1 owner: implement mobile sticky bottom navigation bar with gold active indicator and safe-area insets in apps/web/src/app/components/sticky-bottom-nav.tsx
'use client'

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'

export type NavTabId = 'home' | 'wardrobe' | 'community' | 'settings'

export interface NavTabItem {
  id: NavTabId
  label: string
  href: string
  icon: string
}

const NAV_TABS: NavTabItem[] = [
  { id: 'home', label: 'Home', href: '/', icon: '🏠' },
  { id: 'wardrobe', label: 'Wardrobe', href: '/wardrobe', icon: '👔' },
  { id: 'community', label: 'Community', href: '/community', icon: '✨' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: '⚙️' },
]

export interface StickyBottomNavProps {
  isMobilePreview?: boolean
}

export function StickyBottomNav({ isMobilePreview = false }: StickyBottomNavProps) {
  const pathname = usePathname()
  const activeTab = NAV_TABS.find((tab) => tab.href === pathname)?.id ?? 'home'
  const activeLabel = NAV_TABS.find((tab) => tab.id === activeTab)?.label ?? 'Home'
  const [announcement, setAnnouncement] = useState(`Navigated to ${activeLabel} tab`)

  const handleTabClick = (tab: NavTabItem) => {
    setAnnouncement(`Navigated to ${tab.label} tab`)

    try {
      if (typeof window !== 'undefined' && typeof posthog.capture === 'function') {
        posthog.capture('bottom_nav_clicked', {
          tabId: tab.id,
          label: tab.label,
          targetPath: tab.href,
        })
      }
    } catch {
      // Telemetry failure isolation guard
    }
  }

  const navigation = (
    <nav
      aria-label="Bottom Navigation"
      data-testid="sticky-bottom-nav"
      className={`bottom-0 left-0 right-0 z-30 border-t border-[#E6E6ED] bg-[#FFFFFF]/95 pt-2 backdrop-blur pb-[env(safe-area-inset-bottom,0.75rem)] ${
        isMobilePreview ? 'sticky flex' : 'fixed flex min-[768px]:hidden'
      }`}
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-around px-2">
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id

          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-testid={`bottom-nav-${tab.id}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleTabClick(tab)}
              className="relative flex min-h-[44px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
            >
              <span aria-hidden="true" className="text-base">
                {tab.icon}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wider ${
                  isActive ? 'font-semibold text-[#111111]' : 'text-[#5C5C66]'
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span
                  data-testid="gold-active-indicator"
                  className="absolute bottom-0 h-1 w-full rounded-t-full bg-[#C9A14A]"
                />
              )}
            </Link>
          )
        })}
      </div>
      <div
        aria-live="polite"
        role="status"
        className="sr-only"
        data-testid="bottom-nav-status"
      >
        {announcement}
      </div>
    </nav>
  )

  if (isMobilePreview) {
    return navigation
  }

  return typeof document === 'undefined' ? null : createPortal(navigation, document.body)
}
