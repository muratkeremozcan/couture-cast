// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b, AC 5: the text screening measurement against the committed corpus.
//
// Two gates per enabled language, both against the screener exactly as the
// worker builds it from the loaded policy:
//
//   - clean copy: at least 200 ordinary fashion captions and alt texts in the
//     frozen holdout (selected by active-holdout.json), and the Wilson 95% upper bound on
//     the share withheld must be at or below 1%. The holdout was written after
//     the allow list froze and nothing was tuned against it (Story 6.2b review,
//     BH10). The clean half the allow list was built against is still measured
//     and reported beside it, as the in-sample figure, and is held at zero
//     withheld as a regression check;
//   - disguised terms: at least 100 cases spanning every obfuscation family
//     Story 6.2 AC 4 names, and none of them may reach `pass`.
//
// With no eligible holdout (production follow-up 2026-11-19: v6 and v8 were retired after the
// allow list was tuned against them), the PR run is a development run: every gate that needs no
// eligible holdout still runs and the retired holdout figures are measured and labelled
// development, while a release run (COMMUNITY_SCREENING_RUN_PRODUCT_DIR set) refuses to start.
//
// It runs in the ordinary unit suite, so a term list or allow-list change that
// starts flagging ordinary copy, or opens a bypass, fails the pull request that
// made it. Failure messages carry case ids and reason codes and never the text
// or a matched term, which keeps raw terms out of logs and evidence.
import fs from 'node:fs'
import os from 'node:os'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CLEAN_HOLDOUT_UPPER_BOUND_MAXIMUM,
  passesCleanHoldoutGate,
  wilsonInterval,
} from './community-text-corpus-gate.js'
import { assertLocaleFileSealed } from './community-text-holdout-eligibility.js'
import {
  parseActiveHoldout,
  requireEligibleHoldout,
} from './community-text-holdout-eligibility-core.mjs'
import {
  assertVersionDirectorySealed,
  describeCleanGates,
  loadActiveHoldouts,
} from './community-text-holdout-selection.mjs'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import {
  CommunityTextScreener,
  type TextScreeningField,
} from './community-text-screener.js'

/** The input-set hash the readiness generator checks every run product against. */
async function currentInputSetHash(): Promise<string> {
  const helperPath = path.resolve(
    __dirname,
    '../../../../../scripts/lib/community-screening-input-set.mjs'
  )
  const module = (await import(helperPath)) as { inputSetHash: () => string }
  return module.inputSetHash()
}

const corpusDir = path.resolve(__dirname, '../../../test/fixtures/community-text-corpus')

/** Set by the release command that writes the run product. */
const RELEASE_RUN = Boolean(process.env.COMMUNITY_SCREENING_RUN_PRODUCT_DIR?.trim())

type ActiveHoldouts = ReturnType<typeof loadActiveHoldouts>

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))

/**
 * Classifies every selected locale/version pair from the selector and the ledger alone, before
 * any version-specific file (freeze manifest or caption rows) is read. `retired` means every pair
 * carries an explicit retirement for its locale; `none-retired` hands the selection to the strict
 * loader, which still refuses an unclassified pair. A retired pair beside an eligible or
 * unclassified one is refused here, so a fresh cohort cannot be opened as development data.
 */
function classifySelection(
  active: Record<string, string>,
  ledger: unknown
): 'retired' | 'none-retired' {
  const retired: string[] = []
  const notRetired: string[] = []
  for (const [locale, version] of Object.entries(active)) {
    try {
      requireEligibleHoldout(version, ledger, locale)
      notRetired.push(`${locale} ${version} is eligible`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes(`${version} is retired for ${locale}`)) retired.push(locale)
      else notRetired.push(`${locale}: ${message}`)
    }
  }
  if (retired.length === 0) return 'none-retired'
  if (notRetired.length > 0)
    throw new Error(
      `a development corpus run needs every selected holdout retired; ${notRetired.join('; ')}`
    )
  return 'retired'
}

/** The seal a retired version's own freeze manifest records, checked against the selector. */
function developmentSeal(version: string, manifest: unknown) {
  const { corpusVersion, sealedAt, corpusSha256 } = (manifest ?? {}) as Record<
    string,
    unknown
  >
  if (corpusVersion !== version)
    throw new Error(`freeze manifest of ${version} names ${String(corpusVersion)}`)
  if (typeof sealedAt !== 'string' || Number.isNaN(Date.parse(sealedAt)))
    throw new Error(`freeze manifest of ${version} has no valid sealedAt`)
  if (typeof corpusSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(corpusSha256))
    throw new Error(`freeze manifest of ${version} has no valid corpusSha256`)
  return { corpusVersion: version, sealedAt, corpusSha256 }
}

