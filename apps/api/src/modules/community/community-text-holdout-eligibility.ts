export interface HoldoutSealIdentity {
  corpusVersion: string
  sealedAt: string
  corpusSha256: string
}

/** Eligibility is checked before constructing or running the text screener. */
export function assertActiveHoldoutEligible(
  version: string,
  seal: HoldoutSealIdentity,
  retired: Readonly<Record<string, string>>
): void {
  if (!/^holdout-v[1-9]\d*$/.test(version)) {
    throw new Error('active text holdout version is invalid')
  }
  if (
    !retired ||
    typeof retired !== 'object' ||
    Array.isArray(retired) ||
    Object.values(retired).some((reason) => typeof reason !== 'string' || !reason.trim())
  ) {
    throw new Error('text holdout retirement ledger is invalid')
  }
  if (Object.hasOwn(retired, version)) {
    throw new Error(`active text holdout ${version} is retired: ${retired[version]}`)
  }
  if (
    !seal ||
    seal.corpusVersion !== version ||
    typeof seal.sealedAt !== 'string' ||
    !Number.isFinite(Date.parse(seal.sealedAt)) ||
    typeof seal.corpusSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(seal.corpusSha256)
  ) {
    throw new Error('active text holdout seal identity is missing or invalid')
  }
}
