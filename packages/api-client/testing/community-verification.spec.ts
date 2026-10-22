// Story 6.5 (D3): the verification clock that decides whether recovering content may stay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_SOCKET_REVALIDATION_MS,
  COMMUNITY_VERIFICATION_BOUND_MS,
  CommunityVerification,
} from '../src/community-verification'

let now = 0
let stale: ReturnType<typeof vi.fn<() => void>>
let clock: CommunityVerification
beforeEach(() => {
  vi.useFakeTimers()
  now = 1_000_000
  stale = vi.fn<() => void>()
  clock = new CommunityVerification(stale, () => now)
})
afterEach(() => {
  clock.stop()
  vi.useRealTimers()
})
const advance = (ms: number) => {
  now += ms
  vi.advanceTimersByTime(ms)
}

describe('community verification clock', () => {
  it('keeps content while recovering within the bound of an HTTP authorization, then reports stale', () => {
    expect(clock.update('connected', false)).toEqual({ visible: true, verify: false })
    advance(3000)
    expect(clock.update('recovering')).toEqual({ visible: true, verify: false })
    advance(COMMUNITY_VERIFICATION_BOUND_MS - 3000 - 1)
    expect(stale).not.toHaveBeenCalled()
    advance(1)
    expect(stale).toHaveBeenCalledTimes(1)
  })

  it('hides recovering content once the last authorization is older than the bound', () => {
    clock.update('connected', false)
    advance(COMMUNITY_VERIFICATION_BOUND_MS)
    expect(clock.update('recovering')).toEqual({ visible: false, verify: false })
    advance(COMMUNITY_VERIFICATION_BOUND_MS)
    expect(stale).not.toHaveBeenCalled()
  })

  it('credits a dropped socket with its last revalidation and asks for an HTTP verification', () => {
    clock.update('connected', true)
    // Minutes of a healthy socket: the server kept revalidating it.
    advance(300_000)
    expect(clock.update('recovering')).toEqual({ visible: true, verify: true })
    advance(COMMUNITY_VERIFICATION_BOUND_MS - COMMUNITY_SOCKET_REVALIDATION_MS)
    expect(stale).toHaveBeenCalledTimes(1)
    // Later recovering signals while polling do not ask again.
    expect(clock.update('recovering')).toEqual({ visible: false, verify: false })
  })

  it('a successful catch-up re-verifies and cancels the pending stale report', () => {
    clock.update('connected', false)
    advance(7000)
    clock.update('recovering')
    advance(500)
    expect(clock.update('connected', false)).toEqual({ visible: true, verify: false })
    advance(COMMUNITY_VERIFICATION_BOUND_MS)
    expect(stale).not.toHaveBeenCalled()
  })

  it('keeps content hidden through a foreground restore until a catch-up verifies access', () => {
    clock.update('connected', true)
    clock.foreground()
    expect(clock.update('recovering')).toEqual({ visible: false, verify: false })
    expect(clock.update('connected', false)).toEqual({ visible: true, verify: false })
    advance(1000)
    expect(clock.update('recovering')).toEqual({ visible: true, verify: false })
  })

  it.each(['unavailable', 'denied'] as const)(
    'hides on %s and cancels a pending stale report',
    (state) => {
      clock.update('connected', true)
      clock.update('recovering')
      expect(clock.update(state)).toEqual({ visible: false, verify: false })
      advance(COMMUNITY_VERIFICATION_BOUND_MS)
      expect(stale).not.toHaveBeenCalled()
      // The socket is no longer credited after an outage.
      expect(clock.update('recovering')).toEqual({ visible: false, verify: false })
    }
  )

  it('hides when nothing was ever verified', () => {
    const fresh = new CommunityVerification(stale)
    expect(fresh.update('recovering')).toEqual({ visible: false, verify: false })
    fresh.stop()
  })
})
