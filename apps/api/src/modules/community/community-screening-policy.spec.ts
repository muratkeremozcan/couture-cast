// Learning path Step 39: Production content-screening readiness.
// Story 6.2: proves the committed policy and manifest are the ones the story
// approved, and that the supply chain AC 1 pins has not drifted.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_SCREENING_LANGUAGES,
  COMMUNITY_SCREENING_MANIFEST_FILENAME,
  CommunityScreeningPolicyError,
  deriveScreeningIdentity,
  hashPolicyBytes,
  loadCommunityScreeningPolicy,
} from './community-screening-policy'
import { evaluateNsfwDisposition } from './tensorflow-nsfw-image-screener'

const repoRoot = path.resolve(__dirname, '../../../../..')
const apiRoot = path.join(repoRoot, 'apps/api')
const committedManifestPath = path.join(
  apiRoot,
  'model-manifests',
  COMMUNITY_SCREENING_MANIFEST_FILENAME
)
const committedPolicyPath = path.join(
  apiRoot,
  'policies/community-screening/policy-v1.json'
)

type JsonRecord = Record<string, unknown>

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonRecord
}

describe('loadCommunityScreeningPolicy', () => {
  it('loads the committed manifest and policy', () => {
    const loaded = loadCommunityScreeningPolicy()

    expect(loaded.manifestPath).toBe(committedManifestPath)
    expect(loaded.policyPath).toBe(committedPolicyPath)
    expect(loaded.policy.version).toBe('v1')
    expect(loaded.manifest.packageName).toBe('nsfwjs')
    expect(loaded.manifest.packageVersion).toBe('4.3.0')
    expect(loaded.manifest.backend).toBe('wasm')
  })

  it('hashes the policy file bytes and finds the manifest pins that hash', () => {
    const loaded = loadCommunityScreeningPolicy()
    const onDisk = createHash('sha256')
      .update(fs.readFileSync(committedPolicyPath))
      .digest('hex')

    expect(loaded.policySha256).toBe(onDisk)
    expect(loaded.manifest.policy.sha256).toBe(onDisk)
  })

  it('derives the text engine identity from the policy version and hash', () => {
    const loaded = loadCommunityScreeningPolicy()

    expect(loaded.identity.textEngineVersion).toBe(
      `adr013-text:policy-v1@${loaded.policySha256.slice(0, 12)}`
    )
    // The image half is composed by the screener from the model digest it
    // actually verified, so this identity deliberately carries none.
    expect(loaded.identity).not.toHaveProperty('imageEngineVersion')
  })

  it('changes the derived identity when the policy hash changes', () => {
    const manifest = readJson(committedManifestPath)
    const first = deriveScreeningIdentity(
      loadCommunityScreeningPolicy().manifest,
      hashPolicyBytes('one')
    )
    const second = deriveScreeningIdentity(
      loadCommunityScreeningPolicy().manifest,
      hashPolicyBytes('two')
    )

    expect(manifest.policy).toBeDefined()
    expect(first.textEngineVersion).not.toBe(second.textEngineVersion)
  })
})

