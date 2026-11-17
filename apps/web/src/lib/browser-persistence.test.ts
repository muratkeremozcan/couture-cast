// Owner report 2026-11-16, TEA H-2: a browser that refuses storage (iPhone Safari with Block All
// Cookies) crashed the whole web app on load. These cases pin the guarded read and the head script
// that gives such a browser an in-memory store before any SDK loads.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blockedStorageFallbackScript, readStorage } from './browser-persistence'

const deny = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

type FakeWindow = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const fallback = new Function('window', blockedStorageFallbackScript()) as (
  window: FakeWindow
) => void

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('readStorage', () => {
  it('reads both stores', () => {
    window.localStorage.setItem('k', 'local')
    window.sessionStorage.setItem('k', 'session')
    expect(readStorage('local', 'k')).toBe('local')
    expect(readStorage('session', 'k')).toBe('session')
    expect(readStorage('local', 'missing')).toBeNull()
  })

  it('answers null where the browser refuses the read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(deny)
    expect(readStorage('local', 'k')).toBeNull()
    expect(readStorage('session', 'k')).toBeNull()
  })
})

describe('the blocked-storage head script', () => {
  it('leaves working storage alone', () => {
    const local = window.localStorage
    const fake: FakeWindow = {
      localStorage: local,
      sessionStorage: window.sessionStorage,
    }
    fallback(fake)
    expect(fake.localStorage).toBe(local)
    expect(local.getItem('__couturecast_probe__')).toBeNull()
  })

  // TEA F4: a full store refuses writes but still holds a valid stored session.
  it('keeps a store that refuses only writes readable, and writes on top of it in memory', () => {
    const saved: Record<string, string> = {
      'couturecast.auth-session': '{"stored":true}',
    }
    const full = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      },
      removeItem: (key: string) => void delete saved[key],
    }
    const fake: FakeWindow = { localStorage: full, sessionStorage: window.sessionStorage }
    fallback(fake)
    const store = fake.localStorage as Storage
    expect(store).not.toBe(full)
    expect(fake.sessionStorage).toBe(window.sessionStorage)
    expect(store.getItem('couturecast.auth-session')).toBe('{"stored":true}')
    store.setItem('new', 'value')
    expect(store.getItem('new')).toBe('value')
    store.removeItem('couturecast.auth-session')
    expect(store.getItem('couturecast.auth-session')).toBeNull()
  })

  // TEA R1: an SDK that clears its keys walks key() and length (posthog-js on sign-out).
  it('lists the real keys and the memory keys once each when only writes fail', () => {
    const saved: Record<string, string> = { a: '1', b: '2' }
    const full = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      },
      removeItem: (key: string) => void delete saved[key],
      key: (index: number) => Object.keys(saved)[index] ?? null,
      get length() {
        return Object.keys(saved).length
      },
    }
    const fake: FakeWindow = { localStorage: full, sessionStorage: window.sessionStorage }
    fallback(fake)
    const store = fake.localStorage as Storage
    store.setItem('b', 'memory')
    store.setItem('c', '3')
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index))
    expect(keys).toEqual(['a', 'b', 'c'])
    expect(store.getItem('b')).toBe('memory')
    store.removeItem('a')
    expect(Array.from({ length: store.length }, (_, index) => store.key(index))).toEqual([
      'b',
      'c',
    ])
    expect(store.key(5)).toBeNull()
  })

  // CodeRabbit on PR 248: a store that refuses every change, clear() included.
  it('keeps removed and cleared keys gone when the store refuses changes', () => {
    const saved: Record<string, string> = { a: '1', 'couturecast.auth-session': '{}' }
    const refuse = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    const locked = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: refuse,
      removeItem: refuse,
      clear: refuse,
      key: (index: number) => Object.keys(saved)[index] ?? null,
      get length() {
        return Object.keys(saved).length
      },
    }
    const fake: FakeWindow = {
      localStorage: locked,
      sessionStorage: window.sessionStorage,
    }
    fallback(fake)
    const store = fake.localStorage as Storage
    store.removeItem('couturecast.auth-session')
    store.clear()
    expect(store.getItem('couturecast.auth-session')).toBeNull()
    expect(store.getItem('a')).toBeNull()
    expect(store.length).toBe(0)
    store.setItem('b', '2')
    expect(store.getItem('b')).toBe('2')
    expect(store.length).toBe(1)
  })

  for (const refusal of ['reads', 'access'] as const)
    it(`puts a working in-memory store in place when the browser refuses ${refusal}`, () => {
      const fake: FakeWindow = {}
      for (const name of ['localStorage', 'sessionStorage'])
        if (refusal === 'access')
          Object.defineProperty(fake, name, { get: deny, configurable: true })
        else
          fake[name] = {
            setItem: () => undefined,
            getItem: deny,
            removeItem: () => undefined,
          }
      fallback(fake)
      for (const name of ['localStorage', 'sessionStorage']) {
        const store = fake[name] as Storage
        expect(store.getItem('a')).toBeNull()
        store.setItem('a', '1')
        store.setItem('b', '2')
        expect(store.getItem('a')).toBe('1')
        expect(store.length).toBe(2)
        expect(store.key(0)).toBe('a')
        store.removeItem('a')
        expect(store.getItem('a')).toBeNull()
        store.clear()
        expect(store.length).toBe(0)
      }
    })
})
