import { createHash } from 'node:crypto'

export const TEXT_LOCALES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr']

const VERSION = /^holdout-v[1-9]\d*$/
const SHA256 = /^[a-f0-9]{64}$/
const LEDGER_INVALID = 'text holdout eligibility ledger is invalid'
const SCHEMA_2_SCOPED = `${LEDGER_INVALID}: schema 2 entries cannot carry a locales list`

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

function localeSet(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((locale) => TEXT_LOCALES.includes(locale)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(LEDGER_INVALID)
  }
  return new Set(value)
}

function requireLocale(locale) {
  if (!TEXT_LOCALES.includes(locale)) {
    throw new Error(`unknown text locale ${String(locale)}`)
  }
}

function parseEligible(ledger, scoped) {
  const eligible = new Map()
  for (const [key, seal] of Object.entries(ledger.eligible)) {
    if (!VERSION.test(key) || !validSeal(key, seal)) throw new Error(LEDGER_INVALID)
    // A schema 2 entry means every locale, so a locales list there is a mislabelled schema 3.
    if (!scoped && Object.hasOwn(seal, 'locales')) throw new Error(SCHEMA_2_SCOPED)
    eligible.set(key, {
      seal: {
        corpusVersion: seal.corpusVersion,
        sealedAt: seal.sealedAt,
        corpusSha256: seal.corpusSha256,
      },
      locales: scoped ? localeSet(seal.locales) : new Set(TEXT_LOCALES),
    })
  }
  return eligible
}

function parseRetired(ledger, scoped, eligible) {
  const retired = new Map()
  for (const [key, entry] of Object.entries(ledger.retired)) {
    if (!VERSION.test(key)) throw new Error(LEDGER_INVALID)
    if (!scoped && record(entry)) throw new Error(SCHEMA_2_SCOPED)
    const scopedEntry = scoped && record(entry)
    const locales = scopedEntry ? localeSet(entry.locales) : new Set(TEXT_LOCALES)
    const reason = scopedEntry ? entry.reason : entry
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(LEDGER_INVALID)
    retired.set(key, { locales, reason })
    const sealed = eligible.get(key)
    if (sealed && [...locales].some((locale) => sealed.locales.has(locale))) {
      throw new Error(LEDGER_INVALID)
    }
  }
  return retired
}

/**
 * Reads a schema 2 ledger (every locale per key) or a schema 3 ledger (a locale list on
 * each eligible seal, a string or a scoped retirement per retired key) into one shape.
 * A locale that is eligible and retired for the same version makes the ledger invalid.
 */
function parseLedger(ledger) {
  const scoped = record(ledger) && ledger.schemaVersion === 3
  if (
    !record(ledger) ||
    (ledger.schemaVersion !== 2 && !scoped) ||
    !record(ledger.eligible) ||
    !record(ledger.retired)
  ) {
    throw new Error(LEDGER_INVALID)
  }
  const eligible = parseEligible(ledger, scoped)
  return { eligible, retired: parseRetired(ledger, scoped, eligible) }
}

/** Reads the selector: a schema 2 locale map, or a legacy single version for every locale. */
export function parseActiveHoldout(value) {
  if (!record(value)) throw new Error('active text holdout selector is invalid')
  if (value.schemaVersion === 2 && record(value.locales)) {
    for (const locale of Object.keys(value.locales)) {
      if (!TEXT_LOCALES.includes(locale)) {
        throw new Error(`active text holdout names unknown locale ${locale}`)
      }
    }
    return Object.fromEntries(
      TEXT_LOCALES.map((locale) => {
        if (!Object.hasOwn(value.locales, locale)) {
          throw new Error(`active text holdout names no version for ${locale}`)
        }
        const version = value.locales[locale]
        if (typeof version !== 'string' || !VERSION.test(version)) {
          throw new Error(`active text holdout version for ${locale} is invalid`)
        }
        return [locale, version]
      })
    )
  }
  if (value.schemaVersion === undefined && Object.hasOwn(value, 'corpusVersion')) {
    if (typeof value.corpusVersion !== 'string' || !VERSION.test(value.corpusVersion)) {
      throw new Error('active text holdout version is invalid')
    }
    return Object.fromEntries(TEXT_LOCALES.map((locale) => [locale, value.corpusVersion]))
  }
  throw new Error('active text holdout selector is invalid')
}

/** Classify the selector for one locale before reading any version-specific corpus path. */
export function requireEligibleHoldout(version, ledger, locale) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error('active text holdout version is invalid')
  }
  requireLocale(locale)
  const { eligible, retired } = parseLedger(ledger)
  const retirement = retired.get(version)
  if (retirement?.locales.has(locale)) {
    throw new Error(
      `active text holdout ${version} is retired for ${locale}: ${retirement.reason}`
    )
  }
  const sealed = eligible.get(version)
  if (!sealed?.locales.has(locale)) {
    throw new Error(
      `active text holdout ${version} is not eligible for ${locale}: no registered seal`
    )
  }
  return sealed.seal
}

/** Both release consumers use the same registered seal identity. */
export function assertActiveHoldoutEligible(version, seal, ledger, locale) {
  const registered = requireEligibleHoldout(version, ledger, locale)
  if (
    !validSeal(version, seal) ||
    seal.sealedAt !== registered.sealedAt ||
    seal.corpusSha256 !== registered.corpusSha256
  ) {
    throw new Error(
      `active text holdout seal identity for ${locale} on ${version} is missing, invalid or unregistered`
    )
  }
}

/**
 * Gates every locale on the version it names. `readManifest(version)` returns that
 * version's freeze manifest and is called once per version.
 */
export function resolveActiveHoldouts(active, ledger, readManifest) {
  const manifests = new Map()
  return Object.fromEntries(
    TEXT_LOCALES.map((locale) => {
      const version = active[locale]
      const seal = requireEligibleHoldout(version, ledger, locale)
      if (!manifests.has(version)) manifests.set(version, readManifest(version))
      assertActiveHoldoutEligible(version, manifests.get(version), ledger, locale)
      return [locale, { version, seal }]
    })
  )
}

/** A locale file must name its version and match the digest its freeze manifest lists. */
export function assertLocaleFileSealed({ version, locale, file, fileSha256, manifest }) {
  const listed = (manifest?.files ?? []).filter((entry) => entry.language === locale)
  if (listed.length !== 1) {
    throw new Error(`freeze manifest of ${version} does not list ${locale}`)
  }
  if (file?.corpusVersion !== version) {
    throw new Error(`${locale} file names ${String(file?.corpusVersion)}, not ${version}`)
  }
  if (listed[0].sha256 !== fileSha256) {
    throw new Error(`${locale} ${version} file does not match its freeze manifest`)
  }
}

/** Sorted lines of path, NUL, file SHA-256 and LF, over the listed files only. */
export function aggregateCorpusSha256(files) {
  const material = files
    .toSorted((a, b) => a.path.localeCompare(b.path, 'en'))
    .map((file) => `${file.path}\0${file.sha256}\n`)
    .join('')
  return createHash('sha256').update(material).digest('hex')
}
