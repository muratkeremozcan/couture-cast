import type * as ReactNativeModule from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Platform, findNodeHandle } from 'react-native'

import { safeFindNodeHandle, sha256Hex } from './expo-native-helpers'

/**
 * `Platform.OS` is redefined per test, so `Platform` has to be a plain object
 * rather than the frozen react-native-web export, and the real
 * `findNodeHandle` throws unconditionally on web.
 */
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array([0, 15, 171, 255]).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

describe('safeFindNodeHandle', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  /**
   * react-native-web's `findNodeHandle` throws "not supported on web" for every
   * call, so the web guard is what keeps shared wardrobe screens rendering at
   * all rather than a nicety.
   */
  it('never calls findNodeHandle on web', () => {
    expect(safeFindNodeHandle({})).toBeNull()
    expect(findNodeHandle).not.toHaveBeenCalled()
  })

  it('returns null for a ref that has not attached yet', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })

    expect(safeFindNodeHandle(null)).toBeNull()
    expect(findNodeHandle).not.toHaveBeenCalled()
  })

  it('resolves the native handle for an attached ref', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    const node = {}
    vi.mocked(findNodeHandle).mockReturnValue(31)

    expect(safeFindNodeHandle(node)).toBe(31)
    expect(findNodeHandle).toHaveBeenCalledWith(node)
  })

  /**
   * Under the New Architecture (`newArchEnabled: true`) `findNodeHandle` can
   * return a host object rather than the numeric reactTag its types promise.
   * The only consumer is `AccessibilityInfo.setAccessibilityFocus`, which hands
   * the value straight to a native HostFunction, and a non-number there takes
   * the whole app down with "Exception in HostFunction: Unsupported jsi::Value
   * kind", which is exactly what closing the capsule builder did on iOS.
   */
  it.each([
    ['a host object', { __nativeTag: 7 } as unknown as number],
    ['NaN', NaN],
    ['a string tag', '31' as unknown as number],
  ])('discards %s instead of passing it across the JSI bridge', (_label, value) => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(value)

    expect(safeFindNodeHandle({})).toBeNull()
  })
})

describe('sha256Hex', () => {
  /** The upload contract requires lowercase hex, zero-padded per byte. */
  it('renders the digest as zero-padded lowercase hex', async () => {
    await expect(sha256Hex(new Uint8Array([1, 2, 3]))).resolves.toBe('000fabff')
  })
})
