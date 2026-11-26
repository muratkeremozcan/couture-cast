// Story 3.6 Task 2 step 1 owner: implement mobile sticky bottom navigation bar with gold active indicator and safe-area insets in apps/web/src/app/components/sticky-bottom-nav.tsx
// Story 5.4 Task 7 step 3 owner: own the longest-prefix active-tab resolution in `apps/web/src/app/components/sticky-bottom-nav.tsx`
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

export type NavTabId = 'home' | 'wardrobe' | 'community' | 'settings'

export interface NavTabItem {
  id: NavTabId
  /** The English name analytics records, whatever the reader's language. */
  label: string
  /** The catalog key the tab shows. */
  labelKey: string
  href: string
  icon: string
}

/**
 * The settings tab reads Profile (2026-11-19: Jade looked for a profile and
 * never found it under Settings). Its id and route stay `settings`.
 */
const NAV_TABS: NavTabItem[] = [
  { id: 'home', label: 'Home', labelKey: 'nav.home', href: '/', icon: '🏠' },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    labelKey: 'nav.wardrobe',
    href: '/wardrobe',
    icon: '👔',
  },
  {
    id: 'community',
    label: 'Community',
    labelKey: 'nav.community',
    href: '/community',
    icon: '✨',
  },
  {
    id: 'settings',
    label: 'Profile',
    labelKey: 'nav.profile',
    href: '/settings',
    icon: '👤',
  },
]

export interface StickyBottomNavProps {
  isMobilePreview?: boolean
}

/**
 * The tab that owns `pathname`, or null when no tab does.
 *
 * Story 5.4 replaced an exact-equality match here. `NAV_TABS.find((tab) =>
 * tab.href === pathname)` meant every nested route fell back to Home:
 * `/wardrobe/capsules` and `/wardrobe/onboarding` both highlighted Home while
 * sitting under the Wardrobe tab, which told the reader they were somewhere
 * they were not.
 *
 * Longest-prefix, with `'/'` matching only exactly. Without that carve-out
 * Home's href is a prefix of every path in the app and would win everywhere.
 * The boundary check (`/` or end-of-string after the href) is what stops
 * `/wardrobe-silhouette` from claiming the `/wardrobe` tab.
 *
 * Null is a real answer, not a failure: `/palette` is a destination route that
 * belongs to no tab, and highlighting Home there would be the same lie the
 * exact match told about `/wardrobe/capsules`.
 */
export function resolveActiveNavTab(pathname: string | null): NavTabId | null {
  if (!pathname) {
    return null
  }
  const matches = NAV_TABS.filter((tab) =>
    tab.href === '/'
      ? pathname === '/'
      : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
  )
  return (
    matches.reduce<NavTabItem | null>(
      (best, tab) => (best === null || tab.href.length > best.href.length ? tab : best),
      null
    )?.id ?? null
  )
}

export function StickyBottomNav({ isMobilePreview = false }: StickyBottomNavProps) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const pathname = usePathname()
  const activeTab = resolveActiveNavTab(pathname)
  // The tab whose arrival the status region announces; null announces nothing.
  const [announced, setAnnounced] = useState<NavTabItem | null>(
    () => NAV_TABS.find((tab) => tab.id === activeTab) ?? null
  )
  const announcement =
    announced === null ? '' : t('nav.navigatedTo', { label: t(announced.labelKey) })

  const handleTabClick = (tab: NavTabItem) => {
    setAnnounced(tab)

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

  return (
    <nav
      aria-label={t('nav.label')}
      data-testid="sticky-bottom-nav"
      // Story CC-7.9 D1, D6: the tab bar sits on the page surface at the shell's 56 px plus the
      // device's bottom safe area.
      className={`bottom-0 left-0 right-0 z-30 border-t border-line bg-page/95 pb-safe backdrop-blur ${
        isMobilePreview ? 'sticky flex' : 'fixed flex min-[768px]:hidden'
      }`}
    >
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-around px-2">
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id

          return (
            <Link
              key={tab.id}
              href={tab.href}
              // Story CC-7.7 D5: a tab switch keeps the window where it is; the screen gate of the
              // tab it opens restores that tab's own scroll, or starts a first visit at the top.
              scroll={false}
              data-testid={`bottom-nav-${tab.id}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleTabClick(tab)}
              className="relative flex h-full min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-xs font-medium text-ink sm:px-3"
            >
              <span aria-hidden="true" className="text-base leading-none">
                {tab.icon}
              </span>
              <span
                className={`text-xs uppercase tracking-wider ${
                  isActive ? 'font-semibold text-ink' : 'text-ink-muted'
                }`}
              >
                {t(tab.labelKey)}
              </span>
              {isActive && (
                <span
                  data-testid="gold-active-indicator"
                  data-gold="tab"
                  className="absolute bottom-0 left-2 right-2 h-1 rounded-full bg-tab-active"
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
}
