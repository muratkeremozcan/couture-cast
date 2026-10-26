const VERSION = /^holdout-v[1-9]\d*$/
const SHA256 = /^[a-f0-9]{64}$/

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validSeal(version, seal) {
  return (
    record(seal) &&
    seal.corpusVersion === version &&
    typeof seal.sealedAt === 'string' &&
    Number.isFinite(Date.parse(seal.sealedAt)) &&
    typeof seal.corpusSha256 === 'string' &&
    SHA256.test(seal.corpusSha256)
  )
}

/** Classify the selector before reading any version-specific corpus path. */
export function requireEligibleHoldout(version, ledger) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error('active text holdout version is invalid')
  }
  if (
    !record(ledger) ||
    ledger.schemaVersion !== 2 ||
    !record(ledger.eligible) ||
    !record(ledger.retired) ||
    Object.entries(ledger.retired).some(
      ([key, reason]) =>
        !VERSION.test(key) || typeof reason !== 'string' || !reason.trim()
    ) ||
    Object.entries(ledger.eligible).some(
      ([key, seal]) =>
        !VERSION.test(key) || !validSeal(key, seal) || Object.hasOwn(ledger.retired, key)
    )
  ) {
    throw new Error('text holdout eligibility ledger is invalid')
  }
  if (Object.hasOwn(ledger.retired, version)) {
    throw new Error(
      `active text holdout ${version} is retired: ${ledger.retired[version]}`
    )
  }
  if (!Object.hasOwn(ledger.eligible, version)) {
    throw new Error(`active text holdout ${version} is not eligible: no registered seal`)
  }
  return ledger.eligible[version]
}

/** Both release consumers use the same registered seal identity. */
export function assertActiveHoldoutEligible(version, seal, ledger) {
  const registered = requireEligibleHoldout(version, ledger)
  if (
    !validSeal(version, seal) ||
    seal.sealedAt !== registered.sealedAt ||
    seal.corpusSha256 !== registered.corpusSha256
  ) {
    throw new Error(
      'active text holdout seal identity is missing, invalid or unregistered'
    )
  }
}
