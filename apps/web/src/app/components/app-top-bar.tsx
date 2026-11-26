// Story CC-7.9 D6 owner: the one web top bar every tab and routed sub-screen renders.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_TABS } from '@couture/utils'
import { getI18n } from '../../i18n'
import { hasAppHistoryBelow } from '../../lib/app-history'
import { resolveActiveNavTab } from './sticky-bottom-nav'
import { TabIcon } from './tab-icon'

export type AppTopBarProps = AppTopBarTitle & {
  /**
   * A sub-screen's parent tab or screen (Story CC-7.11 D11). Back steps back through the in-app
   * history when the member came from inside the app, and replaces to this route on a direct
   * entry. The back control renders only when this or `onBack` is set.
   */
  parentHref?: string
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

/** Story CC-7.11 D1: the desktop links read the one tab definition the bottom bar reads. */
const DESKTOP_TABS = APP_TABS.map((tab) => ({
  id: tab.id,
  href: tab.webHref,
  labelKey: `nav.${tab.labelKey}`,
  label: tab.label,
  testId: tab.desktopTestId,
}))

/**
 * D6: exactly the shell top bar height, 56 px (`h-top-bar`, border included), one row:
 * optional back, the `h1` title and an optional trailing slot. From 768 px, where the bottom
 * nav hides, the trailing slot also holds the tab links.
 */
export function AppTopBar({
  title,
  titleKey,
  parentHref,
  onBack,
  trailing,
}: AppTopBarProps) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const heading = title ?? t(titleKey ?? '')
  const activeTab = resolveActiveNavTab(usePathname())
  const router = useRouter()
  const backLabel = t('shell.back')
  // D11: back follows in-app history; a direct entry (a cold load, a reload, a typed URL) has
  // none below it, so back replaces to the parent tab and never leaves the app.
  const followBack = (event: MouseEvent<HTMLAnchorElement>, parent: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (hasAppHistoryBelow()) {
      router.back()
      return
    }
    router.replace(parent)
  }
  const backClass =
    'flex min-h-touch min-w-touch shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink'

  return (
    <header
      data-testid="app-header"
      className="h-top-bar w-full shrink-0 border-b border-line bg-page text-ink"
    >
      {/* CC-7.11 P5: `app-top-bar` and `app-top-bar-title` name the same parts on web and
          native; `app-header` stays on the landmark. */}
      <div
        data-testid="app-top-bar"
        className="mx-auto flex h-full max-w-6xl items-center gap-2 px-4"
      >
        {parentHref !== undefined ? (
          <Link
            href={parentHref}
            data-testid="app-top-bar-back"
            onClick={(event) => followBack(event, parentHref)}
            className={backClass}
          >
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
        <h1
          data-testid="app-top-bar-title"
          className="min-w-0 flex-1 truncate text-lg font-semibold"
        >
          {heading}
        </h1>
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
                  // Review #4: the shared icon on every desktop link. From 768 to 1023 px the
                  // links show the icon alone (the name stays for assistive technology), so the
                  // bar keeps one row beside a screen's trailing actions; the label joins at
                  // 1024 px. The active link is semibold with a rule under it at every width.
                  className={`flex min-h-touch min-w-touch items-center justify-center gap-1 whitespace-nowrap rounded-md border-b-2 px-2 text-sm ${
                    active
                      ? 'border-ink font-semibold text-ink'
                      : 'border-transparent font-medium text-ink-muted'
                  }`}
                >
                  <TabIcon id={tab.id} />
                  <span className="sr-only lg:not-sr-only">{t(tab.labelKey)}</span>
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
