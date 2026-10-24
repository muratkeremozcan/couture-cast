/** Type declarations for `auth-proxy.mjs`, for its unit tests under `playwright/`. */

export type AuthProxy = {
  proxyUrl: string
  otpDir: string
  issuedCodes(): string[]
  close(): Promise<void>
}

export declare function startAuthProxy(options: {
  directory: string
  supabaseUrl: string
  serviceRoleKey: string
  webOrigin: string
  port: number
}): Promise<AuthProxy>
