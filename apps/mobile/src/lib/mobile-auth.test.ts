import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from './mobile-auth'

const native = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined),
}))
vi.mock('./native-session', () => ({ resolveNativeSessionToken: native.token }))

const deviceName = vi.hoisted(() => ({ current: 'couture-e2e-2' }))

vi.mock('expo-device', () => ({
  get deviceName() {
    return deviceName.current
  },
}))

const TOKEN_ONE = 'header.payload-one.couturecast-mobile-e2e'
const TOKEN_TWO = 'header.payload-two.couturecast-mobile-e2e'

describe('resolveMobileAccessToken', () => {
  beforeEach(() => {
    native.token.mockReset().mockResolvedValue(undefined)
    deviceName.current = 'couture-e2e-2'
    delete process.env.EXPO_PUBLIC_E2E_AUTH_MODE
    delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN
    delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE
  })

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_E2E_AUTH_MODE
    delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN
    delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE
    vi.unstubAllGlobals()
  })

  it('resolves the single bundle token when no per-device map is present', async () => {
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE

    await expect(resolveMobileAccessToken()).resolves.toBe(TOKEN_ONE)
  })

  it('resolves the token belonging to this device when several simulators run', async () => {
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE = JSON.stringify({
      'couture-e2e-1': TOKEN_ONE,
      'couture-e2e-2': TOKEN_TWO,
    })

    // The whole point of the map: this device must not sign in as the user a
    // sibling shard is mutating.
    await expect(resolveMobileAccessToken()).resolves.toBe(TOKEN_TWO)
  })

  it('falls back to the single token when this device is absent from the map', async () => {
    deviceName.current = 'someone-elses-simulator'
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE = JSON.stringify({
      'couture-e2e-1': TOKEN_TWO,
    })

    await expect(resolveMobileAccessToken()).resolves.toBe(TOKEN_ONE)
  })

  it('falls back to the single token when the map is not valid JSON', async () => {
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE = '{not json'

    await expect(resolveMobileAccessToken()).resolves.toBe(TOKEN_ONE)
  })

  it('resolves nothing outside a development bundle', async () => {
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE = JSON.stringify({
      'couture-e2e-2': TOKEN_TWO,
    })
    vi.stubGlobal('__DEV__', false)

    await expect(resolveMobileAccessToken()).resolves.toBeUndefined()
  })

  it('lets authentication override the resolver and restore it again', async () => {
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE
    const restore = setMobileAccessTokenResolver(() => 'session-token')

    await expect(resolveMobileAccessToken()).resolves.toBe('session-token')

    restore()

    await expect(resolveMobileAccessToken()).resolves.toBe(TOKEN_ONE)
  })
  it('uses canonical secure-session auth in production before a root lifecycle installs', async () => {
    vi.stubGlobal('__DEV__', false)
    native.token.mockResolvedValue('verified-production-token')
    await expect(resolveMobileAccessToken()).resolves.toBe('verified-production-token')
    expect(native.token).toHaveBeenCalledOnce()
  })
  it('a retired binding cannot replace a successor using the same resolver function', async () => {
    const resolver = () => 'shared-session-token'
    const retireOld = setMobileAccessTokenResolver(resolver)
    const retireNew = setMobileAccessTokenResolver(resolver)
    try {
      retireOld()
      await expect(resolveMobileAccessToken()).resolves.toBe('shared-session-token')
      retireNew()
      native.token.mockResolvedValue('canonical-after-retired-bindings')
      await expect(resolveMobileAccessToken()).resolves.toBe(
        'canonical-after-retired-bindings'
      )
    } finally {
      retireOld()
      retireNew()
    }
  })
  it('real auth mode resolves the secure session even when debug fixture tokens exist', async () => {
    process.env.EXPO_PUBLIC_E2E_AUTH_MODE = 'real'
    process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = TOKEN_ONE
    native.token.mockResolvedValue('verified-real-mode-token')
    await expect(resolveMobileAccessToken()).resolves.toBe('verified-real-mode-token')
    expect(native.token).toHaveBeenCalledOnce()
  })
})

describe('mobileIdentityEpoch', () => {
  it('advances on every identity change, sign-out included, and never on a repeat', () => {
    const start = mobileIdentityEpoch()
    setMobileApplicationUserId('member-a')
    setMobileApplicationUserId('member-a')
    setMobileApplicationUserId(null)
    setMobileApplicationUserId('member-a')
    expect(mobileIdentityEpoch() - start).toBe(3)
    setMobileApplicationUserId(null)
  })
})
