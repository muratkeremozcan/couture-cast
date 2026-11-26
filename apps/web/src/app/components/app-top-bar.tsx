// Story CC-7.9 D6 owner: the one web top bar every tab and routed sub-screen renders.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { resolveActiveNavTab, type NavTabId } from './sticky-bottom-nav'

export type AppTopBarProps = AppTopBarTitle & {
  /** A sub-screen's parent route. The back control renders only when this or `onBack` is set. */
  backHref?: string
  /** For a sub-screen that is not a route (the inline garment detail). */
  onBack?: () => void
  /** Actions that fit the one row. Anything that does not moves to the body's first row. */
  trailing?: ReactNode
}

/**
 * The current tab label or the sub-screen title: translated (`title`), or a catalog key the bar
 * translates (`titleKey`) so a server page can name its title without a translation hook.
 */
type AppTopBarTitle =
  | { title: string; titleKey?: never }
  | { titleKey: string; title?: never }

const DESKTOP_TABS: readonly {
  id: NavTabId
  href: string
  labelKey: string
  label: string
  testId: string
}[] = [
  { id: 'home', href: '/', labelKey: 'nav.home', label: 'Home', testId: 'nav-ritual' },
  {
    id: 'wardrobe',
    href: '/wardrobe',
    labelKey: 'nav.wardrobe',
    label: 'Wardrobe',
    testId: 'nav-wardrobe',
  },
  {
    id: 'community',
    href: '/community',
    labelKey: 'nav.community',
    label: 'Community',
    testId: 'nav-community',
  },
  {
    id: 'settings',
    href: '/settings',
    labelKey: 'nav.profile',
    label: 'Profile',
    testId: 'nav-profile',
  },
]

/**
 * D6: exactly 56 px high (`h-14`, border included), one row: optional back, the `h1` title and
 * an optional trailing slot. From 768 px, where the bottom nav hides, the trailing slot also
 * holds the tab links.
 */
export function AppTopBar({
  title,
  titleKey,
  backHref,
  onBack,
  trailing,
}: AppTopBarProps) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const heading = title ?? t(titleKey ?? '')
  const activeTab = resolveActiveNavTab(usePathname())
  const backLabel = t('shell.back')
  const backClass =
    'flex min-h-11 min-w-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink'

  return (
    <header
      data-testid="app-header"
      className="h-14 w-full shrink-0 border-b border-line bg-page text-ink"
    >
      <div className="mx-auto flex h-full max-w-6xl items-center gap-2 px-4">
        {backHref !== undefined ? (
          <Link href={backHref} data-testid="app-top-bar-back" className={backClass}>
            <BackGlyph />
            <span>{backLabel}</span>
          </Link>
        ) : onBack !== undefined ? (
          <button
            type="button"
            data-testid="app-top-bar-back"
            onClick={onBack}
            className={backClass}
          >
            <BackGlyph />
            <span>{backLabel}</span>
          </button>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{heading}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {trailing}
          <nav
            aria-label={t('nav.primaryLabel')}
            data-testid="primary-nav"
            className="hidden items-center gap-1 md:flex"
          >
            {DESKTOP_TABS.map((tab) => {
              const active = activeTab === tab.id
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  scroll={false}
                  data-testid={tab.testId}
                  aria-current={active ? 'page' : undefined}
                  data-ph-event="nav_link_clicked"
                  data-ph-label={tab.label}
                  data-ph-href={tab.href}
                  className={`flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm ${
                    active
                      ? 'font-semibold text-ink underline underline-offset-8'
                      : 'text-ink-muted'
                  }`}
                >
                  {t(tab.labelKey)}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </header>
  )
}

function BackGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}