describe('the committed policy is conservative by construction', () => {
  const { policy } = loadCommunityScreeningPolicy()

  it('requires a confident Neutral, a bounded unsafe aggregate, and a block ceiling', () => {
    expect(policy.image.neutralPassMinimum).toBe(0.85)
    expect(policy.image.unsafeAggregateMaximum).toBe(0.1)
    expect(policy.image.unsafeBlockMinimum).toBe(0.35)
    expect(policy.image.unsafeClasses).toEqual(['Hentai', 'Porn'])
    expect(policy.image.boundaryDisposition).toBe('review')
  })

  it('applies the five ADR-013 class names in their canonical order', () => {
    expect(policy.image.classNames).toEqual([
      'Drawing',
      'Hentai',
      'Neutral',
      'Porn',
      'Sexy',
    ])
  })

  // The seam the coordinator found: Neutral 0.86 with Porn 0.13 clears the
  // Neutral gate and blocks on no single class, so the aggregate ceiling is the
  // only thing keeping thirteen percent unsafe mass out of automatic publication.
  // Driven through the disposition function rather than restated as arithmetic
  // on the thresholds: comparing the numbers to themselves passes whatever the
  // evaluator does with them.
  it('keeps a confident Neutral carrying real unsafe mass out of pass', () => {
    const evaluation = evaluateNsfwDisposition(
      [0.01, 0, 0.86, 0.13, 0],
      policy.image.classNames,
      policy.image
    )

    expect(evaluation.classProbabilities.Neutral).toBeGreaterThan(
      policy.image.neutralPassMinimum
    )
    expect(evaluation.disposition).toBe('review')
  })

  it('leaves the benign reference vector comfortably inside every pass gate', () => {
    const evaluation = evaluateNsfwDisposition(
      [0.0484, 0.0421, 0.9063, 0.0015, 0.0016],
      policy.image.classNames,
      policy.image
    )

    expect(evaluation.disposition).toBe('pass')
    expect(evaluation.reasons).toEqual([])
  })

  it('never lets a text severity or a reason code resolve to pass', () => {
    const dispositions = [
      ...Object.values(policy.text.severityDisposition),
      policy.text.unscreenableLocaleDisposition,
      policy.text.scripts.mixedScriptDisposition,
      policy.text.scripts.unsupportedScriptDisposition,
      ...Object.values(policy.reasonCodes.image),
      ...Object.values(policy.reasonCodes.text),
    ]

    expect(dispositions.length).toBeGreaterThan(0)
    expect(dispositions).not.toContain('pass')
  })

  // Truncated input means part of the text was never screened, which none of
  // the other text codes describes.
  it('carries a distinct reason code for text that went partly unscreened', () => {
    expect(policy.reasonCodes.text.text_input_truncated).toBe('review')
  })

  it('covers exactly the languages the enabled locales require', () => {
    expect(policy.text.lists.map((list) => list.language).toSorted()).toEqual([
      ...COMMUNITY_SCREENING_LANGUAGES,
    ])
    expect(COMMUNITY_SCREENING_LANGUAGES).toEqual([
      'de',
      'en',
      'es',
      'fr',
      'it',
      'pt',
      'tr',
    ])
  })

  it('gives every list a source, a version, and a licence', () => {
    for (const list of policy.text.lists) {
      expect(list.source.length).toBeGreaterThan(0)
      expect(list.version.length).toBeGreaterThan(0)
      expect(list.licence.length).toBeGreaterThan(0)
    }
  })

  it('bounds caption and alt text at the ceilings the public contract enforces', () => {
    expect(policy.text.limits.maxInputCharacters).toEqual({ caption: 280, altText: 200 })
  })
})

