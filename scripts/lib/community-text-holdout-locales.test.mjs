import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  TEXT_LOCALES,
  aggregateCorpusSha256,
  assertActiveHoldoutEligible,
  assertLocaleFileSealed,
  parseActiveHoldout,
  requireEligibleHoldout,
  resolveActiveHoldouts,
} from '../../apps/api/src/modules/community/community-text-holdout-eligibility-core.mjs'

// Synthetic metadata only: no holdout text, item id or result appears in this file.
const SIX = ['de', 'en', 'es', 'fr', 'it', 'tr']
const seal = (version, extra = {}) => ({
  corpusVersion: version,
  sealedAt: '2026-10-26T08:05:04.440Z',
  corpusSha256: 'a'.repeat(64),
  ...extra,
})
const ledger3 = (overrides = {}) => ({
  schemaVersion: 3,
  eligible: { 'holdout-v50': seal('holdout-v50', { locales: SIX }) },
  retired: {
    'holdout-v51': 'Whole version retired.',
    'holdout-v50': { locales: ['pt'], reason: 'Failed the Portuguese evaluation.' },
  },
  ...overrides,
})

describe('per-locale eligibility', () => {
  test('a version can be eligible for six locales and retired for the seventh', () => {
    for (const locale of SIX) {
      assert.equal(
        requireEligibleHoldout('holdout-v50', ledger3(), locale).corpusVersion,
        'holdout-v50'
      )
    }
    assert.throws(
      () => requireEligibleHoldout('holdout-v50', ledger3(), 'pt'),
      /holdout-v50 is retired for pt: Failed the Portuguese evaluation/
    )
  })

  test('a whole-version retirement retires every locale and names the locale', () => {
    for (const locale of TEXT_LOCALES) {
      assert.throws(
        () => requireEligibleHoldout('holdout-v51', ledger3(), locale),
        new RegExp(`holdout-v51 is retired for ${locale}`)
      )
    }
  })

  test('a scoped retirement leaves the other locales unclassified, not eligible', () => {
    const scoped = ledger3({ eligible: {} })
    assert.throws(
      () => requireEligibleHoldout('holdout-v50', scoped, 'de'),
      /holdout-v50 is not eligible for de: no registered seal/
    )
  })

  test('a locale in both eligible and a scoped or whole retirement of one version is invalid', () => {
    for (const retired of [
      { 'holdout-v50': { locales: ['de', 'pt'], reason: 'Overlap.' } },
      { 'holdout-v50': 'Whole version retired.' },
    ]) {
      assert.throws(
        () => requireEligibleHoldout('holdout-v50', ledger3({ retired }), 'en'),
        /ledger is invalid/
      )
    }
  })

  test('a version key may sit in both maps when the locale sets are disjoint', () => {
    assert.doesNotThrow(() => requireEligibleHoldout('holdout-v50', ledger3(), 'tr'))
  })

  test('a schema 2 ledger reads as every locale for each eligible or retired key', () => {
    const legacy = {
      schemaVersion: 2,
      eligible: { 'holdout-v60': seal('holdout-v60') },
      retired: { 'holdout-v1': 'Historical.' },
    }
    for (const locale of TEXT_LOCALES) {
      assert.equal(
        requireEligibleHoldout('holdout-v60', legacy, locale).corpusVersion,
        'holdout-v60'
      )
      assert.throws(() => requireEligibleHoldout('holdout-v1', legacy, locale), /retired/)
    }
  })

  test('a schema 2 ledger rejects a locales list instead of reading it as all seven', () => {
    const legacy = (eligible, retired = {}) => ({ schemaVersion: 2, eligible, retired })
    for (const bad of [
      legacy({ 'holdout-v60': seal('holdout-v60', { locales: ['de'] }) }),
      legacy({ 'holdout-v60': seal('holdout-v60', { locales: [] }) }),
      legacy({}, { 'holdout-v61': { locales: ['pt'], reason: 'Scoped.' } }),
    ]) {
      for (const locale of ['de', 'pt']) {
        assert.throws(
          () => requireEligibleHoldout('holdout-v60', bad, locale),
          /ledger is invalid: schema 2 entries cannot carry a locales list/
        )
      }
    }
  })

  test('eligible locales must be a non-empty list of known, unique locales', () => {
    for (const locales of [[], ['xx'], ['de', 'de'], 'de', undefined]) {
      const bad = ledger3({
        eligible: { 'holdout-v50': seal('holdout-v50', { locales }) },
        retired: {},
      })
      assert.throws(
        () => requireEligibleHoldout('holdout-v50', bad, 'de'),
        /ledger is invalid/
      )
    }
  })

  test('a scoped retirement needs known locales and a reason', () => {
    for (const entry of [
      { locales: [], reason: 'Empty.' },
      { locales: ['xx'], reason: 'Unknown.' },
      { locales: ['pt'], reason: ' ' },
      { reason: 'No locales.' },
    ]) {
      const bad = ledger3({ eligible: {}, retired: { 'holdout-v50': entry } })
      assert.throws(
        () => requireEligibleHoldout('holdout-v50', bad, 'pt'),
        /ledger is invalid/
      )
    }
  })

  test('an unknown locale is refused', () => {
    assert.throws(
      () => requireEligibleHoldout('holdout-v50', ledger3(), 'xx'),
      /unknown text locale xx/
    )
  })

  test('the seal check is per locale and compares the registered identity', () => {
    assert.doesNotThrow(() =>
      assertActiveHoldoutEligible('holdout-v50', seal('holdout-v50'), ledger3(), 'de')
    )
    assert.throws(
      () =>
        assertActiveHoldoutEligible('holdout-v50', seal('holdout-v50'), ledger3(), 'pt'),
      /retired for pt/
    )
    assert.throws(
      () =>
        assertActiveHoldoutEligible(
          'holdout-v50',
          seal('holdout-v50', { corpusSha256: 'b'.repeat(64) }),
          ledger3(),
          'de'
        ),
      /seal identity/
    )
  })
})