/**
 * Each locale names its own active holdout version. The whole selection is classified first.
 * When none is retired, the strict loader gates every locale on an eligible, sealed version, as a
 * release run requires. When every pair is retired, a release run refuses and a PR run reads the
 * retired holdouts as development data: each version's own manifest identity is checked, and the
 * existing hash checks cover the contents. A mixed selection refuses before reading any manifest.
 */
function loadHoldoutsForRun(
  release: boolean,
  dir = corpusDir
): ActiveHoldouts & { development: boolean } {
  const active = parseActiveHoldout(readJson(path.join(dir, 'active-holdout.json')))
  const ledger = readJson(path.join(dir, 'holdout-retirements.json'))
  if (classifySelection(active, ledger) === 'none-retired' || release)
    return { ...loadActiveHoldouts(dir), development: false }
  const manifests: ActiveHoldouts['manifests'] = new Map()
  const holdouts: ActiveHoldouts['holdouts'] = {}
  for (const [locale, version] of Object.entries(active)) {
    if (!manifests.has(version)) {
      manifests.set(
        version,
        readJson(path.join(dir, version, 'freeze-manifest.json')) as Parameters<
          typeof assertVersionDirectorySealed
        >[2]
      )
    }
    holdouts[locale] = { version, seal: developmentSeal(version, manifests.get(version)) }
  }
  return { holdouts, manifests, development: true }
}

const {
  holdouts,
  manifests,
  development: DEVELOPMENT_RUN,
} = loadHoldoutsForRun(RELEASE_RUN)
const holdoutVersion = (language: string): string => holdouts[language]?.version ?? ''
const holdoutPath = (language: string): string =>
  path.join(corpusDir, holdoutVersion(language), `${language}.json`)

const LANGUAGE_LOCALE: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-419',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-BR',
  tr: 'tr-TR',
}

const MINIMUM_CLEAN = 200
const MINIMUM_DISALLOWED = 100
const CLEAN_UPPER_BOUND_GATE = CLEAN_HOLDOUT_UPPER_BOUND_MAXIMUM
const REQUIRED_FAMILIES = [
  'nfkc-fullwidth',
  'case-mixing',
  'diacritics-added',
  'zero-width',
  'cyrillic-confusable',
  'leetspeak',
  'repeated-characters',
  'internal-punctuation',
  'spaced-letters',
  'leet-and-spaced',
]

interface CorpusEntry {
  id: string
  field: TextScreeningField
  text: string
  family?: string
  expected?: 'review'
  deliberateReviewTerm?: string
  reason?: string
}

interface Corpus {
  language: string
  clean: { entries: CorpusEntry[] }
  disallowed: { families: string[]; entries: CorpusEntry[] }
}

interface Holdout {
  language: string
  corpusVersion: string
  frozenAgainst: { allowListSha256: string }
  entries: CorpusEntry[]
}

const loaded = loadCommunityScreeningPolicy()
const screener = new CommunityTextScreener({
  policy: loaded.policy.text,
  policyVersion: loaded.identity.textEngineVersion,
})

function readCorpus(language: string): Corpus {
  return JSON.parse(
    fs.readFileSync(path.join(corpusDir, `${language}.json`), 'utf8')
  ) as Corpus
}

function readHoldout(language: string): Holdout {
  return JSON.parse(fs.readFileSync(holdoutPath(language), 'utf8')) as Holdout
}

interface CleanResult {
  total: number
  expectedReviewIds: string[]
  expectedReviewPassed: string[]
  withheld: number
  rate: number
  wilson95: [number, number]
  withheldIds: { id: string; disposition: string; reasons: readonly string[] }[]
  bySeverity: Record<string, number>
}

interface LanguageResult {
  language: string
  /** The frozen holdout: the gated figure. */
  clean: CleanResult
  /** The clean half the allow list was built against: reported, not gated. */
  cleanInSample: CleanResult
  disallowed: {
    total: number
    withheld: number
    bypassIds: string[]
    byFamily: Record<string, { total: number; withheld: number }>
    byDisposition: Record<string, number>
  }
}

