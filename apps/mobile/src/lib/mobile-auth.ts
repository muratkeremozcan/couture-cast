export type MobileAccessTokenResolver = () =>
  | string
  | undefined
  | Promise<string | undefined>

let accessTokenResolver: MobileAccessTokenResolver = () => {
  if (!__DEV__) {
    return undefined
  }

  return process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN?.trim() || undefined
}

/**
 * Authentication owns the session lifecycle; API consumers only request the
 * current bearer token through this boundary.
 */
export function setMobileAccessTokenResolver(resolver: MobileAccessTokenResolver) {
  accessTokenResolver = resolver
}

export async function resolveMobileAccessToken() {
  return await accessTokenResolver()
}
