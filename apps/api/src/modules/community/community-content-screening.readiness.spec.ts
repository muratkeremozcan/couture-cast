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
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

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
