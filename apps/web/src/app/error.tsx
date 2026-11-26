'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { browserAnalytics } from '../analytics/browser-analytics'
import { getI18n } from '../i18n'
import { AppPage, APP_MAIN_CLASS } from './components/app-page'
import { AppTopBar } from './components/app-top-bar'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  useEffect(() => {
    browserAnalytics.capture('error_page_viewed', {
      error_name: error.name,
      error_digest: error.digest ?? 'none',
    })
  }, [error.digest, error.name])

  const handleReset = () => {
    browserAnalytics.capture('error_reset_clicked', {
      error_name: error.name,
      error_digest: error.digest ?? 'none',
    })
    reset()
  }

  return (
    // Story CC-7.9 D6, D7: the shared top bar (back to Home) on the page surface.
    <AppPage>
      <AppTopBar title={t('shell.error.title')} parentHref="/" />
      <main
        id="main-content"
        tabIndex={-1}
        className={`${APP_MAIN_CLASS} items-start gap-4`}
      >
        <p className="text-base text-ink-soft">{error.message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReset}
            data-gold="primary"
            className="flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary"
          >
            {t('shell.error.retry')}
          </button>
          <Link
            href="/"
            className="flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-ink"
          >
            {t('shell.goHome')}
          </Link>
        </div>
      </main>
    </AppPage>
  )
}
