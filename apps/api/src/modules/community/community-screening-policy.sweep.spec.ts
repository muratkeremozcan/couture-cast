// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b, AC 3: the exhaustive policy-surface evaluation.
//
// Recall against real unsafe imagery is the upstream model's property and is not
// measured in this repository. What this repository can break is the code between
// the model's output and the publication decision, and that surface is small
// enough to enumerate rather than sample. A boundary error, an inverted
// comparison, a class-order bug or an unhandled non-finite value would each pass
// an image corpus that happened not to land in the affected region, and each of
// them fails here.
//
// Every vector is checked four ways: it reaches exactly one disposition with a
// stable reason code the policy maps to that disposition; it agrees with an
// oracle written from the policy text rather than from the implementation; it
// cannot reach `pass` without a confident safe mass or while any unsafe or
// review class sits at or above its review threshold; and the whole sweep is
// deterministic. A child process then proves the sweep executed every block of
// the disposition function.
//
// It runs in the ordinary unit suite: no model, no image, no restricted asset.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import {
  NSFW_REASON_CLASS_MISMATCH,
  NSFW_REASON_LOW_CONFIDENCE,
  NSFW_REASON_OUTPUT_INVALID,
  NSFW_REASON_PROBABILITY_SUM_INVALID,
  NSFW_REASON_UNSAFE_CLASS,
  evaluateNsfwDisposition,
  type NsfwEvaluation,
} from './tensorflow-nsfw-image-screener.js'
import {
  buildPolicySweep,
  type SweepFamily,
  type SweepImagePolicy,
  type SweepVector,
} from '../../../test/community-screening/policy-sweep-vectors.js'

/** The input-set hash the readiness generator checks every run product against. */
async function currentInputSetHash(): Promise<string> {
  const helperPath = path.resolve(
    __dirname,
    '../../../../../scripts/lib/community-screening-input-set.mjs'
  )
  const module = (await import(helperPath)) as { inputSetHash: () => string }
  return module.inputSetHash()
}

const loaded = loadCommunityScreeningPolicy()
const policy = loaded.policy.image
const reasonTable = loaded.policy.reasonCodes.image

const DISPOSITIONS = ['pass', 'review', 'block'] as const

/** Every exit the disposition function has. The sweep must reach all of them. */
const EXPECTED_OUTCOMES = [
  'pass:',
  `block:${NSFW_REASON_UNSAFE_CLASS}`,
  `review:${NSFW_REASON_LOW_CONFIDENCE}`,
  `review:${NSFW_REASON_OUTPUT_INVALID}`,
  `review:${NSFW_REASON_CLASS_MISMATCH}`,
  `review:${NSFW_REASON_PROBABILITY_SUM_INVALID}`,
]

interface OracleVerdict {
  disposition: (typeof DISPOSITIONS)[number]
  reason: string | null
}

/** The output-validity half of the oracle: null when the vector can be trusted. */
function oracleValidation(
  vector: SweepVector,
  image: SweepImagePolicy
): OracleVerdict | null {
  const { probabilities, classNames } = vector
  if (probabilities.length !== classNames.length) {
    return { disposition: 'review', reason: NSFW_REASON_OUTPUT_INVALID }
  }
  const names = new Set(classNames)
  const exactSet =
    classNames.length === image.classNames.length &&
    names.size === classNames.length &&
    image.classNames.every((name) => names.has(name))
  if (!exactSet) return { disposition: 'review', reason: NSFW_REASON_CLASS_MISMATCH }
  const outOfRange = probabilities.some(
    (value) => !Number.isFinite(value) || value < 0 || value > 1
  )
  if (outOfRange) return { disposition: 'review', reason: NSFW_REASON_OUTPUT_INVALID }
  let sum = 0
  for (const value of probabilities) sum += value
  if (Math.abs(sum - 1) > image.probabilitySumTolerance) {
    return { disposition: 'review', reason: NSFW_REASON_PROBABILITY_SUM_INVALID }
  }
  return null
}

