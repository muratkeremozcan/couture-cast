/**
 * Type declarations for `check-artifact-secrets.mjs`, so its unit tests under
 * `playwright/` can import it plainly (see `local-e2e-database.d.mts`).
 */

export declare const MIN_SECRET_LENGTH: number

export type SecretNeedle = { encoding: string; bytes: Buffer }

export type ScannableSecret = { name: string; needles: SecretNeedle[] }

export declare function secretEncodings(value: string): SecretNeedle[]

export declare function resolveSecrets(
  names: readonly string[],
  env?: NodeJS.ProcessEnv
): { secrets: ScannableSecret[]; unset: string[]; tooShort: string[] }

export type ScanResult = {
  files: number
  layers: number
  missing: string[]
  findings: { location: string; name: string; encoding: string }[]
  unreadable: { location: string; reason: string }[]
}

export declare function scanPaths(
  targets: readonly string[],
  secrets: readonly ScannableSecret[]
): ScanResult

export declare function resolveStorageStateSecrets(files: readonly string[]): {
  secrets: ScannableSecret[]
  missing: string[]
}

export declare function parseArgs(argv: readonly string[]): {
  names: string[]
  storageStates: string[]
  targets: string[]
}

export declare function main(
  argv?: readonly string[],
  env?: NodeJS.ProcessEnv,
  out?: Pick<Console, 'log' | 'error'>
): number
