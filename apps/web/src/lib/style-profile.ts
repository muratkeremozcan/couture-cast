'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { requestStyleProfile, ResponseError } from '@couture/api-client'
import { createStyleProfileStore, type StyleProfilePatch } from '@couture/utils'
import { createWebApiClient } from './api-client'
import {
  captureWebStyleBearer,
  currentWebSessionOwner,
  currentWebStyleScope,
  readAsMember,
  subscribeWebStyleScope,
  useWebStyleScope,
} from './use-web-session'

const store = createStyleProfileStore(currentWebStyleScope, async (scope, operation) => {
  const owner = currentWebSessionOwner()
  if (!owner) throw new Error('Style session changed.')
  return readAsMember(
    owner,
    () => {
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
    },
    (error) => error instanceof ResponseError && error.response.status === 401
  )
})

// Clear the leaving member's state even when every style surface is unmounted.
if (typeof window !== 'undefined') subscribeWebStyleScope(store.refreshDay)

const serverSnapshot = {
  profile: null,
  status: 'idle',
  saving: false,
  day: null,
} as const

export async function saveWebStyleProfileForScope(
  scope: string,
  input: StyleProfilePatch
) {
  if (
    currentWebStyleScope() !== scope ||
    !(await store.save(scope, input, { propagateError: true }))
  ) {
    throw new Error('Unable to save style profile for this session.')
  }
}

export function useWebStyleProfile() {
  const scope = useWebStyleScope()
  const state = useSyncExternalStore(store.subscribe, store.read, () => serverSnapshot)
  useEffect(() => {
    if (scope) void store.load(scope)
  }, [scope])
  return { ...state, scope, store }
}