/**
 * The policy, restated from `policy-v2.json`'s own rationale text rather than
 * from the implementation: validate the output, then block on any unsafe class
 * strictly above its floor, then pass only on a confident safe mass (the safe
 * classes summed) with a bounded unsafe aggregate, every unsafe class strictly
 * below its floor and every review class strictly below its ceiling, and route
 * everything else to a human.
 */
function oracle(vector: SweepVector, image: SweepImagePolicy): OracleVerdict {
  const invalid = oracleValidation(vector, image)
  if (invalid) return invalid
  const byName = new Map(
    vector.classNames.map((name, index) => [name, vector.probabilities[index] as number])
  )
  const unsafe = image.unsafeClasses.map((name) => byName.get(name) as number)
  if (unsafe.some((score) => score > image.unsafeBlockMinimum)) {
    return { disposition: 'block', reason: NSFW_REASON_UNSAFE_CLASS }
  }
  let unsafeAggregate = 0
  for (const score of unsafe) unsafeAggregate += score
  let safeMass = 0
  for (const name of image.safeClasses) safeMass += byName.get(name) as number
  const publishable =
    safeMass > image.safeMassMinimum &&
    unsafeAggregate < image.unsafeAggregateMaximum &&
    unsafe.every((score) => score < image.unsafeBlockMinimum) &&
    image.reviewClasses.every(
      (name) => (byName.get(name) as number) < image.reviewClassMaximum
    ) &&
    [...image.unsafeClasses, ...image.reviewClasses].reduce(
      (sum, name) => sum + (byName.get(name) as number),
      0
    ) < image.unsafeAndReviewAggregateMaximum
  return publishable
    ? { disposition: 'pass', reason: null }
    : { disposition: 'review', reason: NSFW_REASON_LOW_CONFIDENCE }
}

function evaluate(vector: SweepVector): NsfwEvaluation {
  return evaluateNsfwDisposition(vector.probabilities, vector.classNames, policy)
}

function sweepDigest(results: readonly NsfwEvaluation[]): string {
  const hash = createHash('sha256')
  for (const result of results) {
    hash.update(`${result.disposition}|${result.reasons.join(',')}\n`)
  }
  return hash.digest('hex')
}

const vectors = buildPolicySweep(policy)

