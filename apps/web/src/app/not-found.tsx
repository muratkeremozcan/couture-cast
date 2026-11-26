'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../i18n'
import { AppPage, APP_MAIN_CLASS } from './components/app-page'
import { AppTopBar } from './components/app-top-bar'

// Story CC-7.9 D6, D7: the shared top bar (back to Home) on the page surface.
export default function NotFound() {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <AppPage>
      <AppTopBar title={t('shell.notFound.title')} backHref="/" />
      <main
        id="main-content"
        tabIndex={-1}
        className={`${APP_MAIN_CLASS} items-start gap-4`}
      >
        <p className="text-base text-ink-soft">{t('shell.notFound.body')}</p>
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-ink"
        >
          {t('shell.goHome')}
        </Link>
      </main>
    </AppPage>
  )
}
