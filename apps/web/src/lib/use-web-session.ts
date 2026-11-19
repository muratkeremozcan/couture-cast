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

import {
  createElement,
  Fragment,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
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

/**
 * The member this tab holds right now, read synchronously from the session bridge: what a late
 * completion compares with the member who started its work, before any follow-up request.
 */
export function currentWebSessionOwner(): string | null {
  const identity = webSessionIdentity()
  if (identity && hasWebSession()) return identity
  if (hasWebSession() && !hasStoredWebSession() && isE2EFixtureBearer(fixtureBearer()))
    return UNVERIFIED_BEARER_OWNER
  return null
}

function subscribeWebSessionOwner(onChange: () => void): () => void {
  window.addEventListener('couture:session', onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener('couture:session', onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * The member this tab holds, read as an external store: a render always sees the owner the
 * session bridge names at that moment, and a change re-renders before any effect runs. A parent
 * keys member-owned UI by it, so the next member's first render holds none of the last one's.
 */
export function useWebSessionOwner(): string | null {
  return useSyncExternalStore(
    subscribeWebSessionOwner,
    currentWebSessionOwner,
    () => null
  )
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

/**
 * The session as a member-owned section reads it (2026-11-19 follow-up: Shopping and partners,
 * Premium, Interface palettes, the palette advisor and the planner rail each asked once, on
 * mount, and told a signed-in member to sign in). One shape for every section:
 *
 * - `checking`: render the section's loading state, ask nothing member-owned;
 * - `signed_in`: `owner` names the verified member, load that member's data once;
 * - `signed_out`: verification settled with no member, render the signed-out state;
 * - `unavailable`: verification failed, render the section's load error, and `retry`
 *   verifies again.
 */
export type MemberSession = {
  status: WebSessionState['status']
  /** The verified member, set only while `status` is `signed_in`. */
  owner: string | null
  /** Verifies the stored session again; does nothing unless `status` is `unavailable`. */
  retry: () => void
}

const NO_RETRY = () => undefined

export function memberSessionOf(state: WebSessionState): MemberSession {
  return {
    status: state.status,
    owner: state.status === 'signed_in' ? state.owner : null,
    retry: state.status === 'unavailable' ? state.retry : NO_RETRY,
  }
}

/**
 * True only while `owner` is the member the session bridge names right now. A section checks it
 * before it sends member-owned work and again before a late answer touches its state, so an
 * answer for one member never lands on another's section, or after sign-out.
 */
export function isLiveOwner(owner: string | null): owner is string {
  return owner !== null && currentWebSessionOwner() === owner
}

/** `useWebSession`, in the shape member-owned sections read. */
export function useMemberSession(): MemberSession {
  const state = useWebSession()
  return useMemo(() => memberSessionOf(state), [state])
}

/** The scope key of a tab no member holds. */
export const NO_MEMBER_SCOPE = 'no-member'

/**
 * Renders member-owned UI keyed by the member the session bridge names right now, so a change of
 * member (or sign-out) discards the last member's data, busy state and errors in the same render,
 * before any effect runs. The session follower sits above the key: a member change starts no
 * second verification.
 */
export function MemberScope({
  children,
}: {
  children: (session: MemberSession) => ReactNode
}) {
  const liveOwner = useWebSessionOwner()
  const session = useMemberSession()
  return createElement(Fragment, { key: liveOwner ?? NO_MEMBER_SCOPE }, children(session))
}

/** The bearer this tab holds right now, read where a member request reads it. */
export function currentWebSessionBearer(): string | null {
  return fixtureBearer()
}

/**
 * One member read, with the bearer read at the moment it is sent. A denial (`isDenial`) of a
 * bearer the bridge has since replaced for the same member says nothing about that member: the
 * read is retried once with the current bearer. A denial of the current bearer stands.
 */
export async function readAsMember<T>(
  owner: string,
  read: () => Promise<T>,
  isDenial: (error: unknown) => boolean
): Promise<T> {
  const sentWith = currentWebSessionBearer()
  try {
    return await read()
  } catch (error: unknown) {
    if (!isDenial(error) || !isLiveOwner(owner) || currentWebSessionBearer() === sentWith)
      throw error
    return read()
  }
}

/**
 * The signal of the current mount: aborted when the component unmounts (a route change, or a
 * member change that remounts a `MemberScope`). An operation captures it when it starts and
 * checks it before every completion, so an answer that arrives after its mount is gone never
 * navigates, opens a tab or touches state.
 */
export function useMountSignal(): () => AbortSignal {
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => {
    // A remount (StrictMode re-runs this effect) starts a fresh lifetime.
    const live = controllerRef.current
    const controller = live && !live.signal.aborted ? live : new AbortController()
    controllerRef.current = controller
    return () => controller.abort()
  }, [])
  return useCallback(() => {
    // Before the first effect (never for a user action) the mount counts as live.
    controllerRef.current ??= new AbortController()
    return controllerRef.current.signal
  }, [])
}
