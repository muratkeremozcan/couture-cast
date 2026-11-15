'use client'
// Story 6.16: React view of the web guest preview store, kept in step with other tabs.
import { useEffect, useState } from 'react'
import type { GuestPreviewSnapshot, GuestPreviewStore } from '@couture/utils'
import { GUEST_PREVIEW_STORAGE_KEY } from '../../../lib/guest-preview'

export function useGuestPreviewSnapshot(store: GuestPreviewStore, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<GuestPreviewSnapshot | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    const unsubscribe = store.subscribe((next) => {
      if (active) setSnapshot(next)
    })
    void store.load().then((loaded) => {
      if (active) setSnapshot(loaded)
    })
    // TEA-6: an exit, reset or sign-in in another tab is adopted here, and this tab's
    // queued writes from before it are dropped.
    const onStorage = (event: StorageEvent) => {
      if (event.key === GUEST_PREVIEW_STORAGE_KEY || event.key === null) {
        void store.syncExternal()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('storage', onStorage)
    }
  }, [store, enabled])

  return snapshot
}
