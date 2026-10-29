export const TEXT_LOCALES: readonly string[]

export interface HoldoutSealIdentity {
  corpusVersion: string
  sealedAt: string
  corpusSha256: string
}

/** Schema 2 lists every locale per key; schema 3 scopes seals and retirements per locale. */
export interface HoldoutEligibilityLedger {
  schemaVersion: 2 | 3
  eligible: Readonly<
    Record<string, HoldoutSealIdentity & { locales?: readonly string[] }>
  >
  retired: Readonly<
    Record<string, string | { locales: readonly string[]; reason: string }>
  >
}

export type ActiveHoldouts = Readonly<Record<string, string>>

export interface HoldoutFreezeManifest extends HoldoutSealIdentity {
  files: { language: string; path: string; sha256: string }[]
}

export function parseActiveHoldout(value: unknown): ActiveHoldouts

export function requireEligibleHoldout(
  version: string,
  ledger: unknown,
  locale: string
): HoldoutSealIdentity

export function assertActiveHoldoutEligible(
  version: string,
  seal: unknown,
  ledger: unknown,
  locale: string
): void

export function resolveActiveHoldouts(
  active: ActiveHoldouts,
  ledger: unknown,
  readManifest: (version: string) => unknown
): Record<string, { version: string; seal: HoldoutSealIdentity }>

export function assertLocaleFileSealed(input: {
  version: string
  locale: string
  file: { corpusVersion?: unknown } | null | undefined
  fileSha256: string
  manifest: { files?: { language: string; sha256: string }[] } | null | undefined
}): void

export function aggregateCorpusSha256(files: { path: string; sha256: string }[]): string