function evaluateClean(entries: readonly CorpusEntry[], locale: string): CleanResult {
  const withheldIds: CleanResult['withheldIds'] = []
  const bySeverity: Record<string, number> = {}
  const expectedReviewIds: string[] = []
  const expectedReviewPassed: string[] = []
  const gated = entries.filter((entry) => entry.expected !== 'review')
  for (const entry of entries) {
    const result = screener.screen({ text: entry.text, field: entry.field, locale })
    if (entry.expected === 'review') {
      expectedReviewIds.push(entry.id)
      if (result.disposition === 'pass') expectedReviewPassed.push(entry.id)
      continue
    }
    if (result.disposition !== 'pass') {
      withheldIds.push({
        id: entry.id,
        disposition: result.disposition,
        reasons: result.reasons,
      })
      const severity = result.severity ?? 'none'
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1
    }
  }
  const total = gated.length
  return {
    total,
    expectedReviewIds,
    expectedReviewPassed,
    withheld: withheldIds.length,
    rate: total === 0 ? 0 : withheldIds.length / total,
    wilson95: wilsonInterval(withheldIds.length, total),
    withheldIds,
    bySeverity,
  }
}

function evaluateLanguage(language: string): LanguageResult {
  const corpus = readCorpus(language)
  const locale = LANGUAGE_LOCALE[language] as string

  const bypassIds: string[] = []
  const byFamily: Record<string, { total: number; withheld: number }> = {}
  const byDisposition: Record<string, number> = {}
  for (const entry of corpus.disallowed.entries) {
    const result = screener.screen({ text: entry.text, field: entry.field, locale })
    const family = entry.family ?? 'unknown'
    byFamily[family] ??= { total: 0, withheld: 0 }
    const bucket = byFamily[family] as { total: number; withheld: number }
    bucket.total += 1
    byDisposition[result.disposition] = (byDisposition[result.disposition] ?? 0) + 1
    if (result.disposition === 'pass') bypassIds.push(entry.id)
    else bucket.withheld += 1
  }

  return {
    language,
    clean: evaluateClean(readHoldout(language).entries, locale),
    cleanInSample: evaluateClean(corpus.clean.entries, locale),
    disallowed: {
      total: corpus.disallowed.entries.length,
      withheld: corpus.disallowed.entries.length - bypassIds.length,
      bypassIds,
      byFamily,
      byDisposition,
    },
  }
}

const languages = Object.keys(LANGUAGE_LOCALE)
const results = new Map(
  languages.map((language) => [language, evaluateLanguage(language)])
)

describe('wilsonInterval', () => {
  it('matches published reference values', () => {
    const [low, high] = wilsonInterval(0, 200)
    expect(low).toBeCloseTo(0, 12)
    expect(high).toBeCloseTo(0.01884, 4)
    const [low2, high2] = wilsonInterval(10, 100)
    expect(low2).toBeCloseTo(0.05523, 4)
    expect(high2).toBeCloseTo(0.17437, 4)
  })
})

describe.each(languages)('text corpus: %s', (language) => {
  const corpus = readCorpus(language)
  const holdout = readHoldout(language)
  const result = results.get(language) as LanguageResult

  it('holds a non-vacuous corpus that covers every obfuscation family', () => {
    expect(corpus.language).toBe(language)
    expect(corpus.clean.entries.length).toBeGreaterThanOrEqual(MINIMUM_CLEAN)
    expect(corpus.disallowed.entries.length).toBeGreaterThanOrEqual(MINIMUM_DISALLOWED)
    const ids = [...corpus.clean.entries, ...corpus.disallowed.entries].map(
      (entry) => entry.id
    )
    expect(new Set(ids).size).toBe(ids.length)
    const texts = corpus.clean.entries.map((entry) => entry.text)
    expect(new Set(texts).size).toBe(texts.length)
    for (const family of REQUIRED_FAMILIES) {
      expect(
        corpus.disallowed.entries.filter((entry) => entry.family === family).length,
        `${language} has no ${family} case`
      ).toBeGreaterThan(0)
    }
  })

  it('holds a frozen holdout disjoint from the clean half it was not tuned on', () => {
    expect(holdout.language).toBe(language)
    expect(holdout.corpusVersion).toBe(holdoutVersion(language))
    expect(holdout.entries.length).toBeGreaterThanOrEqual(MINIMUM_CLEAN)
    const ids = holdout.entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    const inSample = new Set(corpus.clean.entries.map((entry) => entry.text))
    expect(holdout.entries.filter((entry) => inSample.has(entry.text))).toEqual([])
  })

  it('matches the independent corpus seal recorded before repair inspection', () => {
    const version = holdoutVersion(language)
    const manifest = manifests.get(version)
    assertLocaleFileSealed({
      version,
      locale: language,
      file: holdout,
      fileSha256: createHash('sha256')
        .update(fs.readFileSync(holdoutPath(language)))
        .digest('hex'),
      manifest,
    })
    expect(manifest?.files.find((file) => file.language === language)?.path).toBe(
      `apps/api/test/fixtures/community-text-corpus/${version}/${language}.json`
    )
  })

  // The holdout is the release gate, so it is asserted by the release command
  // (`npm run community:screening:text`), whose run product the readiness
  // evidence reads. It is not asserted in the ordinary suite: a frozen holdout
  // that fails can only be fixed by a reviewed new holdout version, never by
  // tuning against this one, and an unrelated pull request cannot do either.
  it.runIf(RELEASE_RUN)(
    'keeps the Wilson 95% upper bound on withheld holdout copy at or below 1%',
    () => {
      expect(result.clean.total).toBeGreaterThanOrEqual(MINIMUM_CLEAN)
      expect(
        passesCleanHoldoutGate(result.clean.withheld, result.clean.total),
        `${language}: ${result.clean.withheld} of ${result.clean.total} holdout entries withheld; Wilson 95% upper bound ${result.clean.wilson95[1]}`
      ).toBe(true)
    }
  )

  it('withholds none of the clean half the allow list was built against', () => {
    expect(
      result.cleanInSample.withheldIds,
      `${language}: ${result.cleanInSample.withheld} of ${result.cleanInSample.total} in-sample clean entries withheld`
    ).toEqual([])
  })

  it('routes every caption carrying a deliberate review term to review, with its reason', () => {
    expect(result.clean.expectedReviewPassed).toEqual([])
    expect(result.cleanInSample.expectedReviewPassed).toEqual([])
    for (const entry of [...corpus.clean.entries, ...holdout.entries].filter(
      (item) => item.expected === 'review'
    )) {
      expect(
        entry.reason?.length ?? 0,
        `${entry.id} has no recorded reason`
      ).toBeGreaterThan(20)
    }
  })

  it('withholds every disguised term, whatever the obfuscation family', () => {
    expect(result.disallowed.bypassIds).toEqual([])
  })
})

