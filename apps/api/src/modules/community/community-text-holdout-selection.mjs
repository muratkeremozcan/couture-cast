import fs from 'node:fs'
import path from 'node:path'
import {
  TEXT_LOCALES,
  aggregateCorpusSha256,
  parseActiveHoldout,
  resolveActiveHoldouts,
} from './community-text-holdout-eligibility-core.mjs'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/**
 * Reads the selector and the ledger from a corpus directory and gates every locale on
 * the version it names. Each freeze manifest is read once and returned by version.
 */
export function loadActiveHoldouts(corpusDir) {
  const active = parseActiveHoldout(readJson(path.join(corpusDir, 'active-holdout.json')))
  const ledger = readJson(path.join(corpusDir, 'holdout-retirements.json'))
  const manifests = new Map()
  const holdouts = resolveActiveHoldouts(active, ledger, (version) => {
    const manifest = readJson(path.join(corpusDir, version, 'freeze-manifest.json'))
    manifests.set(version, manifest)
    return manifest
  })
  return { holdouts, manifests }
}

/** The run product's record of which holdout and which seal each locale was gated on. */
export function describeCleanGates(holdouts) {
  return {
    cleanGatedOn: Object.fromEntries(
      Object.entries(holdouts).map(([locale, { version }]) => [locale, version])
    ),
    cleanSeals: Object.fromEntries(
      Object.entries(holdouts).map(([locale, { seal }]) => [locale, seal.corpusSha256])
    ),
  }
}

/**
 * A version directory is sealed by exactly the locale files it holds: the manifest lists
 * each of them once, every listed file exists, and the aggregate covers those files only.
 */
export function assertVersionDirectorySealed(corpusDir, version, manifest) {
  const files = manifest?.files ?? []
  const listed = new Set(files.map((file) => file.language))
  if (listed.size !== files.length) {
    throw new Error(`freeze manifest of ${version} lists a locale twice`)
  }
  if (aggregateCorpusSha256(files) !== manifest.corpusSha256) {
    throw new Error(`aggregate seal of ${version} does not match its listed files`)
  }
  for (const locale of listed) {
    if (!fs.existsSync(path.join(corpusDir, version, `${locale}.json`))) {
      throw new Error(
        `${locale} is listed in the freeze manifest of ${version} but its file is missing`
      )
    }
  }
  for (const locale of TEXT_LOCALES) {
    if (
      fs.existsSync(path.join(corpusDir, version, `${locale}.json`)) &&
      !listed.has(locale)
    ) {
      throw new Error(`${locale}.json is not listed in the freeze manifest of ${version}`)
    }
  }
}

/**
 * The run product is evidence only for the selector and seals it was gated on. Names every
 * locale whose recorded version or seal differs from the current ones, or is missing.
 */
export function holdoutProductMismatches(gates, holdouts) {
  const gatedOn = gates?.cleanGatedOn
  const seals = gates?.cleanSeals
  const problems = []
  for (const [locale, { version, seal }] of Object.entries(holdouts)) {
    const recorded =
      typeof gatedOn === 'object' && gatedOn !== null ? gatedOn[locale] : undefined
    if (recorded === undefined) {
      problems.push(`${locale}: the run product records no holdout version`)
    } else if (recorded !== version) {
      problems.push(
        `${locale}: the run product was gated on ${recorded}, the selector names ${version}`
      )
    } else if (
      typeof seals !== 'object' ||
      seals === null ||
      seals[locale] !== seal.corpusSha256
    ) {
      problems.push(
        `${locale}: the run product recorded a different seal than the registered one`
      )
    }
  }
  return problems
}
