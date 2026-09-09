// Learning path Step 39: Production content-screening readiness.
/*
 * Story 6.2 AC 9, the separately gated readiness suite.
 *
 * Runs only under `npm run test:community-screening-readiness --workspace api`,
 * which sets RUN_COMMUNITY_SCREENING_READINESS; `vitest.config.ts` excludes this
 * path otherwise, so an ordinary unit or coverage run never loads the real
 * model.
 *
 * The corpus assertions below need no model and run whenever the suite does.
 * They exist because AC 9 requires tests to assert non-empty corpora and branch
 * counts so that an empty fixture set cannot pass: a corpus that silently
 * emptied would otherwise make every downstream measurement vacuously green.
 *
 * The model lifecycle cases AC 9 also requires (startup handshake, warmup, safe
 * pass, low-confidence review, timeout termination, crash recovery, retry
 * success and exhaustion, truthful persisted identity, resource bounds) land
 * with the supervised inference controller and are not stubbed out here.
 * Nothing in this file is a placeholder for them.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import { CommunityTextScreener } from './community-text-screener.js'
import {
  TensorflowNsfwImageScreener,
  type NsfwImageScreeningResult,
} from './tensorflow-nsfw-image-screener.js'

const corpusDir = path.resolve(
  __dirname,
  '../../../test/fixtures/community-moderation/v1'
)
const policyPath = path.resolve(
  __dirname,
  '../../../policies/community-screening/policy-v1.json'
)

const NEUTRAL_BANDS = ['high', 'moderate', 'low'] as const

/**
 * `.strict()` throughout: an unrecognised key in a supply-chain manifest is a
 * drift signal, and silently ignoring it is how a manifest and its verifier stop
 * describing the same thing.
 */