describe('development run while no holdout is eligible', () => {
  it.runIf(DEVELOPMENT_RUN)('refuses a release run on the same selector', () => {
    expect(() => loadHoldoutsForRun(true)).toThrow(/is retired for [a-z]{2}/)
  })

  // The rules were tuned against these entries, so a Wilson bound on them would not estimate
  // new captions. The figures are the observed held count over the denominator, per locale; the
  // Wilson release gate is reserved for a fresh, eligible holdout. They go to the job log and,
  // when the PR step names a directory, to a development artifact the completeness check reads.
  it.runIf(DEVELOPMENT_RUN)(
    'reports the held count and denominator of each retired holdout as development data',
    () => {
      const figures = Object.fromEntries(
        languages.map((language) => {
          const { clean } = results.get(language) as LanguageResult
          expect(clean.total, language).toBeGreaterThanOrEqual(MINIMUM_CLEAN)
          return [
            language,
            {
              version: holdoutVersion(language),
              held: clean.withheld,
              total: clean.total,
            },
          ]
        })
      )
      process.stdout.write(
        `community text corpus, development data, not release evidence: ${Object.entries(
          figures
        )
          .map(([language, f]) => `${language} ${f.version} held ${f.held} of ${f.total}`)
          .join('; ')}\n`
      )
      const dir = process.env.COMMUNITY_SCREENING_DEVELOPMENT_DIR?.trim()
      if (!dir) return
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'text-corpus-development.json')
      fs.writeFileSync(
        file,
        `${JSON.stringify({ kind: 'development', measuredAt: new Date().toISOString(), languages: figures }, null, 2)}\n`
      )
      expect(Object.keys((readJson(file) as { languages: object }).languages)).toEqual(
        languages
      )
    }
  )
})

