import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADR013_IMAGE_ENGINE_VERSION } from './community-moderation.engine.js'
import { readModelManifest } from './community-nsfw-inference.worker.js'
import type { NsfwRuntimeIdentity } from './community-nsfw-inference.worker.js'
import {
  COMMUNITY_NSFW_MANIFEST_ENV,
  COMMUNITY_NSFW_SCREENER_TENSORFLOW,
  NSFW_IMAGE_REASON_CODES,
  NSFW_MIRRORED_THRESHOLD_KEYS,
  NSFW_REASON_CLASS_MISMATCH,
  NSFW_REASON_LOW_CONFIDENCE,
  NSFW_REASON_OUTPUT_INVALID,
  NSFW_REASON_PROBABILITY_SUM_INVALID,
  NSFW_REASON_UNSAFE_CLASS,
  assertReasonCodesArePolicyWired,
  composeEngineVersion,
  evaluateNsfwDisposition,
  loadApprovedPolicy,
  resolveManifestPath,
} from './tensorflow-nsfw-image-screener.js'
import type { NsfwImagePolicy } from './tensorflow-nsfw-image-screener.js'

const CLASS_NAMES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy']

/** The thresholds `policies/community-screening/policy-v1.json` ships. */
const POLICY: NsfwImagePolicy = {
  classNames: CLASS_NAMES,
  neutralPassMinimum: 0.85,
  unsafeAggregateMaximum: 0.1,
  unsafeBlockMinimum: 0.35,
  unsafeClasses: ['Hentai', 'Porn'],
  probabilitySumTolerance: 0.001,
  boundaryDisposition: 'review',
}

const REASON_CODES: Record<string, 'pass' | 'review' | 'block'> = {
  unsafe_class: 'block',
  low_confidence: 'review',
  output_invalid: 'review',
  class_mismatch: 'review',
  probability_sum_invalid: 'review',
  inference_timeout: 'review',
  screening_unavailable: 'review',
}

/**
 * Builds a vector in canonical class order, parking whatever is left of the
 * probability mass on `Drawing` so the sum check is never what a threshold
 * test is accidentally measuring.
 */
function vector(parts: Record<string, number>): number[] {
  const assigned = Object.values(parts).reduce((sum, value) => sum + value, 0)
  const filled: Record<string, number> = { Drawing: 1 - assigned, ...parts }
  return CLASS_NAMES.map((className) => filled[className] ?? 0)
}

const temporaryDirectories: string[] = []

function manifestFixture(
  overrides: {
    policy?: Record<string, unknown>
    image?: Record<string, unknown>
    reasonCodes?: Record<string, 'pass' | 'review' | 'block'>
    thresholds?: Record<string, unknown>
    classNames?: string[]
  } = {}
): { manifestPath: string; policyPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-nsfw-policy-'))
  temporaryDirectories.push(directory)
  const manifestDirectory = path.join(directory, 'model-manifests')
  const policyDirectory = path.join(directory, 'policies', 'community-screening')
  fs.mkdirSync(manifestDirectory, { recursive: true })
  fs.mkdirSync(policyDirectory, { recursive: true })

  const policyPath = path.join(policyDirectory, 'policy-v1.json')
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      version: 'v1',
      image: { ...POLICY, ...overrides.image },
      reasonCodes: { image: overrides.reasonCodes ?? REASON_CODES },
      ...overrides.policy,
    })
  )
  const sha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(policyPath))
    .digest('hex')

  const manifestPath = path.join(manifestDirectory, 'community-nsfw-mobilenet.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      modelFamily: 'mobilenet_v2_mid',
      packageName: 'nsfwjs',
      packageVersion: '4.3.0',
      modelSubpath: 'nsfwjs/models/mobilenet_v2_mid',
      backend: 'wasm',
      inputWidth: 224,
      inputHeight: 224,
      inputChannels: 3,
      inputScale: 255,
      outputShape: [1, 5],
      classNames: overrides.classNames ?? CLASS_NAMES,
      modelFiles: [{ package: 'nsfwjs', path: 'dist/x.js', sha256: 'a'.repeat(64) }],
      wasmFiles: [
        {
          package: '@tensorflow/tfjs-backend-wasm',
          binaryName: 'tfjs-backend-wasm.wasm',
          path: 'dist/tfjs-backend-wasm.wasm',
          sha256: 'b'.repeat(64),
        },
      ],
      policy: {
        path: '../policies/community-screening/policy-v1.json',
        version: 'v1',
        sha256,
      },
      ...(overrides.thresholds ? { thresholds: overrides.thresholds } : {}),
    })
  )

  return { manifestPath, policyPath }
}

