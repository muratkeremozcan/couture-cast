import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveMobileAccessToken, setMobileAccessTokenResolver } from './mobile-auth'

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
    deviceName.current = 'couture-e2e-2'
    delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN
    delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE
  })

  afterEach(() => {
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
})
