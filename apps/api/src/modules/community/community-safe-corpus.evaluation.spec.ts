// Story 6.2b, AC 4: the safe-content false-positive measurement on real photographs.
//
// Runs only under `npm run community:screening:corpus:evaluate`, which sets
// RUN_COMMUNITY_SAFE_CORPUS_EVALUATION; `vitest.config.ts` excludes it otherwise,
// because it loads the real model and reads licensed bytes that live outside Git.
//
// Every photograph takes the production path: the stored bytes are verified
// against their declaration and re-encoded by `verifyAndNormalizeCommunityImage`,
// exactly as the moderation processor does before inference, and the normalized
// bytes are screened by the real TensorFlow.js screener under the pinned policy.
// The measured quantity is the share the policy withholds (review or block),
// because every one of those reaches a moderator. The gate is a Wilson 95% upper
// bound at or below 5%, computed on the HOLDOUT half only: the policy threshold
// was chosen on the calibration half (scripts/calibrate-community-screening-models.mjs),
// and measuring it on the photographs it was tuned on would measure the tuning.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CommunityImageValidationError,
  verifyAndNormalizeCommunityImage,
  type CommunityMimeType,
} from './community-image-validation.js'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import {
  TensorflowNsfwImageScreener,
  type NsfwImageScreeningResult,
} from './tensorflow-nsfw-image-screener.js'

/** The input-set hash the readiness generator checks every run product against. */
async function currentInputSetHash(): Promise<string> {
  const helperPath = path.resolve(
    __dirname,
    '../../../../../scripts/lib/community-screening-input-set.mjs'
  )
  const module = (await import(helperPath)) as { inputSetHash: () => string }
  return module.inputSetHash()
}

const apiRoot = path.resolve(__dirname, '../../..')
const manifestPath = path.join(
  apiRoot,
  'test/fixtures/community-safe-corpus/manifest.json'
)
const MINIMUM_COUNT = 500
const MINIMUM_HOLDOUT = 250
const WITHHELD_UPPER_BOUND_GATE = 0.05
const COMMERCIAL_LICENCES = new Set(['by', 'by-sa', 'by-nd', 'cc0', 'pdm'])

interface CorpusEntry {
  id: string
  split: 'calibration' | 'holdout'
  license: string
  sha256: string
  byteSize: number
  contentType: string
  file: string
  source: string
  creator?: string | null
}

function storeDirectory(): string {
  const base = process.env.COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR?.trim()
  return base
    ? path.resolve(base, 'safe-photographs-v1')
    : path.join(apiRoot, '.cache/community-screening-corpus/safe-photographs-v1')
}

function wilsonInterval(successes: number, trials: number): [number, number] {
  if (trials === 0) return [0, 1]
  const z = 1.959963984540054
  const proportion = successes / trials
  const denominator = 1 + (z * z) / trials
  const centre = (proportion + (z * z) / (2 * trials)) / denominator
  const half =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion)) / trials + (z * z) / (4 * trials * trials)
      )) /
    denominator
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

const manifestBytes = fs.readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes.toString('utf8')) as { entries: CorpusEntry[] }
const store = storeDirectory()
const holdout = manifest.entries.filter((entry) => entry.split === 'holdout')

describe('safe photograph corpus: integrity', () => {
  it('holds at least the minimum count, every entry commercially licensed and unique', async () => {
    const { splitOf } = (await import(
      path.resolve(apiRoot, '../../scripts/fetch-community-safe-corpus.mjs')
    )) as { splitOf: (entry: CorpusEntry) => 'calibration' | 'holdout' }
    expect(manifest.entries.length).toBeGreaterThanOrEqual(MINIMUM_COUNT)
    const ids = new Set(manifest.entries.map((entry) => entry.id))
    const hashes = new Set(manifest.entries.map((entry) => entry.sha256))
    expect(ids.size).toBe(manifest.entries.length)
    expect(hashes.size).toBe(manifest.entries.length)
    for (const entry of manifest.entries) {
      expect(COMMERCIAL_LICENCES.has(entry.license), `${entry.id} ${entry.license}`).toBe(
        true
      )
      // Split by creator, the rule the fetch script assigns (Story 6.2b review,
      // BH7): one photographer's shots never straddle the two halves.
      expect(entry.split, `${entry.id} split`).toBe(splitOf(entry))
    }
    expect(holdout.length).toBeGreaterThanOrEqual(MINIMUM_HOLDOUT)
  })

  it('finds every photograph in the store with the bytes the manifest pins', () => {
    expect(fs.existsSync(store), `corpus store ${store} is missing`).toBe(true)
    for (const entry of manifest.entries) {
      const bytes = fs.readFileSync(path.join(store, entry.file))
      expect(createHash('sha256').update(bytes).digest('hex'), entry.id).toBe(
        entry.sha256
      )
    }
  })
})

