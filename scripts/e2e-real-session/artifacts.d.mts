/** Type declarations for `artifacts.mjs`, for the owned config and the unit tests under `playwright/`. */

export declare const RAW_DIR: string
export declare const STAGING_DIR: string
export declare const ARTIFACTS_DIR: string
export declare const COMPLETION_RECORD: string
export declare const ISSUED_OTPS_FILE: string

export declare function hashTree(directory: string): Record<string, string>

export declare function resetArtifacts(directory: string): void

export declare function finalizeArtifacts(options: {
  directory: string
  sources: readonly { to: string; from: string }[]
  texts?: readonly { to: string; content: string }[]
  secrets: readonly (string | undefined)[]
  otpCodes: readonly string[]
  redact?: (text: string, secrets: readonly (string | undefined)[]) => string
}): { files: number }

export declare function verifyArtifacts(
  directory: string
): { ok: true; files: number } | { ok: false; reason: string }
