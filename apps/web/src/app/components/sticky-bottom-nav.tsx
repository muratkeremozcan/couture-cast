// Story 3.6 Task 2 step 1 owner: implement mobile sticky bottom navigation bar with gold active indicator and safe-area insets in apps/web/src/app/components/sticky-bottom-nav.tsx
// Story 5.4 Task 7 step 3 owner: own the longest-prefix active-tab resolution in `apps/web/src/app/components/sticky-bottom-nav.tsx`
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'
import { useTranslation } from 'react-i18next'
import { APP_TABS, type AppTabId } from '@couture/utils'
import { getI18n } from '../../i18n'
import { TabIcon } from './tab-icon'

export type NavTabId = AppTabId

export interface NavTabItem {
  id: NavTabId
  /** The English name analytics records, whatever the reader's language. */
  label: string
  /** The catalog key the tab shows. */
  labelKey: string
  href: string
}

/**
 * Story CC-7.11 D1, D2: the five tabs, in order, from the one shared definition. Ids and routes
 * keep their names (the Today tab is `home` at `/`, Closet is `wardrobe`, Profile is `settings`).
 */
export const NAV_TABS: readonly NavTabItem[] = APP_TABS.map((tab) => ({
  id: tab.id,
  label: tab.label,
  labelKey: `nav.${tab.labelKey}`,
  href: tab.webHref,
}))

export interface StickyBottomNavProps {
  isMobilePreview?: boolean
}

/** D10: sub-screens whose parent tab differs from their path prefix. */
const SUB_SCREEN_TABS: Readonly<Record<string, NavTabId>> = {
  '/palette': 'settings',
  '/notification-settings': 'settings',
  '/guardian/dashboard': 'settings',
  '/teen/dashboard': 'settings',
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
 * Story CC-7.11 D10: a sub-screen whose parent tab is not its path prefix names that tab in
 * `SUB_SCREEN_TABS` (capsules moved to Looks; palette, notification settings and the guardian
 * and teen dashboards are Profile rows). Null is still a real answer for a route under no tab.
 */
export function resolveActiveNavTab(pathname: string | null): NavTabId | null {
  if (!pathname) {
    return null
  }
  const parent = SUB_SCREEN_TABS[pathname]
  if (parent !== undefined) return parent
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
      <div className="mx-auto flex h-tab-bar w-full max-w-md items-center justify-around">
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
              // Story CC-7.11 D3, P6: the active tab is gold (`tabActive`), semibold and
              // underlined; the icon takes the label color. Five tabs share the row equally with no
              // side padding, so at 320 px each has 64 px. Geist at 12 px measures "Community" at
              // 67 px semibold, so the active Community label wraps there, as D3 allows.
              data-gold={isActive ? 'tab' : undefined}
              className={`relative flex h-full min-h-touch min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md ${
                isActive ? 'font-semibold text-tab-active' : 'font-medium text-ink-muted'
              }`}
            >
              <TabIcon id={tab.id} />
              {/* D3: 12 px (text-xs) in sentence case at every size. A label too wide for its
                  tab wraps to a second line, inside a word when it must ("Community" at 320 px
                  has about 58 px), hyphenated where the language allows; it is never cut,
                  overflowed or shrunk below 12 px. */}
              <span className="max-w-full hyphens-auto text-center text-xs leading-tight [overflow-wrap:anywhere]">
                {t(tab.labelKey)}
              </span>
              {isActive && (
                <span
                  data-testid="gold-active-indicator"
                  data-gold="tab"
                  // P6: the border keeps the underline visible under forced colors, where the
                  // system replaces backgrounds but draws borders in CanvasText.
                  className="absolute bottom-0 left-2 right-2 h-1 rounded-full border-2 border-tab-active bg-tab-active"
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
