// Story 6.16 D1: one read of where the stored session stands, so Home and the guest preview
// choose the signed-in or guest state only after restoration. A read that finds no token
// is signed out; a read that throws is not proof of anything, so it is retried and then
// reported as unavailable with the stored session kept.
import { useCallback, useEffect, useState } from 'react'
import { resolveMobileAccessToken, subscribeMobileApplicationUser } from './mobile-auth'

export type MemberSessionState = 'restoring' | 'member' | 'signed-out' | 'unavailable'

export const MEMBER_SESSION_RETRY_MS = [1_000, 2_000, 4_000] as const

export function useMemberSessionState(): [MemberSessionState, () => void] {
  const [state, setState] = useState<MemberSessionState>('restoring')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const check = (retry = 0) => {
      clearTimeout(retryTimer)
      void resolveMobileAccessToken()
        .then((token) => {
          if (active) setState(token ? 'member' : 'signed-out')
        })
        .catch(() => {
          if (!active) return
          const delay = MEMBER_SESSION_RETRY_MS[retry]
          if (delay === undefined) setState('unavailable')
          else retryTimer = setTimeout(() => check(retry + 1), delay)
        })
    }
    check()
    const unsubscribe = subscribeMobileApplicationUser(() => check())
    return () => {
      active = false
      clearTimeout(retryTimer)
      unsubscribe()
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState('restoring')
    setAttempt((count) => count + 1)
  }, [])
  return [state, retry]
}
