'use client'
import { useEffect } from 'react'
import { resolveFederatedFinishRoute, startWebSession } from '../../lib/web-session'

const FINISH_EXEMPT_PATHS = ['/signup/finish', '/auth/callback']

/**
 * Story 6.17 D3: a stored identity with no account (a reload, a closed tab, a new tab) goes
 * back to the finish step. The server's status decides; nothing branches on the provider.
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
import { activateBrowserLocale, syncDocumentLanguage } from '../../i18n'
export function SessionBridge() {
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
          resumeFederatedFinish()
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