describe('development selection classification', () => {
  const seal = (version: string, locales: string[]) => ({
    corpusVersion: version,
    sealedAt: '2026-11-19T00:00:00.000Z',
    corpusSha256: 'c'.repeat(64),
    locales,
  })
  const retiredFor = (locales: string[]) => ({ locales, reason: 'tuned against' })
  const ledger = (
    eligible: Record<string, unknown>,
    retired: Record<string, unknown>
  ) => ({
    schemaVersion: 3,
    eligible,
    retired,
  })

  it('classifies a selection whose every pair is retired for its locale as retired', () => {
    expect(
      classifySelection(
        { de: 'holdout-v90', pt: 'holdout-v91' },
        ledger(
          {},
          { 'holdout-v90': retiredFor(['de']), 'holdout-v91': retiredFor(['pt']) }
        )
      )
    ).toBe('retired')
  })

  it('hands a selection with no retired pair to the strict loader', () => {
    expect(
      classifySelection(
        { de: 'holdout-v90' },
        ledger({ 'holdout-v90': seal('holdout-v90', ['de']) }, {})
      )
    ).toBe('none-retired')
  })

  it('refuses a retired pair beside an unclassified one', () => {
    expect(() =>
      classifySelection(
        { de: 'holdout-v90', pt: 'holdout-v91' },
        ledger({}, { 'holdout-v90': retiredFor(['de']) })
      )
    ).toThrow(/every selected holdout retired; pt: /)
  })

  it('refuses a retired pair beside an eligible fresh cohort', () => {
    expect(() =>
      classifySelection(
        { de: 'holdout-v90', pt: 'holdout-v91' },
        ledger(
          { 'holdout-v91': seal('holdout-v91', ['pt']) },
          { 'holdout-v90': retiredFor(['de']) }
        )
      )
    ).toThrow(/pt holdout-v91 is eligible/)
  })

  it('refuses a version retired only for another locale', () => {
    expect(() =>
      classifySelection(
        { de: 'holdout-v90', pt: 'holdout-v90' },
        ledger({}, { 'holdout-v90': retiredFor(['de']) })
      )
    ).toThrow(/every selected holdout retired; pt: /)
  })

  it('refuses a mixed selection before reading any freeze manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-mixed-'))
    try {
      const others = ['en', 'es', 'fr', 'it', 'pt', 'tr']
      fs.writeFileSync(
        path.join(dir, 'active-holdout.json'),
        JSON.stringify({
          schemaVersion: 2,
          locales: {
            de: 'holdout-v91',
            ...Object.fromEntries(others.map((locale) => [locale, 'holdout-v90'])),
          },
        })
      )
      fs.writeFileSync(
        path.join(dir, 'holdout-retirements.json'),
        JSON.stringify(
          ledger(
            { 'holdout-v91': seal('holdout-v91', ['de']) },
            { 'holdout-v90': retiredFor(others) }
          )
        )
      )
      const reads = vi.spyOn(fs, 'readFileSync')
      expect(() => loadHoldoutsForRun(false, dir)).toThrow(/de holdout-v91 is eligible/)
      expect(reads.mock.calls.map(([file]) => String(file))).toEqual([
        path.join(dir, 'active-holdout.json'),
        path.join(dir, 'holdout-retirements.json'),
      ])
      reads.mockRestore()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'another version',
      {
        corpusVersion: 'holdout-v999',
        sealedAt: '2026-10-28T00:00:00Z',
        corpusSha256: 'a'.repeat(64),
      },
      /names holdout-v999/,
    ],
    [
      'no seal time',
      { corpusVersion: 'holdout-v90', corpusSha256: 'a'.repeat(64) },
      /no valid sealedAt/,
    ],
    [
      'no aggregate hash',
      { corpusVersion: 'holdout-v90', sealedAt: '2026-10-28T00:00:00Z' },
      /no valid corpusSha256/,
    ],
  ])('refuses a retired manifest with %s', (_case, manifest, error) => {
    expect(() => developmentSeal('holdout-v90', manifest)).toThrow(error)
  })
})

describe('text corpus run product', () => {
  it('seals every version directory by exactly the locale files it holds', () => {
    for (const [version, manifest] of manifests) {
      assertVersionDirectorySealed(corpusDir, version, manifest)
      const named = Object.entries(holdouts)
        .filter(([, holdout]) => holdout.version === version)
        .map(([language]) => language)
      expect(manifest.files.map((file) => file.language)).toEqual(
        expect.arrayContaining(named)
      )
    }
    expect(Object.keys(holdouts).toSorted()).toEqual(languages.toSorted())
  })

  it('writes the measurement the readiness evidence consumes, when asked to', async () => {
    const outDir = process.env.COMMUNITY_SCREENING_RUN_PRODUCT_DIR?.trim()
    if (!outDir) return
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
      path.join(outDir, 'text-corpus-evaluation.json'),
      `${JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          inputSetHash: await currentInputSetHash(),
          policySha256: loaded.policySha256,
          textEngineVersion: loaded.identity.textEngineVersion,
          deliberateReviewTerms: (loaded.policy.text.deliberateReviewTerms ?? []).map(
            (entry) => ({ reason: entry.reason })
          ),
          gates: {
            ...describeCleanGates(holdouts),
            cleanWilson95UpperBoundMaximum: CLEAN_UPPER_BOUND_GATE,
            disallowedBypassesMaximum: 0,
            minimumClean: MINIMUM_CLEAN,
            minimumDisallowed: MINIMUM_DISALLOWED,
          },
          languages: Object.fromEntries(
            [...results.entries()].map(([language, result]) => [language, result])
          ),
        },
        null,
        2
      )}\n`
    )
  })
})
