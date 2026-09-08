// Learning path Step 39: Production content-screening readiness.
// Story 6.2: the versioned, hashed policy every screening decision is made
// against, and the model manifest that pins the artifacts allowed to run.
//
// Two files are the contract, not this module. The isolated inference process
// re-reads both from disk with its own schemas, the way
// `fashion-clip-inference.worker.ts` re-reads its model manifest rather than
// trusting the Nest side, because a process that verifies its own supply chain
// is the only one whose verification means anything.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { z } from 'zod'

export const COMMUNITY_SCREENING_MANIFEST_FILENAME =
  'community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'

/** Suffix a fixture execution carries so no test run can claim a real screening. */
export const FIXTURE_ENGINE_VERSION_SUFFIX = '-fixture'

/**
 * The languages the ten enabled Community Beta locales map to, taken from the
 * canonical locale list rather than restated here. The locale JSON's own
 * `language` field is not exported across the workspace boundary, and the
 * primary subtag equals it for every enabled locale (`es-419` to `es`, `pt-BR`
 * to `pt`), so the subtag is the derivation rather than a parallel list that
 * could drift.
 */
export const COMMUNITY_SCREENING_LANGUAGES: readonly string[] = Object.freeze([
  ...new Set(supportedLocales.map((locale) => locale.split('-')[0] as string)),
]).toSorted()

export class CommunityScreeningPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommunityScreeningPolicyError'
  }
}

const ProbabilitySchema = z.number().gt(0).lt(1)
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i)
const NonEmptySchema = z.string().trim().min(1)

const DispositionSchema = z.enum(['pass', 'review', 'block'])
const SeveritySchema = z.enum(['low', 'medium', 'high'])
const CategorySchema = z.enum([
  'profanity',
  'sexual',
  'hate',
  'harassment',
  'violence',
  'self_harm',
])

export type CommunityScreeningDisposition = z.infer<typeof DispositionSchema>
export type CommunityScreeningSeverity = z.infer<typeof SeveritySchema>
export type CommunityScreeningCategory = z.infer<typeof CategorySchema>

/**
 * Nothing this policy can emit may resolve to `pass`. A screening signal exists
 * to withhold a post, so a disposition map that can clear one is the fail-open
 * this whole story is here to remove.
 */
const WithheldDispositionSchema = DispositionSchema.exclude(['pass'])

// `catchall(z.string())` rather than the default strip: every threshold in the
// policy file is followed by a `*Rationale` string carrying the reasoning JSON
// cannot hold as a comment, and those must survive validation. Allowing only
// strings still rejects a mistyped numeric key that would otherwise be dropped
// in silence.
const ImagePolicySchema = z
  .object({
    modelFamily: NonEmptySchema,
    classNames: z.array(NonEmptySchema).length(5),
    neutralPassMinimum: ProbabilitySchema,
    unsafeAggregateMaximum: ProbabilitySchema,
    unsafeClasses: z.array(NonEmptySchema).min(1),
    unsafeBlockMinimum: ProbabilitySchema,
    probabilitySumTolerance: z.number().gt(0).lte(0.01),
    boundaryDisposition: z.literal('review'),
    openQuestions: z.array(NonEmptySchema).optional(),
  })
  .catchall(z.union([z.string(), z.array(z.string())]))
  .superRefine((image, ctx) => {
    for (const unsafeClass of image.unsafeClasses) {
      if (!image.classNames.includes(unsafeClass)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unsafeClasses names ${unsafeClass}, which is not one of the model's class names`,
        })
      }
    }
    if (image.unsafeAggregateMaximum > image.unsafeBlockMinimum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'unsafeAggregateMaximum must not exceed unsafeBlockMinimum, or a single class could clear the pass gate while blocking on its own threshold',
      })
    }
  })

const TextListSchema = z.object({
  language: NonEmptySchema,
  terms: NonEmptySchema,
  allowList: NonEmptySchema,
  version: NonEmptySchema,
  // Task 3 requires startup to fail when a list is missing its provenance, so
  // these are required and non-empty rather than optional metadata.
  source: NonEmptySchema,
  licence: NonEmptySchema,
})

