/**
 * Type declarations for `harness.mjs`, so the owned Playwright config and the unit
 * tests under `playwright/` can import it plainly (see `local-e2e-database.d.mts`).
 */

export declare const API_PORT: number
export declare const WEB_PORT: number
export declare const API_BASE_URL: string
export declare const WEB_BASE_URL: string
export declare const AUTH_PROXY_PORT: number
export declare const WEATHER_DOUBLE_PORT: number
export declare const MAILPIT_URL: string
export declare const WEB_DIST_DIR: string
export declare const DEFAULT_HARNESS_DIR: string
export declare const ISOLATED_DATABASE_NAME: RegExp
export declare const REAL_SESSION_EMAIL: RegExp
export declare const RUN_STATE_FILES: readonly string[]
export declare const OTP_MODES: readonly ['real-email', 'generated']

export type OtpMode = 'real-email' | 'generated'

export declare function isolatedDatabaseName(uuid?: () => string): string
export declare function isolatedDatabaseUrl(sourceUrl: string, name: string): string
export declare function assertIsolatedDatabaseUrl(url: string | undefined): string
export declare function isLoopbackHost(hostname: string): boolean
export declare function otpFileName(email: string): string
export declare function findIssuableAccount<T extends { email?: unknown }>(
  rows: readonly T[],
  email: unknown
): T | undefined
export declare function selectRecordedUsers(
  rows: readonly { email?: unknown; authUserId?: unknown; label?: unknown }[]
): {
  deletable: { authUserId: string; email: string; label: string }[]
  refused: string[]
}
export declare function resolveOtpMode(
  requested: string | undefined,
  mailpitReachable: boolean
): OtpMode
export declare function extractMailCode(body: string): string | undefined
export declare function redactSecrets(
  text: string,
  secrets: readonly (string | undefined)[]
): string
export declare function envKeysToBlank(
  fileKeys: Iterable<string>,
  provided: Record<string, string>
): string[]
export declare function resolveHarnessDir(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  repoRoot: string
): string
