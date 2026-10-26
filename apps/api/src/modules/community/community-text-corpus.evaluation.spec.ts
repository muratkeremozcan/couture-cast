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
// It runs in the ordinary unit suite, so a term list or allow-list change that
// starts flagging ordinary copy, or opens a bypass, fails the pull request that
// made it. Failure messages carry case ids and reason codes and never the text
// or a matched term, which keeps raw terms out of logs and evidence.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLEAN_HOLDOUT_UPPER_BOUND_MAXIMUM,
  passesCleanHoldoutGate,
  wilsonInterval,
} from './community-text-corpus-gate.js'
import { assertActiveHoldoutEligible } from './community-text-holdout-eligibility.js'
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
const activeHoldout = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'active-holdout.json'), 'utf8')
) as { corpusVersion: string }
const holdoutVersion = activeHoldout.corpusVersion
if (!/^holdout-v[1-9]\d*$/.test(holdoutVersion)) {
  throw new Error('active text holdout version is invalid')
}
const freezeManifest = JSON.parse(
  fs.readFileSync(path.join(corpusDir, holdoutVersion, 'freeze-manifest.json'), 'utf8')
) as {
  corpusVersion: string
  sealedAt: string
  corpusSha256: string
  files: { language: string; path: string; sha256: string }[]
}
const retirementLedger = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'holdout-retirements.json'), 'utf8')
) as { schemaVersion: number; retired: Record<string, string> }
if (retirementLedger.schemaVersion !== 1) {
  throw new Error('text holdout retirement ledger schema is invalid')
}
assertActiveHoldoutEligible(holdoutVersion, freezeManifest, retirementLedger.retired)

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
  return JSON.parse(
    fs.readFileSync(path.join(corpusDir, holdoutVersion, `${language}.json`), 'utf8')
  ) as Holdout
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

/** Set by the release command that writes the run product. */
const RELEASE_RUN = Boolean(process.env.COMMUNITY_SCREENING_RUN_PRODUCT_DIR?.trim())

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
    expect(holdout.corpusVersion).toBe(holdoutVersion)
    expect(holdout.entries.length).toBeGreaterThanOrEqual(MINIMUM_CLEAN)
    const ids = holdout.entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    const inSample = new Set(corpus.clean.entries.map((entry) => entry.text))
    expect(holdout.entries.filter((entry) => inSample.has(entry.text))).toEqual([])
  })

  it('matches the independent corpus seal recorded before repair inspection', () => {
    expect(freezeManifest.corpusVersion).toBe(holdoutVersion)
    const sealed = freezeManifest.files.filter((file) => file.language === language)
    expect(sealed).toHaveLength(1)
    expect(sealed[0]?.path).toBe(
      `apps/api/test/fixtures/community-text-corpus/${holdoutVersion}/${language}.json`
    )
    const digest = createHash('sha256')
      .update(fs.readFileSync(path.join(corpusDir, holdoutVersion, `${language}.json`)))
      .digest('hex')
    expect(digest).toBe(sealed[0]?.sha256)
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

describe('text corpus run product', () => {
  it('matches the complete seven-language corpus seal', () => {
    expect(freezeManifest.files.map((file) => file.language).toSorted()).toEqual(
      languages.toSorted()
    )
    const material = freezeManifest.files
      .toSorted((a, b) => a.path.localeCompare(b.path, 'en'))
      .map((file) => `${file.path}\0${file.sha256}\n`)
      .join('')
    expect(createHash('sha256').update(material).digest('hex')).toBe(
      freezeManifest.corpusSha256
    )
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
            cleanGatedOn: holdoutVersion,
            corpusSha256: freezeManifest.corpusSha256,
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
