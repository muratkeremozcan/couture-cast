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