describe('active holdout selector', () => {
  const map = (version = 'holdout-v50') =>
    Object.fromEntries(TEXT_LOCALES.map((locale) => [locale, version]))

  test('reads a schema 2 map', () => {
    const active = parseActiveHoldout({
      schemaVersion: 2,
      locales: { ...map(), pt: 'holdout-v52' },
    })
    assert.equal(active.pt, 'holdout-v52')
    assert.equal(active.de, 'holdout-v50')
  })

  test('reads a legacy single version as every locale', () => {
    assert.deepEqual(
      parseActiveHoldout({ corpusVersion: 'holdout-v7' }),
      map('holdout-v7')
    )
  })

  test('refuses a missing locale, an extra locale key and a bad version', () => {
    const missing = Object.fromEntries(
      Object.entries(map()).filter(([locale]) => locale !== 'pt')
    )
    assert.throws(
      () => parseActiveHoldout({ schemaVersion: 2, locales: missing }),
      /names no version for pt/
    )
    assert.throws(
      () =>
        parseActiveHoldout({
          schemaVersion: 2,
          locales: { ...map(), xx: 'holdout-v50' },
        }),
      /unknown locale xx/
    )
    assert.throws(
      () =>
        parseActiveHoldout({
          schemaVersion: 2,
          locales: { ...map(), de: '../holdout-v50' },
        }),
      /version for de is invalid/
    )
    assert.throws(() => parseActiveHoldout({ corpusVersion: 'v7' }), /version is invalid/)
    assert.throws(() => parseActiveHoldout(null), /selector is invalid/)
    assert.throws(
      () => parseActiveHoldout({ schemaVersion: 3, locales: map() }),
      /selector is invalid/
    )
  })

  test('resolves every locale on the version it names and reads each manifest once', () => {
    const reads = []
    const active = parseActiveHoldout({
      schemaVersion: 2,
      locales: { ...map(), pt: 'holdout-v52' },
    })
    const ledger = ledger3({
      eligible: {
        'holdout-v50': seal('holdout-v50', { locales: SIX }),
        'holdout-v52': seal('holdout-v52', { locales: ['pt'] }),
      },
      retired: {},
    })
    const resolved = resolveActiveHoldouts(active, ledger, (version) => {
      reads.push(version)
      return seal(version)
    })
    assert.equal(resolved.pt.version, 'holdout-v52')
    assert.equal(resolved.de.version, 'holdout-v50')
    assert.deepEqual(reads.toSorted(), ['holdout-v50', 'holdout-v52'])
  })

  test('refuses the run naming the locale and version when one locale is retired or unsealed', () => {
    const active = parseActiveHoldout({ schemaVersion: 2, locales: map() })
    assert.throws(
      () => resolveActiveHoldouts(active, ledger3(), (version) => seal(version)),
      /holdout-v50 is retired for pt/
    )
    const unregistered = ledger3({ retired: {} })
    assert.throws(
      () => resolveActiveHoldouts(active, unregistered, (version) => seal(version)),
      /holdout-v50 is not eligible for pt/
    )
    const sealed = ledger3({
      retired: {},
      eligible: { 'holdout-v50': seal('holdout-v50', { locales: TEXT_LOCALES }) },
    })
    assert.throws(
      () =>
        resolveActiveHoldouts(active, sealed, (version) =>
          seal(version, { corpusSha256: 'c'.repeat(64) })
        ),
      /seal identity.*de|de.*seal identity/
    )
  })
})

