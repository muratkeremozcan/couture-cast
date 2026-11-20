'use client'
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { useCallback, useEffect, useRef, useState } from 'react'
import { onWebSessionIdentity, webSessionIdentity } from './web-session'

/**
 * For a page that reads the bearer once at mount. A read that ran before this tab held a
 * verified bearer (a new tab, or a mount while verification was still running) fails with
 * "Your session expired"; the page reports any failed mount read through `missed`. The next
 * verified identity published after it bumps `attempt`, so an effect keyed on `attempt` reads
 * again with the bearer now stored. Nothing is polled: it listens to the same identity
 * publication every other session consumer uses, and a publication with no member (a sign-out)
 * retries nothing.
 */
export function useRetryOnVerifiedSession(): { attempt: number; missed: () => void } {
  const [attempt, setAttempt] = useState(0)
  const missedRef = useRef(false)
  useEffect(
    () =>
      onWebSessionIdentity(() => {
        if (!missedRef.current || webSessionIdentity() === null) return
        missedRef.current = false
        setAttempt((current) => current + 1)
      }),
    []
  )
  const missed = useCallback(() => {
    missedRef.current = true
  }, [])
  return { attempt, missed }
}
