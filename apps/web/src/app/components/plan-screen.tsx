// Story CC-7.11 D9 owner: Plan as a route under Looks (`/looks/plan`). It replaces the planner
// drawer that opened on Home.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { I18nextProvider } from 'react-i18next'
import { getI18n } from '../../i18n'
import { AppPage, APP_MAIN_NARROW_CLASS } from './app-page'
import { AppTopBar } from './app-top-bar'
import { PlannerRail } from './planner-rail'
import { StickyBottomNav } from './sticky-bottom-nav'

/** The query the old Home drawer link carried; next.config.ts passes it through its redirect. */
const LEGACY_PLANNER_QUERY = 'planner'

export function PlanScreen() {
  const router = useRouter()
  // `/?planner=1` redirects here with its query; the address bar drops it in place, so the
  // in-app history keeps one entry for this screen.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(LEGACY_PLANNER_QUERY)) return
    url.searchParams.delete(LEGACY_PLANNER_QUERY)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  return (
    <I18nextProvider i18n={getI18n()}>
      <AppPage>
        <AppTopBar titleKey="looks.plan" parentHref="/looks" />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          {/* The rail variant is ordinary page content (no focus trap); the top bar carries
              its title and back, so the rail's own heading row and X are hidden. */}
          <PlannerRail
            isOpen
            variant="rail"
            hideHeader
            onClose={() => {
              router.replace('/looks')
            }}
          />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}
