export type MobileAccessTokenResolver = () =>
  | string
  | undefined
  | Promise<string | undefined>

/**
 * Pick this device's end-to-end bearer token when the suite runs on several
 * simulators at once.
 *
 * `EXPO_PUBLIC_E2E_ACCESS_TOKEN` is read at bundle time, so one Metro bundler
 * can only ever carry one token, and every device it serves signs in as the
 * same user. That is fine for a serial run and wrong for a parallel one: the
 * suite's flows create, rename and delete capsules and garments for the
 * signed-in user, so two devices sharing a user corrupt each other's data.
 *
 * Running one bundler per device does not solve it either. Maestro pins its iOS
 * driver to a single host port, so the shards have to share one Maestro process,
 * which means one set of `-e` values and therefore one bundler.
 *
 * So the bundle carries a map of device name to token, and each device selects
 * its own. `EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE` is written by
 * `scripts/run-maestro.mjs`, which signs up one fixture user per simulator and
 * keys them by the simulator's name.
 *
 * Guarded by `__DEV__` exactly like the single-token path it extends: a
 * production bundle resolves no token at all.
 *
 * `expo-device` is imported lazily and only once the map is present, which in
 * practice means only under the E2E harness. Importing a native-only Expo
 * module at module scope breaks every unit test that reaches this module --
 * `vitest.config.ts` already records that they wedge the optimizer, and the
 * failure is an import-time `Cannot read properties of undefined (reading
 * 'EventEmitter')` rather than anything that points here.
 *
 * @returns the token for this device, or undefined when no map applies
 */
const resolveDeviceScopedE2EToken = async (): Promise<string | undefined> => {
  const raw = process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE?.trim()
  if (!raw) {
    return undefined
  }

  const { deviceName: rawDeviceName } = await import('expo-device')
  const deviceName = rawDeviceName?.trim()
  if (!deviceName) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }

  const token = (parsed as Record<string, unknown>)[deviceName]
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : undefined
}

const defaultAccessTokenResolver: MobileAccessTokenResolver = async () => {
  if (!__DEV__) {
    return undefined
  }

  return (
    (await resolveDeviceScopedE2EToken()) ??
    (process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN?.trim() || undefined)
  )
}

let accessTokenResolver = defaultAccessTokenResolver

/**
 * Authentication owns the session lifecycle; API consumers only request the
 * current bearer token through this boundary.
 */
export function setMobileAccessTokenResolver(resolver: MobileAccessTokenResolver) {
  const previousResolver = accessTokenResolver
  accessTokenResolver = resolver
  return () => {
    accessTokenResolver = previousResolver
  }
}

export async function resolveMobileAccessToken() {
  return await accessTokenResolver()
}