const fixtureEntrySchema = z
  .object({
    path: z.string().regex(/^[a-z0-9-]+\.(jpg|png|webp)$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().positive(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    widthPx: z.number().int().min(256).max(4096),
    heightPx: z.number().int().min(256).max(4096),
    pattern: z.string().min(1),
    neutralBand: z.enum(NEUTRAL_BANDS),
    required: z.literal(true),
  })
  .strict()

const manifestSchema = z
  .object({
    corpusId: z.literal('community-moderation-safe-v1'),
    corpusVersion: z.literal('v1'),
    safetyClass: z.literal('synthetic-safe'),
    generator: z
      .object({
        script: z.string(),
        seed: z.number(),
        encoder: z.string(),
        note: z.string(),
      })
      .strict(),
    constraints: z
      .object({
        minDimensionPx: z.literal(256),
        maxDimensionPx: z.literal(4096),
        maxBytes: z.literal(10_485_760),
        allowedContentTypes: z.array(z.string()).nonempty(),
      })
      .strict(),
    requiredBands: z.array(z.enum(NEUTRAL_BANDS)).nonempty(),
    files: z.array(fixtureEntrySchema).nonempty(),
  })
  .strict()

function readManifest() {
  const raw = fs.readFileSync(path.join(corpusDir, 'manifest.json'), 'utf8')
  return manifestSchema.parse(JSON.parse(raw))
}

describe('community screening readiness: fixture corpus', () => {
  it('pins a non-empty corpus whose every entry exists with the declared bytes', () => {
    const manifest = readManifest()

    expect(manifest.files.length).toBeGreaterThan(0)

    for (const entry of manifest.files) {
      const bytes = fs.readFileSync(path.join(corpusDir, entry.path))
      expect(bytes.length, `${entry.path} is empty`).toBeGreaterThan(0)
      expect(bytes.length, `${entry.path} byte size drifted`).toBe(entry.byteSize)
      expect(
        createHash('sha256').update(bytes).digest('hex'),
        `${entry.path} content drifted from its pinned hash`
      ).toBe(entry.sha256)
    }
  })

  it('covers every declared confidence band', () => {
    const manifest = readManifest()

    for (const band of manifest.requiredBands) {
      const inBand = manifest.files.filter((entry) => entry.neutralBand === band)
      expect(
        inBand.length,
        `No fixture covers the "${band}" band, so a branch the policy can take has no input.`
      ).toBeGreaterThan(0)
    }
  })

  /*
   * The assertion that makes the corpus worth having. The policy publishes
   * automatically only above `neutralPassMinimum`, so a corpus sitting entirely
   * on one side of that line exercises exactly one branch while still reporting
   * a healthy fixture count. `low` is defined as below the threshold and the
   * other two bands above it, so a corpus that straddles it reaches both `pass`
   * and `review` from safe input alone, with no unsafe bytes in the repository.
   */
  it('straddles the policy pass threshold so both dispositions are reachable', () => {
    const manifest = readManifest()
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as {
      image: { neutralPassMinimum: number }
    }

    expect(policy.image.neutralPassMinimum).toBeGreaterThan(0)
    expect(policy.image.neutralPassMinimum).toBeLessThan(1)

    const belowThreshold = manifest.files.filter((entry) => entry.neutralBand === 'low')
    const aboveThreshold = manifest.files.filter((entry) => entry.neutralBand !== 'low')

    expect(
      belowThreshold.length,
      'No fixture sits below the policy pass threshold, so the review branch is unreachable from this corpus.'
    ).toBeGreaterThan(0)
    expect(
      aboveThreshold.length,
      'No fixture sits above the policy pass threshold, so the pass branch is unreachable from this corpus.'
    ).toBeGreaterThan(0)
  })

  it('pins each fixture exactly once and leaves nothing in the directory unpinned', () => {
    const manifest = readManifest()

    const hashes = manifest.files.map((entry) => entry.sha256)
    expect(
      new Set(hashes).size,
      'Two entries share a SHA-256, so the same image is pinned under two names and the corpus is smaller than its count suggests.'
    ).toBe(hashes.length)

    const paths = manifest.files.map((entry) => entry.path)
    expect(new Set(paths).size).toBe(paths.length)

    const onDisk = fs
      .readdirSync(corpusDir)
      .filter((name) => name !== 'manifest.json' && !name.startsWith('.'))
    expect(
      onDisk.slice().sort(),
      'A file in the corpus directory is not pinned by the manifest, so it is unverified content in a directory whose purpose is that everything is verified.'
    ).toEqual(paths.slice().sort())
  })

  it('covers more than one container format and the minimum legal dimension', () => {
    const manifest = readManifest()

    const formats = new Set(manifest.files.map((entry) => entry.contentType))
    expect(
      formats.size,
      'A single-format corpus cannot catch a decode path that only breaks for one container.'
    ).toBeGreaterThan(1)
    for (const contentType of formats) {
      expect(manifest.constraints.allowedContentTypes).toContain(contentType)
    }

    expect(
      manifest.files.some(
        (entry) =>
          entry.widthPx === manifest.constraints.minDimensionPx &&
          entry.heightPx === manifest.constraints.minDimensionPx
      ),
      'No fixture sits at the minimum accepted dimension, so the validator boundary is never exercised with real bytes.'
    ).toBe(true)
  })
})

/*
 * The real-model half. It loads the pinned model through the same screener the
 * worker uses, screens every committed fixture, and writes the run product the
 * evidence emitter consumes.
 *
 * It measures no latency percentiles of its own. AC 8's 1,000-inference
 * measurement belongs to the compiled harness and is committed in the model
 * manifest's `performance` block, because a number taken inside a vitest
 * transform is not comparable: the same harness under a transpiler reported
 * roughly twice the peak resident set with esbuild in the process. What this
 * suite is uniquely able to record is the identity that actually ran and the
 * disposition the pinned policy gives each fixture.
 */
const intermediateDir = path.resolve(__dirname, '../../../.cache/community-screening')
const intermediatePath = path.join(intermediateDir, 'readiness-measurements.json')
const modelManifestPath = path.resolve(
  __dirname,
  '../../../model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
)

function sha256Of(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function headCommitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../../../../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

describe('community screening readiness: real model', () => {
  const screener = new TensorflowNsfwImageScreener({})
  const results = new Map<string, NsfwImageScreeningResult>()

  beforeAll(async () => {
    await screener.ensureReady()
  }, 60_000)

  afterAll(async () => {
    await screener.close()
  })

  it('completes the readiness handshake with a truthful identity', () => {
    const identity = screener.runtimeIdentity
    expect(identity).not.toBeNull()
    expect(identity?.packageVersion).toBe('4.3.0')
    expect(identity?.backend).toBe('wasm')

    /*
     * The claim the whole payload rests on. `engineVersion` reads `unresolved`
     * before readiness and carries a `fixture` marker when a fixture produced
     * the verdict, so a run that quietly used neither the real model nor a
     * completed handshake cannot report itself as a real-model run.
     */
    const engineVersion = screener.engineVersion
    expect(engineVersion).not.toContain('unresolved')
    expect(engineVersion).not.toContain('fixture')
    expect(engineVersion).toContain(String(identity?.packageVersion))
  })

  it('screens every committed fixture into a valid five-class result', async () => {
    const manifest = readManifest()
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as {
      image: { classNames: string[]; probabilitySumTolerance: number }
    }

    for (const entry of manifest.files) {
      const bytes = fs.readFileSync(path.join(corpusDir, entry.path))
      const result = await screener.screen(bytes)
      results.set(entry.path, result)

      expect(
        Object.keys(result.classProbabilities).sort(),
        `${entry.path} returned a class-name set the policy does not recognise`
      ).toEqual([...policy.image.classNames].sort())

      for (const [className, probability] of Object.entries(result.classProbabilities)) {
        expect(
          Number.isFinite(probability),
          `${entry.path} ${className} is not finite`
        ).toBe(true)
        expect(probability).toBeGreaterThanOrEqual(0)
        expect(probability).toBeLessThanOrEqual(1)
      }

      const sum = Object.values(result.classProbabilities).reduce(
        (total, value) => total + value,
        0
      )
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(policy.image.probabilitySumTolerance)
    }
  }, 120_000)

  /*
   * The branch-count assertion AC 9 asks for, made against what the model
   * actually returned rather than against the manifest's authoring-time bands.
   * A safe corpus that produced a single disposition would exercise one branch
   * while still looking healthy, and a safe corpus that blocked anything would
   * mean the policy refuses ordinary fashion texture.
   */
  it('reaches both the pass and the review branch and blocks nothing safe', () => {
    expect(results.size).toBeGreaterThan(0)

    const byDisposition = new Map<string, string[]>()
    for (const [fixture, result] of results) {
      byDisposition.set(result.disposition, [
        ...(byDisposition.get(result.disposition) ?? []),
        fixture,
      ])
    }

    expect(
      byDisposition.get('pass')?.length ?? 0,
      'No safe fixture reached pass, so the policy publishes nothing and the pass branch is untested.'
    ).toBeGreaterThan(0)
    expect(
      byDisposition.get('review')?.length ?? 0,
      'No safe fixture reached review, so the low-confidence branch is untested by real bytes.'
    ).toBeGreaterThan(0)
    expect(
      byDisposition.get('block') ?? [],
      'A synthetic safe fixture was blocked, which means the policy refuses ordinary fabric texture.'
    ).toEqual([])
  })

  /*
   * Ties the manifest's authoring-time band labels to what the model actually
   * returns. Without this the bands are author-typed literals: a corpus whose
   * images all scored 0.99 would still declare two `low` entries, still satisfy
   * every band-coverage check, and still leave the review branch unreachable
   * while the counts looked healthy. Drift here is a real signal, either the
   * bytes changed or the model did, and both invalidate the corpus.
   */
  it('agrees with the Neutral band each fixture is pinned to', () => {
    const manifest = readManifest()
    const bandOf = (neutral: number): (typeof NEUTRAL_BANDS)[number] =>
      neutral >= 0.93 ? 'high' : neutral >= 0.85 ? 'moderate' : 'low'

    for (const entry of manifest.files) {
      const result = results.get(entry.path)
      expect(result, `${entry.path} was never screened`).toBeDefined()
      const neutral = result?.classProbabilities.Neutral ?? Number.NaN
      expect(
        bandOf(neutral),
        `${entry.path} is pinned as "${entry.neutralBand}" but measured Neutral ${neutral.toFixed(4)}`
      ).toBe(entry.neutralBand)
    }
  })

  it('writes the run product the evidence emitter consumes', () => {
    const identity = screener.runtimeIdentity
    const corpusDispositions = [...results.entries()].map(([fixture, result]) => ({
      fixture,
      disposition: result.disposition,
      classProbabilities: result.classProbabilities,
      reasons: result.reasons,
    }))

    /*
     * The text half of the persisted identity, taken from a screening the
     * production wiring actually performed rather than composed here. The
     * worker runtime builds this screener from the loaded policy, and what it
     * stamps on a row is the `policyVersion` it hands back, so that is what the
     * evidence records. Until this ran, the payload carried `null` for the text
     * half of an identity it described as recorded by the readiness run.
     */
    const loaded = loadCommunityScreeningPolicy()
    const textScreener = new CommunityTextScreener({
      policy: loaded.policy.text,
      policyVersion: loaded.identity.textEngineVersion,
    })
    const textScreening = textScreener.screen({
      text: 'A plum satin wrap dress.',
      field: 'caption',
      locale: 'en-US',
    })
    expect(textScreening.disposition).toBe('pass')
    expect(textScreening.policyVersion).toContain(loaded.policySha256.slice(0, 12))

    fs.mkdirSync(intermediateDir, { recursive: true })
    fs.writeFileSync(
      intermediatePath,
      `${JSON.stringify(
        {
          commitSha: headCommitSha(),
          modelManifestSha256: sha256Of(modelManifestPath),
          policySha256: sha256Of(policyPath),
          fixtureManifestSha256: sha256Of(path.join(corpusDir, 'manifest.json')),
          lockfileSha256: sha256Of(
            path.resolve(__dirname, '../../../../../package-lock.json')
          ),
          screeningPath: 'tensorflow',
          measuredAt: new Date().toISOString(),
          identity: {
            textEngineVersion: textScreening.policyVersion,
            imageEngineVersion: screener.engineVersion,
          },
          modelDigest: identity?.modelDigest ?? null,
          policyVersion: identity?.policyVersion ?? null,
          policyDigest: identity?.policyDigest ?? null,
          corpusDispositions,
        },
        null,
        2
      )}\n`
    )

    expect(fs.existsSync(intermediatePath)).toBe(true)
  })
})
