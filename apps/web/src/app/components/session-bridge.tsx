'use client'
import { useEffect } from 'react'
import { startWebSession } from '../../lib/web-session'
import { activateBrowserLocale } from '../../i18n'
export function SessionBridge() {
  useEffect(() => {
    activateBrowserLocale()
    let stopped = false
    let cleanup: (() => void) | undefined
    void startWebSession()
      .then((stop) => {
        if (stopped) stop()
        else cleanup = stop
      })
      .catch(() => undefined)
    return () => {
      stopped = true
      cleanup?.()
    }
  }, [])
  return null
}