const TextPolicySchema = z
  .object({
    categories: z.array(CategorySchema).min(1),
    severities: z.array(SeveritySchema).min(1),
    severityDisposition: z.record(SeveritySchema, WithheldDispositionSchema),
    unscreenableLocaleDisposition: WithheldDispositionSchema,
    allDictionariesAlwaysRun: z.literal(true),
    scripts: z.object({
      supported: z.array(NonEmptySchema).min(1),
      mixedScriptDisposition: WithheldDispositionSchema,
      unsupportedScriptDisposition: WithheldDispositionSchema,
      rationale: NonEmptySchema,
    }),
    limits: z.object({
      maxInputCharacters: z.object({
        caption: z.number().int().positive(),
        altText: z.number().int().positive(),
      }),
      maxCanonicalRepresentations: z.number().int().positive(),
      maxExpandedCharacters: z.number().int().positive(),
      rationale: NonEmptySchema,
    }),
    lists: z.array(TextListSchema).min(1),
    openQuestions: z.array(NonEmptySchema).optional(),
  })
  .catchall(z.string())
  .superRefine((text, ctx) => {
    for (const severity of text.severities) {
      if (!text.severityDisposition[severity]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `severityDisposition has no entry for severity ${severity}`,
        })
      }
    }
    const languages = text.lists.map((list) => list.language).toSorted()
    if (new Set(languages).size !== languages.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lists declares the same language more than once',
      })
    }
    // Set equality, not containment. A missing language is an unscreenable
    // locale in production; an extra one is a list nothing will ever run.
    if (languages.join(',') !== COMMUNITY_SCREENING_LANGUAGES.join(',')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `lists covers [${languages.join(', ')}] but the enabled locales require exactly [${COMMUNITY_SCREENING_LANGUAGES.join(', ')}]`,
      })
    }
  })

const PolicySchema = z.object({
  policyId: NonEmptySchema,
  version: NonEmptySchema,
  effectiveFrom: NonEmptySchema,
  summary: NonEmptySchema,
  image: ImagePolicySchema,
  text: TextPolicySchema,
  reasonCodes: z.object({
    image: z.record(z.string(), WithheldDispositionSchema),
    text: z.record(z.string(), WithheldDispositionSchema),
    // Codes that accompany a clean result live outside `image` and `text` so that
    // those two records keep the invariant that a reason code can never resolve to
    // `pass`. A clean code still has to be named somewhere, because a screener that
    // states a clean verdict is auditable and one that merely returns an empty reason
    // list is indistinguishable from a screener that refused without explaining.
    cleanCodes: z.object({ text: NonEmptySchema }),
    rationale: NonEmptySchema,
  }),
})

const ManifestFileSchema = z.object({
  package: NonEmptySchema,
  path: NonEmptySchema,
  sha256: Sha256Schema,
})

/** The five values the manifest mirrors out of the policy, and nothing else. */
const MIRRORED_THRESHOLD_KEYS = [
  'neutralPassMinimum',
  'unsafeAggregateMaximum',
  'unsafeBlockMinimum',
  'unsafeClasses',
  'probabilitySumTolerance',
] as const

const ManifestSchema = z.object({
  manifestVersion: z.literal(1),
  modelFamily: NonEmptySchema,
  packageName: NonEmptySchema,
  packageVersion: NonEmptySchema,
  modelSubpath: NonEmptySchema,
  modelExport: NonEmptySchema,
  inputWidth: z.number().int().positive(),
  inputHeight: z.number().int().positive(),
  inputChannels: z.number().int().positive(),
  outputShape: z.array(z.number().int().positive()).length(2),
  classNames: z.array(NonEmptySchema).length(5),
  backend: z.literal('wasm'),
  modelFiles: z.array(ManifestFileSchema).min(1),
  wasmFiles: z.array(ManifestFileSchema.extend({ binaryName: NonEmptySchema })).min(1),
  dependencies: z.record(z.string(), NonEmptySchema),
  forbiddenDependencies: z.array(NonEmptySchema),
  thresholds: z.object({
    neutralPassMinimum: ProbabilitySchema,
    unsafeAggregateMaximum: ProbabilitySchema,
    unsafeBlockMinimum: ProbabilitySchema,
    unsafeClasses: z.array(NonEmptySchema).min(1),
    probabilitySumTolerance: z.number().gt(0),
  }),
  policy: z.object({
    path: NonEmptySchema,
    version: NonEmptySchema,
    hashAlgorithm: z.literal('sha256'),
    sha256: Sha256Schema,
  }),
})

export type CommunityScreeningImagePolicy = z.infer<typeof ImagePolicySchema>
export type CommunityScreeningTextPolicy = z.infer<typeof TextPolicySchema>
export type CommunityScreeningTextList = z.infer<typeof TextListSchema>
export type CommunityScreeningPolicy = z.infer<typeof PolicySchema>
export type CommunityScreeningManifest = z.infer<typeof ManifestSchema>

export interface CommunityScreeningIdentity {
  policyVersion: string
  policySha256: string
  modelFamily: string
  packageName: string
  packageVersion: string
  /** Persisted in `LookbookPost.moderation_engine_version` alongside the image half. */
  textEngineVersion: string
  imageEngineVersion: string
}

export interface LoadedCommunityScreeningPolicy {
  manifest: CommunityScreeningManifest
  manifestPath: string
  policy: CommunityScreeningPolicy
  policyPath: string
  policySha256: string
  identity: CommunityScreeningIdentity
}

/**
 * Twelve hex characters of the policy digest. Long enough that two reviewed
 * policies cannot collide in practice, short enough that the composite engine
 * version stays legible in a database column a human reads during an incident.
 */
const POLICY_HASH_PREFIX_LENGTH = 12