describe('policy-surface sweep: the vector set', () => {
  it('is non-empty and covers every family the story names', () => {
    const families = new Set(vectors.map((vector) => vector.family))
    const required: SweepFamily[] = [
      'simplex-grid',
      'threshold-boundary',
      'single-class-maximum',
      'uniform',
      'tie',
      'sum-tolerance',
      'non-finite',
      'out-of-range',
      'missing-class',
      'duplicated-class',
      'wrong-class-set',
      'permuted-class-order',
      'length-mismatch',
      'empty',
    ]
    expect(vectors.length).toBeGreaterThan(10_000)
    expect([...families].toSorted()).toEqual(required.toSorted())
  })

  it('names every vector uniquely, so a failure identifies its input', () => {
    const ids = vectors.map((vector) => vector.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('probes every threshold from both sides', () => {
    const boundary = vectors.filter((vector) => vector.family === 'threshold-boundary')
    for (const label of [
      'safe-mass-even',
      'aggregate-concentrated',
      'aggregate-even',
      'joint',
    ]) {
      expect(
        boundary.some((vector) => vector.id.startsWith(`threshold-boundary:${label}-`))
      ).toBe(true)
      expect(
        boundary.some((vector) => vector.id.startsWith(`threshold-boundary:${label}+`))
      ).toBe(true)
    }
    for (const unsafe of policy.unsafeClasses) {
      expect(boundary.some((vector) => vector.id.includes(`${unsafe}-block-`))).toBe(true)
      expect(boundary.some((vector) => vector.id.includes(`${unsafe}-block+`))).toBe(true)
    }
    for (const reviewClass of policy.reviewClasses) {
      expect(
        boundary.some((vector) => vector.id.includes(`${reviewClass}-review-`))
      ).toBe(true)
      expect(
        boundary.some((vector) => vector.id.includes(`${reviewClass}-review+`))
      ).toBe(true)
    }
  })
})

const score = (vector: SweepVector, name: string) =>
  vector.probabilities[vector.classNames.indexOf(name)] as number

function oracleDisagreement(vector: SweepVector, result: NsfwEvaluation): string | null {
  const expected = oracle(vector, policy)
  const actualReason = result.reasons[0] ?? null
  return expected.disposition === result.disposition && expected.reason === actualReason
    ? null
    : `${vector.id}: expected ${expected.disposition}/${String(expected.reason)}, got ${result.disposition}/${String(actualReason)}`
}

/** Every way a passing vector could break a review threshold, independent of the oracle. */
function passViolations(vector: SweepVector): string[] {
  const found: string[] = []
  const valid =
    vector.classNames.length === policy.classNames.length &&
    new Set(vector.classNames).size === vector.classNames.length &&
    vector.probabilities.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1
    )
  const safeMass = policy.safeClasses.reduce((sum, name) => sum + score(vector, name), 0)
  if (!valid || !(safeMass > policy.safeMassMinimum)) {
    found.push(`${vector.id}: passed with safe mass ${safeMass}`)
  }
  for (const unsafe of policy.unsafeClasses) {
    if (!(score(vector, unsafe) < policy.unsafeAggregateMaximum)) {
      found.push(`${vector.id}: passed with ${unsafe} ${score(vector, unsafe)}`)
    }
  }
  for (const reviewClass of policy.reviewClasses) {
    if (!(score(vector, reviewClass) < policy.reviewClassMaximum)) {
      found.push(`${vector.id}: passed with ${reviewClass} ${score(vector, reviewClass)}`)
    }
  }
  const joint = [...policy.unsafeClasses, ...policy.reviewClasses].reduce(
    (sum, name) => sum + score(vector, name),
    0
  )
  if (!(joint < policy.unsafeAndReviewAggregateMaximum)) {
    found.push(`${vector.id}: passed with unsafe and review mass ${joint}`)
  }
  return found
}

// Computed once, asserted below, and written to the run product as counted, so
// the evidence reports what the assertions saw rather than a literal zero.
const results = vectors.map((vector) => ({ vector, result: evaluate(vector) }))
const disagreements = results
  .map(({ vector, result }) => oracleDisagreement(vector, result))
  .filter((line): line is string => line !== null)
const violations = results
  .filter(({ result }) => result.disposition === 'pass')
  .flatMap(({ vector }) => passViolations(vector))

describe('policy-surface sweep: every vector', () => {
  it('maps to exactly one disposition with a stable reason the policy assigns to it', () => {
    const problems: string[] = []
    for (const { vector, result } of results) {
      if (!DISPOSITIONS.includes(result.disposition)) {
        problems.push(`${vector.id}: disposition ${String(result.disposition)}`)
        continue
      }
      if (result.disposition === 'pass') {
        if (result.reasons.length !== 0)
          problems.push(`${vector.id}: pass carried reasons`)
        continue
      }
      if (result.reasons.length !== 1) {
        problems.push(`${vector.id}: ${result.reasons.length} reasons`)
        continue
      }
      const reason = result.reasons[0] as string
      if (reasonTable[reason] !== result.disposition) {
        problems.push(
          `${vector.id}: reason ${reason} maps to ${String(reasonTable[reason])} in the policy, not ${result.disposition}`
        )
      }
    }
    expect(problems).toEqual([])
  })

  it('agrees with the oracle written from the policy text', () => {
    expect(disagreements).toEqual([])
  })

  /*
   * The review thresholds, stated per class: an unsafe class reaches review at
   * the unsafe aggregate ceiling on its own, a review class at its ceiling, and
   * the unsafe and review classes together at the joint ceiling. No vector may
   * publish while any of them is at or above its threshold, nor without a
   * confident safe mass.
   */
  it('never passes while any unsafe or review class is at or above its review threshold', () => {
    expect(violations).toEqual([])
  })

  it('routes every malformed vector to review, never to pass', () => {
    const malformed = new Set<SweepFamily>([
      'non-finite',
      'out-of-range',
      'missing-class',
      'duplicated-class',
      'wrong-class-set',
      'length-mismatch',
      'empty',
    ])
    const leaks = results
      .filter(({ vector }) => malformed.has(vector.family))
      .filter(({ result }) => result.disposition !== 'review')
      .map(({ vector, result }) => `${vector.id}: ${result.disposition}`)
    expect(leaks).toEqual([])
  })

  it('reaches every exit of the disposition function', () => {
    const outcomes = new Set(
      results.map(({ result }) => `${result.disposition}:${result.reasons.join(',')}`)
    )
    expect([...outcomes].toSorted()).toEqual(EXPECTED_OUTCOMES.toSorted())
  })

  it('is deterministic across repeated runs', () => {
    const first = sweepDigest(results.map(({ result }) => result))
    const second = sweepDigest(buildPolicySweep(policy).map(evaluate))
    expect(second).toBe(first)
  })

  it('writes the run product the readiness evidence consumes, when asked to', async () => {
    const outDir = process.env.COMMUNITY_SCREENING_RUN_PRODUCT_DIR?.trim()
    if (!outDir) return

    const byOutcome: Record<string, number> = {}
    const byFamily: Record<string, Record<string, number>> = {}
    for (const { vector, result } of results) {
      const outcome = `${result.disposition}:${result.reasons[0] ?? 'none'}`
      byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1
      byFamily[vector.family] ??= {}
      const family = byFamily[vector.family] as Record<string, number>
      family[result.disposition] = (family[result.disposition] ?? 0) + 1
    }
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
      path.join(outDir, 'policy-sweep.json'),
      `${JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          inputSetHash: await currentInputSetHash(),
          policySha256: loaded.policySha256,
          vectorCount: results.length,
          byOutcome,
          byFamily,
          oracleDisagreements: disagreements.length,
          passAtOrAboveAReviewThreshold: violations.length,
          sweepDigest: sweepDigest(results.map(({ result }) => result)),
        },
        null,
        2
      )}\n`
    )
  })
})

describe('policy-surface sweep: branch coverage of the disposition function', () => {
  it('executes every block of the disposition function and its callbacks', async () => {
    const apiRoot = path.resolve(__dirname, '../../..')
    const probe = path.join(
      apiRoot,
      'test/community-screening/disposition-coverage-probe.ts'
    )
    const output = execFileSync(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', probe],
      { cwd: apiRoot, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }
    )
    const report = JSON.parse(output) as {
      vectorCount: number
      missingFunctions: string[]
      functions: { functionName: string; blocks: number; uncovered: string[] }[]
    }

    expect(report.vectorCount).toBe(vectors.length)
    expect(report.missingFunctions).toEqual([])
    expect(report.functions.length).toBeGreaterThanOrEqual(4)
    const uncovered = report.functions.flatMap((fn) =>
      fn.uncovered.map((snippet) => `${fn.functionName}: ${snippet}`)
    )
    expect(uncovered).toEqual([])

    const outDir = process.env.COMMUNITY_SCREENING_RUN_PRODUCT_DIR?.trim()
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(
        path.join(outDir, 'policy-sweep-coverage.json'),
        `${JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            inputSetHash: await currentInputSetHash(),
            policySha256: loaded.policySha256,
            functions: report.functions.map((fn) => ({
              functionName: fn.functionName,
              blocks: fn.blocks,
              uncoveredBlocks: fn.uncovered.length,
            })),
          },
          null,
          2
        )}\n`
      )
    }
  }, 60_000)
})