describe('locale file against the freeze manifest', () => {
  const file = { corpusVersion: 'holdout-v50', language: 'de' }
  const manifest = (sha = 'd'.repeat(64)) => ({
    corpusVersion: 'holdout-v50',
    files: [{ language: 'de', path: 'x/holdout-v50/de.json', sha256: sha }],
  })

  test('accepts a file whose version and digest match', () => {
    assert.doesNotThrow(() =>
      assertLocaleFileSealed({
        version: 'holdout-v50',
        locale: 'de',
        file,
        fileSha256: 'd'.repeat(64),
        manifest: manifest(),
      })
    )
  })

  test('refuses a manifest that lacks the locale', () => {
    assert.throws(
      () =>
        assertLocaleFileSealed({
          version: 'holdout-v50',
          locale: 'tr',
          file,
          fileSha256: 'd'.repeat(64),
          manifest: manifest(),
        }),
      /freeze manifest of holdout-v50 does not list tr/
    )
  })

  test('refuses a digest mismatch and a wrong corpusVersion inside the file', () => {
    assert.throws(
      () =>
        assertLocaleFileSealed({
          version: 'holdout-v50',
          locale: 'de',
          file,
          fileSha256: 'e'.repeat(64),
          manifest: manifest(),
        }),
      /de holdout-v50 file does not match its freeze manifest/
    )
    assert.throws(
      () =>
        assertLocaleFileSealed({
          version: 'holdout-v50',
          locale: 'de',
          file: { ...file, corpusVersion: 'holdout-v49' },
          fileSha256: 'd'.repeat(64),
          manifest: manifest(),
        }),
      /de file names holdout-v49, not holdout-v50/
    )
  })

  test('the aggregate seal covers the listed files only, in path order', () => {
    const files = [
      { path: 'b', sha256: '2'.repeat(64) },
      { path: 'a', sha256: '1'.repeat(64) },
    ]
    assert.equal(
      aggregateCorpusSha256(files),
      aggregateCorpusSha256([...files].reverse())
    )
    assert.notEqual(
      aggregateCorpusSha256(files),
      aggregateCorpusSha256(files.slice(0, 1))
    )
    assert.match(aggregateCorpusSha256(files), /^[a-f0-9]{64}$/)
  })
})
