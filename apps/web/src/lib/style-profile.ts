'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { requestStyleProfile } from '@couture/api-client'
import { createStyleProfileStore } from '@couture/utils'
import { createWebApiClient } from './api-client'
import {
  captureWebStyleBearer,
  currentWebStyleScope,
  subscribeWebStyleScope,
  useWebStyleScope,
} from './use-web-session'

const store = createStyleProfileStore(currentWebStyleScope, async (scope, operation) => {
  const accessToken = captureWebStyleBearer(scope)
  if (!accessToken) throw new Error('Style session changed.')
  const api = createWebApiClient({
    accessToken,
    fetchApi: (input, init) => {
      if (currentWebStyleScope() !== scope) throw new Error('Style session changed.')
      return fetch(input, init)
    },
  })
  return requestStyleProfile(api, operation)
})

// Clear the leaving member's state even when every style surface is unmounted.
if (typeof window !== 'undefined') subscribeWebStyleScope(store.refreshDay)

const serverSnapshot = {
  profile: null,
  status: 'idle',
  saving: false,
  day: null,
} as const

export function useWebStyleProfile() {
  const scope = useWebStyleScope()
  const state = useSyncExternalStore(store.subscribe, store.read, () => serverSnapshot)
  useEffect(() => {
    if (!scope) return
    void store.load(scope)
    window.addEventListener('focus', store.refreshDay)
    document.addEventListener('visibilitychange', store.refreshDay)
    return () => {
      window.removeEventListener('focus', store.refreshDay)
      document.removeEventListener('visibilitychange', store.refreshDay)
    }
  }, [scope])
  return { ...state, scope, store }
}
