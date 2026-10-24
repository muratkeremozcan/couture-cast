/** Type declarations for `identities.mjs`, for the spec helper and the unit tests under `playwright/`. */

export declare const IDENTITIES_FILE: string

export declare function readIdentities(directory: string): Record<string, unknown>[]

export declare function writeIdentities(directory: string, rows: readonly unknown[]): void

export declare function recordPendingIdentity(
  directory: string,
  row: { email: string } & Record<string, unknown>
): void

export declare function recordCreatedIdentity(
  directory: string,
  account: { email: string; authUserId: string } & Record<string, unknown>
): void