function mirrorOf(policy: NsfwImagePolicy): Record<string, unknown> {
  const source = policy as unknown as Record<string, unknown>
  return Object.fromEntries(NSFW_MIRRORED_THRESHOLD_KEYS.map((key) => [key, source[key]]))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('evaluateNsfwDisposition', () => {
  it('passes a confident Neutral vector with no reasons', () => {
    const result = evaluateNsfwDisposition(vector({ Neutral: 0.95 }), CLASS_NAMES, POLICY)

    expect(result.disposition).toBe('pass')
    expect(result.reasons).toEqual([])
    expect(result.classProbabilities.Neutral).toBe(0.95)
  })

  it('reproduces the benign reference vector as a pass', () => {
    const reference = [0.0484, 0.0421, 0.9063, 0.0015, 0.0016]

    const result = evaluateNsfwDisposition(reference, CLASS_NAMES, POLICY)

    expect(result.disposition).toBe('pass')
  })

  // AC 2 routes a threshold-boundary result to review, so every comparison is
  // strict and each boundary below is crossed from both sides.
  it.each([
    ['above the Neutral floor', 0.8500001, 'pass'],
    ['exactly on the Neutral floor', 0.85, 'review'],
    ['below the Neutral floor', 0.8499999, 'review'],
  ])('treats Neutral %s as %s', (_label, neutral, disposition) => {
    const result = evaluateNsfwDisposition(
      vector({ Neutral: neutral }),
      CLASS_NAMES,
      POLICY
    )

    expect(result.disposition).toBe(disposition)
  })

  it.each([
    ['above the block floor', 0.3500001, 'block', NSFW_REASON_UNSAFE_CLASS],
    ['exactly on the block floor', 0.35, 'review', NSFW_REASON_LOW_CONFIDENCE],
    ['below the block floor', 0.3499999, 'review', NSFW_REASON_LOW_CONFIDENCE],
  ])('treats Porn %s as %s', (_label, porn, disposition, reason) => {
    const result = evaluateNsfwDisposition(
      vector({ Porn: porn, Neutral: 0.3 }),
      CLASS_NAMES,
      POLICY
    )

    expect(result.disposition).toBe(disposition)
    expect(result.reasons).toEqual([reason])
  })

  it.each([
    ['below the aggregate ceiling', { Neutral: 0.91, Porn: 0.05, Hentai: 0.04 }, 'pass'],
    [
      'exactly on the aggregate ceiling',
      { Neutral: 0.9, Porn: 0.05, Hentai: 0.05 },
      'review',
    ],
    [
      'above the aggregate ceiling',
      { Neutral: 0.89, Porn: 0.06, Hentai: 0.05 },
      'review',
    ],
  ])('treats an unsafe aggregate %s as %s', (_label, parts, disposition) => {
    const result = evaluateNsfwDisposition(vector(parts), CLASS_NAMES, POLICY)

    expect(result.disposition).toBe(disposition)
  })

  // The exact vector that published before the aggregate condition existed:
  // Neutral clears its floor and Porn never reaches the block floor.
  it('withholds a confident Neutral that still carries substantial unsafe mass', () => {
    const result = evaluateNsfwDisposition(
      vector({ Neutral: 0.86, Porn: 0.13 }),
      CLASS_NAMES,
      POLICY
    )

    expect(result.classProbabilities.Neutral).toBeGreaterThan(POLICY.neutralPassMinimum)
    expect(result.classProbabilities.Porn).toBeLessThan(POLICY.unsafeBlockMinimum)
    expect(result.disposition).toBe('review')
    expect(result.reasons).toEqual([NSFW_REASON_LOW_CONFIDENCE])
  })

  it('blocks on any configured unsafe class, not only the first', () => {
    const result = evaluateNsfwDisposition(
      vector({ Hentai: 0.9, Neutral: 0.05 }),
      CLASS_NAMES,
      POLICY
    )

    expect(result.disposition).toBe('block')
    expect(result.reasons).toEqual([NSFW_REASON_UNSAFE_CLASS])
  })

  // Sexy is deliberately not a blocking class, because swimwear and eveningwear
  // score it legitimately. It still cannot publish, because the Neutral it
  // displaces is what the pass gate needs.
  it('withholds rather than blocks a high Sexy score', () => {
    const result = evaluateNsfwDisposition(
      vector({ Sexy: 0.7, Neutral: 0.25 }),
      CLASS_NAMES,
      POLICY
    )

    expect(result.disposition).toBe('review')
  })

  // The shipped thresholds cannot both be met by a vector summing to one, so
  // the precedence of block over pass is only observable under overlapping
  // thresholds. It is asserted because the ordering is the fail-closed
  // guarantee, not an accident of the numbers we happen to ship.
  it('lets an unsafe class veto an otherwise publishable vector', () => {
    const overlapping: NsfwImagePolicy = {
      ...POLICY,
      neutralPassMinimum: 0.4,
      unsafeBlockMinimum: 0.3,
      unsafeAggregateMaximum: 0.9,
    }

    const blocked = evaluateNsfwDisposition(
      vector({ Neutral: 0.5, Porn: 0.31 }),
      CLASS_NAMES,
      overlapping
    )
    const onTheFloor = evaluateNsfwDisposition(
      vector({ Neutral: 0.5, Porn: 0.3 }),
      CLASS_NAMES,
      overlapping
    )

    expect(blocked.disposition).toBe('block')
    // Exactly on the block floor is a boundary, so it may resolve neither to
    // block nor to pass even though every other pass condition is satisfied.
    expect(onTheFloor.disposition).toBe('review')
  })

  it.each([
    ['a short vector', [0.2, 0.2, 0.6]],
    ['a long vector', [0.1, 0.1, 0.6, 0.1, 0.05, 0.05]],
  ])('routes %s to review as invalid output', (_label, probabilities) => {
    const result = evaluateNsfwDisposition(probabilities, CLASS_NAMES, POLICY)

    expect(result.disposition).toBe('review')
    expect(result.reasons).toEqual([NSFW_REASON_OUTPUT_INVALID])
  })

  it.each([
    ['NaN', vector({ Neutral: Number.NaN })],
    ['Infinity', [0, 0, Number.POSITIVE_INFINITY, 0, 0]],
    ['a negative probability', [-0.1, 0.05, 0.95, 0.05, 0.05]],
    ['a probability above one', [0, 0, 1.4, 0, 0]],
  ])('routes %s to review as invalid output', (_label, probabilities) => {
    const result = evaluateNsfwDisposition(probabilities, CLASS_NAMES, POLICY)

    expect(result.disposition).toBe('review')
    expect(result.reasons).toEqual([NSFW_REASON_OUTPUT_INVALID])
  })

  it.each([
    ['a truncated vector summing far below one', [0.01, 0.01, 0.2, 0.01, 0.01]],
    ['an unnormalised vector summing above one', [0.5, 0.1, 0.9, 0.1, 0.1]],
  ])('routes %s to review as an invalid probability sum', (_label, probabilities) => {
    const result = evaluateNsfwDisposition(probabilities, CLASS_NAMES, POLICY)

    expect(result.disposition).toBe('review')
    expect(result.reasons).toEqual([NSFW_REASON_PROBABILITY_SUM_INVALID])
  })

  it('accepts a sum that drifts within the configured tolerance', () => {
    const drifted = [0.0305, 0.005, 0.9545, 0.005, 0.0059]
    const sum = drifted.reduce((total, value) => total + value, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(POLICY.probabilitySumTolerance)

    expect(evaluateNsfwDisposition(drifted, CLASS_NAMES, POLICY).disposition).toBe('pass')
  })

  it.each([
    ['the model omits Neutral', ['Drawing', 'Hentai', 'Porn', 'Sexy', 'Anime']],
    [
      'the model renames an unsafe class',
      ['Drawing', 'Anime', 'Neutral', 'Explicit', 'Sexy'],
    ],
  ])('routes a class mismatch to review when %s', (_label, classNames) => {
    const result = evaluateNsfwDisposition(
      [0.02, 0.01, 0.95, 0.01, 0.01],
      classNames,
      POLICY
    )

    expect(result.disposition).toBe('review')
    expect(result.reasons).toEqual([NSFW_REASON_CLASS_MISMATCH])
  })

  // AC 7 in one assertion: across the whole probability grid, `pass` is
  // reachable only through all three conditions holding at once.
  it('never reaches pass unless every pass condition holds', () => {
    let passes = 0
    for (let neutral = 0; neutral <= 1.0001; neutral += 0.01) {
      for (let porn = 0; porn <= 1 - neutral + 0.0001; porn += 0.02) {
        for (const hentai of [0, Math.max(0, 1 - neutral - porn)]) {
          const result = evaluateNsfwDisposition(
            vector({ Neutral: neutral, Porn: porn, Hentai: hentai }),
            CLASS_NAMES,
            POLICY
          )
          if (result.disposition !== 'pass') continue
          passes += 1
          expect(result.classProbabilities.Neutral).toBeGreaterThan(
            POLICY.neutralPassMinimum
          )
          expect(porn + hentai).toBeLessThan(POLICY.unsafeAggregateMaximum)
          expect(Math.max(porn, hentai)).toBeLessThan(POLICY.unsafeBlockMinimum)
        }
      }
    }

    // A grid that produced no passes would satisfy the implication vacuously.
    expect(passes).toBeGreaterThan(0)
  })
})

describe('composeEngineVersion', () => {
  const identity: NsfwRuntimeIdentity = {
    modelFamily: 'mobilenet_v2_mid',
    packageName: 'nsfwjs',
    packageVersion: '4.3.0',
    modelDigest: 'c'.repeat(64),
    policyVersion: 'v1',
    policyDigest: 'd'.repeat(64),
    backend: 'wasm',
    classNames: CLASS_NAMES,
    inputSize: 224,
  }

  it('names the model artifact and the policy hash that actually ran', () => {
    const version = composeEngineVersion(identity)

    expect(version).toBe(
      `${ADR013_IMAGE_ENGINE_VERSION}:mobilenet_v2_mid@4.3.0:model-${'c'.repeat(12)}:v1:policy-${'d'.repeat(12)}`
    )
    expect(version).not.toContain('fixture')
    // The processor joins the text and image versions with a semicolon.
    expect(version).not.toContain(';')
  })

  it('changes when the model bytes change', () => {
    expect(composeEngineVersion({ ...identity, modelDigest: 'e'.repeat(64) })).not.toBe(
      composeEngineVersion(identity)
    )
  })

  it('changes when the policy changes', () => {
    expect(composeEngineVersion({ ...identity, policyDigest: 'f'.repeat(64) })).not.toBe(
      composeEngineVersion(identity)
    )
  })
})

describe('loadApprovedPolicy', () => {
  it('returns the thresholds the manifest approves', async () => {
    const { manifestPath } = manifestFixture()

    const loaded = await loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)

    expect(loaded.policy).toMatchObject(POLICY)
    expect(loaded.version).toBe('v1')
    expect(loaded.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a policy file edited since the manifest was written', async () => {
    const { manifestPath, policyPath } = manifestFixture()
    const tampered = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as {
      image: NsfwImagePolicy
    }
    tampered.image.neutralPassMinimum = 0.05
    fs.writeFileSync(policyPath, JSON.stringify(tampered))

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/policy checksum mismatch/)
  })

  it('rejects a missing policy file', async () => {
    const { manifestPath, policyPath } = manifestFixture()
    fs.rmSync(policyPath)

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/Approved screening policy not found/)
  })

  it('rejects a policy whose declared version disagrees with the manifest', async () => {
    const { manifestPath } = manifestFixture({ policy: { version: 'v9' } })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/policy version mismatch/)
  })

  it.each([
    ['a threshold above one', { neutralPassMinimum: 1.2 }],
    ['a threshold at zero', { unsafeBlockMinimum: 0 }],
    ['a missing aggregate ceiling', { unsafeAggregateMaximum: undefined }],
    ['an empty unsafe class list', { unsafeClasses: [] }],
    ['a nonsensical sum tolerance', { probabilitySumTolerance: 0.9 }],
    ['a boundary that resolves decisively', { boundaryDisposition: 'block' }],
  ])('rejects %s', async (_label, image) => {
    const { manifestPath } = manifestFixture({ image })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/Screening policy is invalid/)
  })

  it('rejects a policy naming an unsafe class the model does not emit', async () => {
    const { manifestPath } = manifestFixture({ image: { unsafeClasses: ['Explicit'] } })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/unsafe class the model does not emit: Explicit/)
  })

  it('rejects a policy whose class names disagree with the manifest', async () => {
    const { manifestPath } = manifestFixture({
      image: { classNames: ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Suggestive'] },
    })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/class names do not match/)
  })

  it('accepts a manifest mirroring exactly the five pinned thresholds', async () => {
    const { manifestPath } = manifestFixture({ thresholds: mirrorOf(POLICY) })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).resolves.toMatchObject({ version: 'v1' })
  })

  it('rejects a manifest whose mirrored thresholds have drifted', async () => {
    const { manifestPath } = manifestFixture({
      thresholds: { ...mirrorOf(POLICY), unsafeAggregateMaximum: 0.9 },
    })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(
      /do not match the approved screening policy: unsafeAggregateMaximum/
    )
  })

  it('rejects a mirror that quietly adds a key the policy does not pin', async () => {
    const { manifestPath } = manifestFixture({
      thresholds: { ...mirrorOf(POLICY), sexyBlockMinimum: 0.4 },
    })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/mirror unexpected keys: sexyBlockMinimum/)
  })

  it('rejects a policy that omits a reason code this adapter can emit', async () => {
    const withoutUnsafeClass = Object.fromEntries(
      Object.entries(REASON_CODES).filter(([code]) => code !== NSFW_REASON_UNSAFE_CLASS)
    )
    const { manifestPath } = manifestFixture({ reasonCodes: withoutUnsafeClass })

    await expect(
      loadApprovedPolicy(readModelManifest(manifestPath), manifestPath)
    ).rejects.toThrow(/declares no disposition for reason codes: unsafe_class/)
  })
})

