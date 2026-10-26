export interface HoldoutSealIdentity {
  corpusVersion: string
  sealedAt: string
  corpusSha256: string
}

export interface HoldoutEligibilityLedger {
  schemaVersion: 2
  eligible: Readonly<Record<string, HoldoutSealIdentity>>
  retired: Readonly<Record<string, string>>
}

export function requireEligibleHoldout(
  version: string,
  ledger: unknown
): HoldoutSealIdentity

export function assertActiveHoldoutEligible(
  version: string,
  seal: unknown,
  ledger: unknown
): void
