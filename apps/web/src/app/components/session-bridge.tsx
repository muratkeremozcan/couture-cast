'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { activateBrowserLocale, syncDocumentLanguage } from '../../i18n'
import { applyLandingSession, readLandingSession } from '../../lib/landing-session'
import { releaseThemeOfDepartedOwner } from '../../lib/premium-theme'
import { currentWebSessionOwner } from '../../lib/use-web-session'
import { resolveFederatedFinishRoute, startWebSession } from '../../lib/web-session'
import { webGuestPreviewBirthdate } from '../../lib/guest-preview-birthdate'

// The legal pages stay readable mid-signup: Google's consent screen and the finish step link there.
const FINISH_EXEMPT_PATHS = ['/signup/finish', '/auth/callback', '/privacy', '/terms']
const PREVIEW_AUTH_PATHS = ['/signup', '/signin', '/signup/finish']

function clearAbandonedPreviewBirthdate(pathname: string) {
  if (pathname === '/preview') return
  const from = new URLSearchParams(window.location.search).get('from')
  if (from !== 'preview' || !PREVIEW_AUTH_PATHS.includes(pathname)) {
    webGuestPreviewBirthdate.clear()
  }
}

/**
 * Story 6.17 D3: a stored identity with no account (a reload, a closed tab, a new tab, or a
 * client-side link out of a legal page) goes back to the finish step. The server's status
 * decides; nothing branches on the provider.
 */
function resumeFederatedFinish() {
  if (FINISH_EXEMPT_PATHS.includes(window.location.pathname)) return
  void resolveFederatedFinishRoute()
    .then((href) => {
      if (href && !FINISH_EXEMPT_PATHS.includes(window.location.pathname))
        window.location.replace(href)
    })
    .catch(() => undefined)
}
/** Keeps <html data-session> current (lib/landing-session.ts). */
function syncLandingSession(settled: boolean) {
  applyLandingSession(readLandingSession(settled))
}

export function SessionBridge() {
  // The bridge mounts once in the root layout, so a client-side navigation (a Link from
  // /privacy to /) never remounts it; the resume runs again on every route change instead.
  const pathname = usePathname()
  const [sessionReady, setSessionReady] = useState(false)
  useEffect(() => {
    clearAbandonedPreviewBirthdate(pathname)
    if (sessionReady) resumeFederatedFinish()
    syncLandingSession(sessionReady)
  }, [pathname, sessionReady])
  useEffect(() => {
    // A sign-in or sign-out in this tab, a session change in another tab (storage), a return
    // to the tab, and a page restored from Safari's back-forward cache all re-read the session.
    const sync = () => syncLandingSession(sessionReady)
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync()
    }
    window.addEventListener('couture:session', sync)
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('couture:session', sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [sessionReady])
  useEffect(() => {
    // A member's palette lives on <html>, which outlives Settings: it leaves with that member
    // wherever the session changes (Settings Codex review 1, finding 7).
    const releaseTheme = () => releaseThemeOfDepartedOwner(currentWebSessionOwner())
    window.addEventListener('couture:session', releaseTheme)
    window.addEventListener('storage', releaseTheme)
    return () => {
      window.removeEventListener('couture:session', releaseTheme)
      window.removeEventListener('storage', releaseTheme)
    }
  }, [])
  useEffect(() => {
    const stopLanguageSync = syncDocumentLanguage()
    activateBrowserLocale()
    let stopped = false
    let cleanup: (() => void) | undefined
    void startWebSession()
      .then((stop) => {
        if (stopped) stop()
        else {
          cleanup = stop
          setSessionReady(true)
        }
      })
      .catch(() => undefined)
    return () => {
      stopped = true
      stopLanguageSync()
      cleanup?.()
    }
  }, [])
  return null
}
