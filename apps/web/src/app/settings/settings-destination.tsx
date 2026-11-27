import type { ReactNode } from 'react'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { StickyBottomNav } from '../components/sticky-bottom-nav'

export function SettingsDestination({
  topic,
  children,
}: {
  topic: string
  children: ReactNode
}) {
  return (
    <AppPage>
      <AppTopBar
        titleKey={`settings.profile.${topic}`}
        parentHref="/settings"
        wrapTitle
      />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
        {children}
      </main>
      <StickyBottomNav />
    </AppPage>
  )
}
