import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { aggregateCorpusSha256 } from '../../apps/api/src/modules/community/community-text-holdout-eligibility-core.mjs'
import {
  assertVersionDirectorySealed,
  describeCleanGates,
  loadActiveHoldouts,
} from '../../apps/api/src/modules/community/community-text-holdout-selection.mjs'

// Synthetic corpora only: the files hold a version tag and no captions.
const SIX = ['de', 'en', 'es', 'fr', 'it', 'tr']
const REL = 'apps/api/test/fixtures/community-text-corpus'
let dir

const sha = (text) => createHash('sha256').update(text).digest('hex')
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`)
}

/** Writes a version directory with the given locale files and its freeze manifest. */
function freeze(
  version,
  locales,
  { sealedAt = '2026-10-26T08:05:04.440Z', listed = locales } = {}
) {
  const files = []
  for (const locale of locales) {
    const body = JSON.stringify({ language: locale, corpusVersion: version, entries: [] })
    fs.mkdirSync(path.join(dir, version), { recursive: true })
    fs.writeFileSync(path.join(dir, version, `${locale}.json`), body)
    if (listed.includes(locale)) {
      files.push({
        language: locale,
        path: `${REL}/${version}/${locale}.json`,
        sha256: sha(body),
      })
    }
  }
  const manifest = {
    corpusVersion: version,
    sealedAt,
    corpusSha256: aggregateCorpusSha256(files),
    files,
  }
  writeJson(path.join(dir, version, 'freeze-manifest.json'), manifest)
  return manifest
}

function register(entries) {
  writeJson(path.join(dir, 'holdout-retirements.json'), {
    schemaVersion: 3,
    eligible: Object.fromEntries(
      entries.map(({ manifest, locales }) => [
        manifest.corpusVersion,
        {
          corpusVersion: manifest.corpusVersion,
          sealedAt: manifest.sealedAt,
          corpusSha256: manifest.corpusSha256,
          locales,
        },
      ])
    ),
    retired: {},
  })
}

describe('active holdout selection on disk', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68x-selection-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('gates six locales on one version and Portuguese on its own, reading each manifest once', () => {
    const six = freeze('holdout-v50', SIX)
    const pt = freeze('holdout-v52', ['pt'])
    register([
      { manifest: six, locales: SIX },
      { manifest: pt, locales: ['pt'] },
    ])
    writeJson(path.join(dir, 'active-holdout.json'), {
      schemaVersion: 2,
      locales: {
        ...Object.fromEntries(SIX.map((locale) => [locale, 'holdout-v50'])),
        pt: 'holdout-v52',
      },
    })
    const { holdouts, manifests } = loadActiveHoldouts(dir)
    assert.equal(holdouts.pt.version, 'holdout-v52')
    assert.equal(holdouts.de.version, 'holdout-v50')
    assert.deepEqual([...manifests.keys()].toSorted(), ['holdout-v50', 'holdout-v52'])
    assert.deepEqual(describeCleanGates(holdouts), {
      cleanGatedOn: {
        ...Object.fromEntries(SIX.map((locale) => [locale, 'holdout-v50'])),
        pt: 'holdout-v52',
      },
      cleanSeals: {
        ...Object.fromEntries(SIX.map((locale) => [locale, six.corpusSha256])),
        pt: pt.corpusSha256,
      },
    })
  })

  test('refuses the run naming the locale when a locale has no registered seal', () => {
    const six = freeze('holdout-v50', SIX)
    register([{ manifest: six, locales: SIX }])
    writeJson(path.join(dir, 'active-holdout.json'), { corpusVersion: 'holdout-v50' })
    assert.throws(() => loadActiveHoldouts(dir), /holdout-v50 is not eligible for pt/)
  })

  test('a version directory is sealed by exactly the locale files it holds', () => {
    const manifest = freeze('holdout-v52', ['pt'])
    assert.doesNotThrow(() => assertVersionDirectorySealed(dir, 'holdout-v52', manifest))
  })

  test('refuses a locale file the manifest does not list and a listed file that is missing', () => {
    const unlisted = freeze('holdout-v53', ['pt', 'tr'], { listed: ['pt'] })
    assert.throws(
      () => assertVersionDirectorySealed(dir, 'holdout-v53', unlisted),
      /tr.json is not listed in the freeze manifest of holdout-v53/
    )
    const missing = freeze('holdout-v54', ['pt'])
    fs.rmSync(path.join(dir, 'holdout-v54', 'pt.json'))
    assert.throws(
      () => assertVersionDirectorySealed(dir, 'holdout-v54', missing),
      /pt is listed in the freeze manifest of holdout-v54 but its file is missing/
    )
  })

  test('refuses an aggregate seal that does not cover the listed files', () => {
    const manifest = freeze('holdout-v55', ['pt'])
    assert.throws(
      () =>
        assertVersionDirectorySealed(dir, 'holdout-v55', {
          ...manifest,
          corpusSha256: 'f'.repeat(64),
        }),
      /aggregate seal of holdout-v55 does not match its listed files/
    )
  })
})
