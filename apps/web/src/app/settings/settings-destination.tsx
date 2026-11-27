'use client'

import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { getI18n } from '../../i18n'
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
    <I18nextProvider i18n={getI18n()}>
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
    </I18nextProvider>
  )
}
