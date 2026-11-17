// Owner report 2026-11-16: a signed-in member saw the landing's Start signup and Sign in and ran
// Google again. The bridge keeps <html data-session> current after the head script set it. A
// member may still open the sign-in doors to switch accounts (Story 6.5 N1, Story 6.17 D1).
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

const session = vi.hoisted(() => ({
  start: undefined as undefined | ((stop: () => void) => void),
  resume: vi.fn(() => Promise.resolve(null as string | null)),
}))
vi.mock('../../lib/web-session', () => ({
  startWebSession: () =>
    new Promise<() => void>((resolve) => {
      session.start = resolve
    }),
  resolveFederatedFinishRoute: session.resume,
}))

import { SessionBridge } from './session-bridge'

const STORED = 'couturecast.auth-session'
const BEARER = 'couturecast.access-token'
/** A stored Supabase session that parses, with a refresh token and an expiry an hour away. */
const LIVE = JSON.stringify({
  access_token: 'eyJ.access',
  refresh_token: 'refresh-1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
})
const realLocation = window.location
let replace: Mock

function at(pathAndQuery: string) {
  const url = new URL(pathAndQuery, 'http://localhost')
  nav.pathname = url.pathname
  replace = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
      origin: 'http://localhost',
      pathname: url.pathname,
      search: url.search,
      replace,
    },
  })
}

const state = () => document.documentElement.getAttribute('data-session')

async function settle() {
  await act(async () => {
    session.start?.(() => undefined)
    await Promise.resolve()
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.documentElement.removeAttribute('data-session')
  at('/')
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('the landing session on <html>', () => {
  it('holds a stored session as pending until the session start finishes, then signed out', async () => {
    window.localStorage.setItem(STORED, LIVE)
    render(<SessionBridge />)
    expect(state()).toBe('pending')
    await settle()
    expect(state()).toBe('none')
  })

  it('turns member when this tab verifies the session, and signed out when another tab signs out', async () => {
    window.localStorage.setItem(STORED, LIVE)
    render(<SessionBridge />)
    await settle()
    act(() => {
      window.sessionStorage.setItem(BEARER, 'eyJ.verified')
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(state()).toBe('member')
    act(() => {
      window.localStorage.removeItem(STORED)
      window.dispatchEvent(new StorageEvent('storage', { key: STORED }))
    })
    expect(state()).toBe('none')
  })

  it('re-reads a page restored from the back-forward cache, and on focus', async () => {
    window.localStorage.setItem(STORED, LIVE)
    window.sessionStorage.setItem(BEARER, 'eyJ.verified')
    render(<SessionBridge />)
    await settle()
    expect(state()).toBe('member')
    window.localStorage.removeItem(STORED)
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    })
    expect(state()).toBe('member')
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    expect(state()).toBe('none')
    window.localStorage.setItem(STORED, LIVE)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(state()).toBe('member')
  })
})

it('leaves a member on a sign-in door, where switching accounts starts', async () => {
  window.localStorage.setItem(STORED, LIVE)
  window.sessionStorage.setItem(BEARER, 'eyJ.verified')
  for (const door of ['/signin', '/signup']) {
    at(door)
    render(<SessionBridge />)
    await settle()
    expect(state()).toBe('member')
    cleanup()
  }
  expect(replace).not.toHaveBeenCalled()
})
