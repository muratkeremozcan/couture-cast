import { useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { requestStyleProfile } from '@couture/api-client'
import { createStyleProfileStore, type StyleProfilePatch } from '@couture/utils'
import { createMobileApiClient } from './api-client'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from './mobile-auth'

export function currentMobileStyleScope(): string | null {
  const owner = mobileApplicationUserId()
  return owner ? `${mobileIdentityEpoch()}:${owner}` : null
}

const store = createStyleProfileStore(
  currentMobileStyleScope,
  async (scope, operation) => {
    const accessToken = await resolveMobileAccessToken()
    if (!accessToken || currentMobileStyleScope() !== scope)
      throw new Error('Style session changed.')
    const api = createMobileApiClient({
      accessToken,
      fetchApi: (input, init) => {
        if (currentMobileStyleScope() !== scope) throw new Error('Style session changed.')
        return fetch(input, init)
      },
    })
    return requestStyleProfile(api, operation)
  }
)

// Clear the leaving member's state even when every style surface is unmounted.
subscribeMobileApplicationUser(store.refreshDay)

export async function saveMobileStyleProfileForScope(
  scope: string,
  input: StyleProfilePatch
) {
  if (currentMobileStyleScope() !== scope || !(await store.save(scope, input))) {
    throw new Error('Unable to save style profile for this session.')
  }
}

export function useMobileStyleProfile() {
  const scope = useSyncExternalStore(
    subscribeMobileApplicationUser,
    currentMobileStyleScope
  )
  const state = useSyncExternalStore(store.subscribe, store.read)
  useEffect(() => {
    if (!scope) return
    void store.load(scope)
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') store.refreshDay()
    })
    return () => subscription.remove()
  }, [scope])
  return { ...state, scope, store }
}
