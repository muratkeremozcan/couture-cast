// Production follow-up after the project close (2026-11-19): a reload of /settings told a
// signed-in member to sign in to manage their locations (our reproduction of Jade's session).
// The Locations section asked once, on mount, whether this tab held the bearer. A real session
// writes the bearer only after the profile check, and a new tab or a reload starts without it
// (or with a stale one the check clears first), so the answer it got was "signed out" and it
// never asked again.
//
// This hook follows the session instead: it listens for `couture:session`, which web-session.ts
// dispatches whenever verification names, changes or clears the member, and it treats a stored
// session that verification has not settled yet as `checking`, never as signed out. Only a
// verification that resolves with no member, or that the API refuses (401, 403, 404), means
// signed out; one that fails (a timeout, a 5xx) is `unavailable`, with a retry that verifies
// again. A bearer no verification named counts only as the e2e fixture bearer.
'use client'

import { useEffect, useState } from 'react'
import { hasWebSession } from './commerce'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import { readStorage } from './browser-persistence'
import {
  hasStoredWebSession,
  isE2EFixtureBearer,
  isWebSessionDenial,
  resolveWebSessionToken,
  webSessionIdentity,
} from './web-session'

export type WebSessionState =
  | { status: 'checking' }
  | { status: 'signed_out' }
  /** Verification failed; `retry` verifies the stored session again. */
  | { status: 'unavailable'; retry: () => void }
  /** `owner` changes when the member does, so a section reloads once per member. */
  | { status: 'signed_in'; owner: string }

/** The owner of the e2e fixture bearer, which no verification names. */
export const UNVERIFIED_BEARER_OWNER = 'bearer'

/** What this hook's own verification of the stored session concluded, if it finished. */
export type VerificationOutcome = 'pending' | 'no_member' | 'failed'

/**
 * Where the session stands right now, given what the last verification this hook asked for
 * concluded. A stored session reads as signed out only once verification resolved with no
 * member, so a refused account or an expired refresh does not stay `checking` forever, and a
 * failed verification never reads as signed out.
 */
export function readWebSessionState(
  outcome: VerificationOutcome,
  retry: () => void
): WebSessionState {
  const identity = webSessionIdentity()
  if (identity && hasWebSession()) return { status: 'signed_in', owner: identity }
  const stored = hasStoredWebSession()
  if (stored && outcome === 'failed') return { status: 'unavailable', retry }
  if (stored && outcome === 'pending') return { status: 'checking' }
  // A leftover bearer from another member's session is not a member: only the fixture counts.
  if (hasWebSession() && !stored && isE2EFixtureBearer(fixtureBearer()))
    return { status: 'signed_in', owner: UNVERIFIED_BEARER_OWNER }
  return { status: 'signed_out' }
}

function fixtureBearer(): string | null {
  return readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null
}

function sameState(a: WebSessionState, b: WebSessionState): boolean {
  if (a.status !== b.status) return false
  return a.status !== 'signed_in' || a.owner === (b as typeof a).owner
}

/**
 * The verified web session, following every change. Starts at `checking` on the server and on
 * the first client render, so a signed-in member never sees a signed-out state flash past.
 */
export function useWebSession(): WebSessionState {
  const [state, setState] = useState<WebSessionState>({ status: 'checking' })

  useEffect(() => {
    let active = true
    let outcome: VerificationOutcome = 'pending'
    let asked = false
    // Each verification this hook asks for; a completion from an older one is ignored.
    let attempt = 0

    const retry = () => {
      if (!active) return
      outcome = 'pending'
      asked = false
      sync()
    }

    function sync() {
      if (!active) return
      const next = readWebSessionState(outcome, retry)
      setState((current) => (sameState(current, next) ? current : next))
      if (next.status === 'signed_in') {
        // A later account switch clears the member before naming the next one: ask again
        // then, and ignore whatever an earlier verification still reports.
        outcome = 'pending'
        asked = false
        attempt += 1
        return
      }
      if (next.status !== 'checking' || asked) return
      // Join (or start) the verification of the stored session. Success also dispatches
      // `couture:session`; these settle the cases where it ends without a member or fails.
      asked = true
      const mine = ++attempt
      void resolveWebSessionToken().then(
        (token) => {
          if (!active || mine !== attempt) return
          if (token === undefined) outcome = 'no_member'
          sync()
        },
        (error: unknown) => {
          if (!active || mine !== attempt) return
          outcome = isWebSessionDenial(error) ? 'no_member' : 'failed'
          sync()
        }
      )
    }

    sync()
    window.addEventListener('couture:session', sync)
    window.addEventListener('storage', sync)
    return () => {
      active = false
      window.removeEventListener('couture:session', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return state
}