describe('safe photograph corpus: screening', () => {
  const screener = new TensorflowNsfwImageScreener()
  const outcomes: {
    id: string
    disposition: string
    neutral: number | null
    classProbabilities: Record<string, number>
    reasons: string[]
  }[] = []
  const validationRejected: { id: string; code: string }[] = []

  beforeAll(async () => {
    await screener.ensureReady()
  }, 60_000)

  afterAll(async () => {
    await screener.close()
  })

  it('screens every holdout photograph through the production normalization path', async () => {
    for (const entry of holdout) {
      const raw = fs.readFileSync(path.join(store, entry.file))
      let normalized: Buffer
      try {
        const result = await verifyAndNormalizeCommunityImage(raw, {
          byteSize: raw.length,
          mimeType: entry.contentType as CommunityMimeType,
          sha256: entry.sha256,
        })
        normalized = result.bytes
      } catch (error) {
        if (error instanceof CommunityImageValidationError) {
          validationRejected.push({ id: entry.id, code: error.code })
          continue
        }
        throw error
      }
      const screened: NsfwImageScreeningResult = await screener.screen(normalized)
      outcomes.push({
        id: entry.id,
        disposition: screened.disposition,
        neutral: screened.classProbabilities.Neutral ?? null,
        // Bounded model output only: five probabilities, no bytes, no URL. The
        // evidence generator derives the threshold sensitivity table from them.
        classProbabilities: screened.classProbabilities,
        reasons: screened.reasons,
      })
    }
    expect(outcomes.length + validationRejected.length).toBe(holdout.length)
    expect(outcomes.length).toBeGreaterThanOrEqual(MINIMUM_HOLDOUT)
  }, 600_000)

  it('records the withheld rate, its Wilson interval and the gate result', async () => {
    const withheld = outcomes.filter((outcome) => outcome.disposition !== 'pass')
    const blocked = outcomes.filter((outcome) => outcome.disposition === 'block')
    const [lower, upper] = wilsonInterval(withheld.length, outcomes.length)
    const loaded = loadCommunityScreeningPolicy()

    const outDir = process.env.COMMUNITY_SCREENING_RUN_PRODUCT_DIR?.trim()
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(
        path.join(outDir, 'safe-corpus-evaluation.json'),
        `${JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            inputSetHash: await currentInputSetHash(),
            manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
            policySha256: loaded.policySha256,
            engineVersion: screener.engineVersion,
            modelDigest: screener.runtimeIdentity?.modelDigest ?? null,
            corpusEntries: manifest.entries.length,
            split: 'holdout',
            holdoutEntries: holdout.length,
            evaluated: outcomes.length,
            validationRejected,
            counts: {
              pass: outcomes.length - withheld.length,
              review: withheld.length - blocked.length,
              block: blocked.length,
            },
            withheld: withheld.length,
            withheldRate: withheld.length / outcomes.length,
            wilson95: [lower, upper],
            gate: {
              metric: 'Wilson 95% upper bound of the withheld (review or block) rate',
              maximum: WITHHELD_UPPER_BOUND_GATE,
              passed: upper <= WITHHELD_UPPER_BOUND_GATE,
            },
            perEntry: outcomes,
          },
          null,
          2
        )}\n`
      )
    }

    // The safe corpus must never be blocked: block is reserved for a confident
    // unsafe class, and an ordinary fashion photograph reaching it would mean the
    // block floor is mis-set, which is a defect whatever the review rate is.
    expect(blocked.map((outcome) => outcome.id)).toEqual([])
    expect(outcomes.length).toBeGreaterThan(0)
  })

  it('keeps the Wilson 95% upper bound of the withheld rate at or below 5%', () => {
    const withheld = outcomes.filter((outcome) => outcome.disposition !== 'pass').length
    const [, upper] = wilsonInterval(withheld, outcomes.length)
    expect(
      upper,
      `${withheld} of ${outcomes.length} safe photographs withheld; Wilson 95% upper bound ${(upper * 100).toFixed(2)}%`
    ).toBeLessThanOrEqual(WITHHELD_UPPER_BOUND_GATE)
  })
})