// Every rejection case writes a mutated pair into a scratch directory laid out
// the way the repository is, because manifest.policy.path resolves relative to
// the manifest's own directory.
describe('startup rejects an unapproved policy', () => {
  let scratchDir: string

  beforeEach(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-screening-policy-'))
  })

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true })
  })

  function writePair(
    mutate: (manifest: JsonRecord, policy: JsonRecord) => void = () => undefined
  ): string {
    const manifest = readJson(committedManifestPath)
    const policy = readJson(committedPolicyPath)
    mutate(manifest, policy)

    const policyDir = path.join(scratchDir, 'policies/community-screening')
    const manifestDir = path.join(scratchDir, 'model-manifests')
    fs.mkdirSync(policyDir, { recursive: true })
    fs.mkdirSync(manifestDir, { recursive: true })

    const policyPath = path.join(policyDir, 'policy-v1.json')
    const policyBytes = `${JSON.stringify(policy, null, 2)}\n`
    fs.writeFileSync(policyPath, policyBytes)

    // Re-pin the hash unless the mutation is deliberately about the hash.
    const manifestPolicy = manifest.policy as JsonRecord
    if (
      manifestPolicy.sha256 ===
      (readJson(committedManifestPath).policy as JsonRecord).sha256
    ) {
      manifestPolicy.sha256 = hashPolicyBytes(policyBytes)
    }

    const manifestPath = path.join(manifestDir, COMMUNITY_SCREENING_MANIFEST_FILENAME)
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return manifestPath
  }

  it('accepts an unmutated copy, so the rejections below mean something', () => {
    expect(() =>
      loadCommunityScreeningPolicy({ manifestPath: writePair() })
    ).not.toThrow()
  })

  it('rejects a policy whose bytes no longer hash to the pinned value', () => {
    const manifestPath = writePair((manifest) => {
      ;(manifest.policy as JsonRecord).sha256 = 'a'.repeat(64)
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /Policy hash mismatch/
    )
  })

  it('rejects a threshold that drifted between the manifest and the policy', () => {
    const manifestPath = writePair((manifest) => {
      ;(manifest.thresholds as JsonRecord).neutralPassMinimum = 0.5
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /threshold neutralPassMinimum is 0.5 but the policy says 0.85/
    )
  })

  it('rejects a manifest mirror that gained or lost a key', () => {
    const manifestPath = writePair((manifest) => {
      delete (manifest.thresholds as JsonRecord).unsafeAggregateMaximum
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      CommunityScreeningPolicyError
    )
  })

  it('rejects class names that disagree between the manifest and the policy', () => {
    const manifestPath = writePair((manifest) => {
      manifest.classNames = ['Drawing', 'Hentai', 'Neutral', 'Sexy', 'Porn']
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /same order, because both are applied to the model output vector positionally/
    )
  })

  it('rejects a severity that would clear a post', () => {
    const manifestPath = writePair((_manifest, policy) => {
      ;((policy.text as JsonRecord).severityDisposition as JsonRecord).high = 'pass'
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /failed validation/
    )
  })

  it('rejects a term list missing its provenance', () => {
    const manifestPath = writePair((_manifest, policy) => {
      const lists = (policy.text as JsonRecord).lists as JsonRecord[]
      lists[0]!.licence = ''
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /failed validation/
    )
  })

  it('rejects a language set that no longer matches the enabled locales', () => {
    const manifestPath = writePair((_manifest, policy) => {
      const text = policy.text as JsonRecord
      text.lists = (text.lists as JsonRecord[]).slice(0, 6)
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /the enabled locales require exactly/
    )
  })

  it('rejects an unsafe class the model does not emit', () => {
    const manifestPath = writePair((manifest, policy) => {
      ;(policy.image as JsonRecord).unsafeClasses = ['Nudity']
      ;(manifest.thresholds as JsonRecord).unsafeClasses = ['Nudity']
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /not one of the model's class names/
    )
  })

  it('rejects an aggregate ceiling above the per-class block threshold', () => {
    const manifestPath = writePair((manifest, policy) => {
      ;(policy.image as JsonRecord).unsafeAggregateMaximum = 0.9
      ;(manifest.thresholds as JsonRecord).unsafeAggregateMaximum = 0.9
    })

    expect(() => loadCommunityScreeningPolicy({ manifestPath })).toThrow(
      /must not exceed unsafeBlockMinimum/
    )
  })

  it('names the missing manifest rather than failing obscurely', () => {
    expect(() =>
      loadCommunityScreeningPolicy({ manifestPath: path.join(scratchDir, 'absent.json') })
    ).toThrow()
  })
})

// AC 1: the model travels with the pinned dependency, so there is no model
// download, no cache directory, and no remote host to reach for.
describe('the screening supply chain stays local and pinned', () => {
  const lockfile = readJson(path.join(repoRoot, 'package-lock.json'))
  const lockPackages = lockfile.packages as Record<string, JsonRecord>

  it('keeps the union @tensorflow/tfjs package out of the tree', () => {
    // The peer edge is satisfied by an alias, so the check is on identity
    // rather than on the path: an entry may exist, but it must be tfjs-core.
    for (const [key, entry] of Object.entries(lockPackages)) {
      if (key.endsWith('node_modules/@tensorflow/tfjs')) {
        expect(entry.name).toBe('@tensorflow/tfjs-core')
      }
    }
  })

  it('keeps the union package exclusive members out of the lockfile', () => {
    const exclusive = ['tfjs-layers', 'tfjs-data', 'tfjs-backend-webgl']
    const present = Object.keys(lockPackages).filter((key) =>
      exclusive.some((member) => key.endsWith(`@tensorflow/${member}`))
    )

    expect(present).toEqual([])
  })

  it('pins every dependency the manifest names at an exact version', () => {
    const { manifest } = loadCommunityScreeningPolicy()
    const apiDependencies = (readJson(path.join(apiRoot, 'package.json')).dependencies ??
      {}) as Record<string, string>

    for (const [name, version] of Object.entries(manifest.dependencies)) {
      expect(apiDependencies[name]).toBe(version)
    }
  })

  it('declares no model directory and no remote model host', () => {
    const forbidden = /MODEL_DIR|MODEL_HOST|MODEL_URL|MODEL_BASE_URL/
    const moduleDir = __dirname
    const sources = fs
      .readdirSync(moduleDir)
      // Specs are excluded because this one names the forbidden patterns in
      // order to search for them.
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .map((file) => fs.readFileSync(path.join(moduleDir, file), 'utf8'))

    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).not.toMatch(forbidden)
    }
  })

  it('names no network location in the manifest, so nothing can be fetched', () => {
    const manifestSource = fs.readFileSync(committedManifestPath, 'utf8')

    expect(manifestSource).not.toMatch(/https?:\/\//)
  })
})