export function hashPolicyBytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function deriveScreeningIdentity(
  manifest: CommunityScreeningManifest,
  policySha256: string
): CommunityScreeningIdentity {
  const policyTag = `policy-${manifest.policy.version}@${policySha256.slice(0, POLICY_HASH_PREFIX_LENGTH)}`
  return {
    policyVersion: manifest.policy.version,
    policySha256,
    modelFamily: manifest.modelFamily,
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    textEngineVersion: `adr013-text:${policyTag}`,
    imageEngineVersion: `adr013-nsfw:${manifest.packageName}-${manifest.packageVersion}/${manifest.modelFamily}:${policyTag}`,
  }
}

/**
 * Both layouts are probed because this module is loaded from `src/` under
 * `tsx` and from `dist/src/` in the built worker, and the manifest sits beside
 * neither. The garment tagging worker carries the same two-candidate probe for
 * the same reason.
 */
function resolveManifestPath(): string {
  const candidates = [
    path.resolve(
      __dirname,
      '../../../model-manifests',
      COMMUNITY_SCREENING_MANIFEST_FILENAME
    ),
    path.resolve(
      __dirname,
      '../../../../model-manifests',
      COMMUNITY_SCREENING_MANIFEST_FILENAME
    ),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    throw new CommunityScreeningPolicyError(
      `Community screening model manifest not found in: ${candidates.join(', ')}`
    )
  }
  return found
}

function parseJsonFile(filePath: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new CommunityScreeningPolicyError(`${filePath} is not valid JSON`)
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, filePath: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new CommunityScreeningPolicyError(`${filePath} failed validation: ${issues}`)
  }
  return result.data
}

function assertThresholdMirror(
  manifest: CommunityScreeningManifest,
  policy: CommunityScreeningPolicy
): void {
  const manifestKeys = Object.keys(manifest.thresholds).toSorted()
  const expectedKeys = [...MIRRORED_THRESHOLD_KEYS].toSorted()
  if (manifestKeys.join(',') !== expectedKeys.join(',')) {
    throw new CommunityScreeningPolicyError(
      `Manifest thresholds must mirror exactly [${expectedKeys.join(', ')}] but carries [${manifestKeys.join(', ')}]`
    )
  }
  for (const key of MIRRORED_THRESHOLD_KEYS) {
    const mirrored = JSON.stringify(manifest.thresholds[key])
    const authoritative = JSON.stringify(policy.image[key])
    if (mirrored !== authoritative) {
      throw new CommunityScreeningPolicyError(
        `Manifest threshold ${key} is ${mirrored} but the policy says ${authoritative}`
      )
    }
  }
}

function assertManifestAgreesWithPolicy(
  manifest: CommunityScreeningManifest,
  policy: CommunityScreeningPolicy,
  policySha256: string
): void {
  if (manifest.policy.sha256.toLowerCase() !== policySha256.toLowerCase()) {
    throw new CommunityScreeningPolicyError(
      `Policy hash mismatch: manifest pins ${manifest.policy.sha256} but the policy file hashes to ${policySha256}`
    )
  }
  if (manifest.policy.version !== policy.version) {
    throw new CommunityScreeningPolicyError(
      `Manifest pins policy version ${manifest.policy.version} but the policy file declares ${policy.version}`
    )
  }
  if (manifest.classNames.join(',') !== policy.image.classNames.join(',')) {
    throw new CommunityScreeningPolicyError(
      'Manifest class names and policy class names must be identical and in the same order, because both are applied to the model output vector positionally'
    )
  }
  if (manifest.modelFamily !== policy.image.modelFamily) {
    throw new CommunityScreeningPolicyError(
      `Manifest model family ${manifest.modelFamily} does not match the policy's ${policy.image.modelFamily}`
    )
  }
  assertThresholdMirror(manifest, policy)
}

/**
 * Reads and validates both files and derives the identity that every persisted
 * screening result carries. Throws rather than returning a partial result: AC 1
 * requires startup to reject an unapproved policy before the BullMQ consumer
 * begins, and a caller that has to remember to check a flag is a caller that
 * will one day forget.
 */
export function loadCommunityScreeningPolicy(options?: {
  manifestPath?: string
}): LoadedCommunityScreeningPolicy {
  const manifestPath = options?.manifestPath ?? resolveManifestPath()
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8')
  const manifest = parseOrThrow(
    ManifestSchema,
    parseJsonFile(manifestPath, manifestRaw),
    manifestPath
  )

  // Relative to the manifest's own directory, so nothing has to guess where the
  // workspace root is from inside a compiled worker.
  const policyPath = path.resolve(path.dirname(manifestPath), manifest.policy.path)
  const policyBytes = fs.readFileSync(policyPath)
  const policySha256 = hashPolicyBytes(policyBytes)
  const policy = parseOrThrow(
    PolicySchema,
    parseJsonFile(policyPath, policyBytes.toString('utf8')),
    policyPath
  )

  assertManifestAgreesWithPolicy(manifest, policy, policySha256)

  return {
    manifest,
    manifestPath,
    policy,
    policyPath,
    policySha256,
    identity: deriveScreeningIdentity(manifest, policySha256),
  }
}
