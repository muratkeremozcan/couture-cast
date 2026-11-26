// Story CC-7.11 D6 owner: Silhouette as a route (`/wardrobe/silhouette`), reached from the Closet
// More menu and Profile > Style. It replaces the modal that sat on `/wardrobe`.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { resolveCurrentUserId } from '../../lib/wardrobe'
import { useRetryOnVerifiedSession } from '../../lib/session-retry'
import { useWebSessionOwner } from '../../lib/use-web-session'
import { AppPage, APP_MAIN_NARROW_CLASS } from './app-page'
import { AppTopBar } from './app-top-bar'
import { SilhouetteSettingsPanel } from './silhouette-settings-panel'
import { StickyBottomNav } from './sticky-bottom-nav'

/** The account read the panel needs, for the signed-in member on this tab. */
function useSilhouetteUserId(owner: string | null) {
  const { attempt, missed } = useRetryOnVerifiedSession()
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ userId: string | null; failed: boolean }>({
    userId: null,
    failed: false,
  })
  useEffect(() => {
    if (!owner) {
      setState({ userId: null, failed: false })
      return
    }
    let live = true
    setState({ userId: null, failed: false })
    void resolveCurrentUserId()
      .then((userId) => {
        if (live) setState({ userId, failed: false })
      })
      .catch(() => {
        if (!live) return
        setState({ userId: null, failed: true })
        missed()
      })
    return () => {
      live = false
    }
  }, [owner, attempt, missed, retry])
  return { ...state, retry: () => setRetry((count) => count + 1) }
}

function SilhouetteBody() {
  const { t } = useTranslation()
  const owner = useWebSessionOwner()
  const { userId, failed, retry } = useSilhouetteUserId(owner)
  const [busy, setBusy] = useState(false)

  if (!owner) {
    return (
      <Link
        href="/signin"
        data-testid="silhouette-sign-in"
        className="flex min-h-touch w-fit items-center rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
      >
        {t('community.notifications.signin')}
      </Link>
    )
  }
  if (failed) {
    return (
      <div
        role="alert"
        className="flex min-h-touch items-center justify-between gap-2 rounded-lg border border-danger-line bg-danger-surface p-3 text-sm text-danger-ink"
      >
        <span>{t('wardrobe.hub.accountFailed')}</span>
        <button
          type="button"
          onClick={retry}
          className="min-h-touch px-2 font-semibold underline"
        >
          {t('feedback.retry')}
        </button>
      </div>
    )
  }
  if (!userId) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        {t('wardrobe.hub.loading')}
      </p>
    )
  }
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {busy ? t('wardrobe.hub.silhouetteSaving') : ''}
      </p>
      <SilhouetteSettingsPanel userId={userId} onBusyChange={setBusy} />
    </>
  )
}

/** D6, D10: the top bar with back (parent Closet) over the existing Silhouette panel. */
export function SilhouetteScreen() {
  return (
    <I18nextProvider i18n={getI18n()}>
      <AppPage>
        <AppTopBar titleKey="wardrobe.silhouette.title" parentHref="/wardrobe" />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          <SilhouetteBody />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}
