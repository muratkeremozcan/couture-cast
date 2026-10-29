import { describe, expect, it } from 'vitest'

// The Expo packages app code imports lazily (ritual-cache, settings-storage, mobile-auth,
// commerce, community, native-notifications and their fixtures). Before
// vitest.expo-env.setup.ts installed Expo's web global, every one of them threw reading
// globalThis.expo.EventEmitter while loading, and app code swallowed it. expo-notifications
// is left out: on load it starts server auto-registration, which logs on web, and the
// native-notifications tests mock it.
const lazyExpoLoads = {
  'expo-file-system/legacy': () => import('expo-file-system/legacy'),
  'expo-application': () => import('expo-application'),
  'expo-haptics': () => import('expo-haptics'),
  'expo-device': () => import('expo-device'),
  'expo-web-browser': () => import('expo-web-browser'),
  'expo-secure-store': () => import('expo-secure-store'),
  'expo-crypto': () => import('expo-crypto'),
  'expo-image-picker': () => import('expo-image-picker'),
}

describe('Expo web global in browser suites', () => {
  it('lets the legacy file system load for the ritual cache and settings native paths', async () => {
    await expect(lazyExpoLoads['expo-file-system/legacy']()).resolves.toHaveProperty(
      'writeAsStringAsync'
    )
  })

  it.each(Object.keys(lazyExpoLoads))(
    '%s loads, or stops only at its absent native module',
    async (name) => {
      const outcome = await lazyExpoLoads[name as keyof typeof lazyExpoLoads]().then(
        () => 'loaded',
        (error: unknown) => String(error)
      )
      // A browser build has no native modules, so that is the one acceptable failure.
      expect(outcome).toMatch(/^loaded$|^Error: Cannot find native module '\w+'$/)
    }
  )
})