describe('assertReasonCodesArePolicyWired', () => {
  it('accepts the shipped reason-code table', () => {
    expect(() => assertReasonCodesArePolicyWired(REASON_CODES)).not.toThrow()
  })

  it('rejects a table that downgrades an unsafe class below block', () => {
    expect(() =>
      assertReasonCodesArePolicyWired({ ...REASON_CODES, unsafe_class: 'review' })
    ).toThrow(/must record unsafe_class as block/)
  })

  it.each(NSFW_IMAGE_REASON_CODES.filter((code) => code !== NSFW_REASON_UNSAFE_CLASS))(
    'rejects a table that would let %s publish',
    (code) => {
      expect(() =>
        assertReasonCodesArePolicyWired({ ...REASON_CODES, [code]: 'pass' })
      ).toThrow(new RegExp(`would let these reason codes publish: ${code}`))
    }
  )
})

describe('the policy this repository ships', () => {
  const shippedManifest = path.resolve(
    __dirname,
    '../../../model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
  )

  it('loads, hashes, and wires its reason codes', async () => {
    expect(fs.existsSync(shippedManifest)).toBe(true)

    const loaded = await loadApprovedPolicy(
      readModelManifest(shippedManifest),
      shippedManifest
    )

    expect(loaded.policy.unsafeClasses).toEqual(['Hentai', 'Porn'])
    expect(loaded.policy.boundaryDisposition).toBe('review')
  })

  it('clears the benign reference vector and withholds the fail-open vector', async () => {
    const { policy } = await loadApprovedPolicy(
      readModelManifest(shippedManifest),
      shippedManifest
    )

    expect(
      evaluateNsfwDisposition(
        [0.0484, 0.0421, 0.9063, 0.0015, 0.0016],
        CLASS_NAMES,
        policy
      ).disposition
    ).toBe('pass')
    expect(
      evaluateNsfwDisposition(vector({ Neutral: 0.86, Porn: 0.13 }), CLASS_NAMES, policy)
        .disposition
    ).toBe('review')
  })
})

describe('resolveManifestPath', () => {
  it('prefers an explicitly supplied path', () => {
    expect(resolveManifestPath('./somewhere/manifest.json')).toBe(
      path.resolve('./somewhere/manifest.json')
    )
  })

  it('falls back to the configured environment variable', () => {
    vi.stubEnv(COMMUNITY_NSFW_MANIFEST_ENV, '/tmp/pinned-manifest.json')

    expect(resolveManifestPath()).toBe(path.resolve('/tmp/pinned-manifest.json'))
  })

  it('discovers the committed manifest when nothing is configured', () => {
    expect(path.basename(resolveManifestPath())).toBe(
      'community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
    )
  })
})

describe('selector identity', () => {
  it('names the production selector value the runtime switches on', () => {
    expect(COMMUNITY_NSFW_SCREENER_TENSORFLOW).toBe('tensorflow')
  })
})
