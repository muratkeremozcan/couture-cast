/*
 * Emits the machine-readable measurements Story 6.2b's evidence generator
 * consumes without re-deriving them.
 *
 * THIS COMMAND RENDERS NO VERDICT AND CARRIES NO SIGNATURE. Story 6.2 emits
 * measurements and labels the path that produced each one; Story 6.2b owns the
 * corpus-backed gates, the verdict, the payload hash and the single recorded
 * signature. If a `verdict` or `signature` field ever appears in the payload
 * this writes, the story boundary has been crossed.
 *
 * It deliberately depends on nothing from the api workspace. The real-model
 * numbers arrive through a run product that the gated readiness suite writes,
 * so this stays runnable, and emits an honest "no real-model run" payload, on a
 * checkout where the model has never been executed.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const MODEL_MANIFEST =
  'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
const POLICY = 'apps/api/policies/community-screening/policy-v1.json'
const FIXTURE_MANIFEST = 'apps/api/test/fixtures/community-moderation/v1/manifest.json'
const LOCKFILE = 'package-lock.json'

/*
 * A run product, not a source artifact, so it is gitignored under the already
 * ignored `.cache`. A committed intermediate would go stale against the code
 * that produced it and let this payload report numbers from an older build as
 * though they were current.
 */
const INTERMEDIATE = 'apps/api/.cache/community-screening/readiness-measurements.json'

const OUTPUT = '_bmad-output/test-artifacts/community-content-screening-measurements.json'

/**
 * The commands that produce every number in this payload, recorded because Task
 * 10 requires the final command list to travel with the evidence rather than
 * living in someone's shell history.
 */
const COMMANDS = {
  fixtureCorpus: {
    generate: 'npm run fixtures:community-screening',
    verify: 'npm run verify:community-screening-fixtures',
  },
  model: {
    verifyArtifacts: 'npm run verify:community-screening-model --workspace api',
    verifyArtifactsAsInvokedHere:
      'npm run --silent verify:community-screening-model --workspace api -- --json',
    verifySupplyChain: 'npm run verify:community-screening-supply-chain --workspace api',
    smoke: 'npm run test:community-screening-model:smoke --workspace api',
    readiness: 'npm run test:community-screening-readiness --workspace api',
  },
  pipeline: {
    integration:
      'npm run test:integration --workspace api -- integration/community-moderation-pipeline.integration.spec.ts',
    endToEnd: 'npm run test:community-screening:e2e',
  },
  evidence: {
    emit: 'npm run measure:community-screening',
  },
  repository: {
    audit: 'npm audit --omit=dev --audit-level=high',
    verifyChanged: 'npm run verify:changed',
    validate: 'npm run validate',
  },
}

function sha256File(relativePath) {
  const fullPath = path.join(projectRoot, relativePath)
  if (!fs.existsSync(fullPath)) return null
  return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex')
}

function readJson(relativePath) {
  const fullPath = path.join(projectRoot, relativePath)
  if (!fs.existsSync(fullPath)) return null
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
}

function gitCommitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function gitWorkingTreeClean() {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.trim().length === 0
  } catch {
    return null
  }
}

/**
 * Runs the artifact verification and records what it actually reported.
 *
 * `verify:community-screening-model` exits 0 with status `skipped` whenever the
 * selector is not `tensorflow`, because there is nothing installed to verify.
 * A zero exit is therefore not evidence of a verified supply chain, and
 * `isEvidence` is what carries that distinction into the payload: only a
 * `passed` run counts. Reading the exit code alone is the mistake this exists to
 * prevent.
 */
const VERIFY_COMMAND = [
  'run',
  '--silent',
  'verify:community-screening-model',
  '--workspace',
  'api',
  '--',
  '--json',
]

/** What the verify script reports when every artifact hashed clean. */
const VERIFY_PASSED_STATUS = 'verified'

function describeVerification(parsed) {
  // `reason` and `failures` are the fields the verify script emits. Reading a
  // `message` it never sets would silently discard the cause of a failure and
  // record `null` in the evidence.
  const detail = [parsed.reason, ...(parsed.failures ?? [])].filter(Boolean).join('; ')
  return detail.length > 0 ? detail : null
}

function verifyModel() {
  const notEvidence = (status, note) => ({ status, isEvidence: false, note })

  let raw
  try {
    raw = execFileSync('npm', VERIFY_COMMAND, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : ''
    const parsed = parseVerifyJson(stdout)
    return parsed
      ? {
          status: parsed.status ?? 'failed',
          isEvidence: false,
          note: describeVerification(parsed),
        }
      : notEvidence(
          'unavailable',
          'The verification command did not complete, so no supply-chain evidence is recorded.'
        )
  }

  const parsed = parseVerifyJson(raw)
  if (!parsed) {
    return notEvidence(
      'unavailable',
      'The verification command produced no machine-readable result.'
    )
  }
  if (parsed.status === 'skipped') {
    return notEvidence(
      'skipped',
      `Verification was skipped because the selector is not tensorflow, so the model artifacts were never hashed. This is the absence of evidence, not a passing verification. ${describeVerification(parsed) ?? ''}`.trim()
    )
  }
  return {
    status: parsed.status ?? 'unavailable',
    isEvidence: parsed.status === VERIFY_PASSED_STATUS,
    note: describeVerification(parsed),
  }
}

function parseVerifyJson(output) {
  if (!output) return null
  // npm prepends lifecycle noise even under --silent in some configurations, so
  // the JSON object is located rather than assumed to start at byte zero.
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(output.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * What the numbers do and do not describe. Both entries exist because the
 * measurement was misreadable without them, and a reader who takes peak RSS for
 * the model's size will size a container wrong in either direction.
 */
const MEASUREMENT_CAVEATS = [
  {
    id: 'peak-rss-is-process-wide',
    statement:
      'Peak resident set is measured process-wide. The inference runtime is a worker thread sharing its process with the supervisor, so the figure covers the whole worker process.',
    consequence:
      'It is the right number for setting a container memory limit and the wrong number for describing how large the model is.',
  },
  {
    id: 'compiled-output-only',
    statement:
      'The measurement is taken from compiled output under plain node. The same harness run under tsx measured roughly twice the peak resident set because the esbuild transform stayed resident.',
    consequence:
      'A measurement taken through a TypeScript runner is not comparable and must not be recorded as this metric.',
  },
]

/**
 * Reads the two rollout defaults from the shared flag registry instead of
 * restating them. AC 10 turns on both staying disabled, and a hardcoded `false`
 * in an evidence artifact would keep claiming that after someone flipped the
 * default.
 */
function readRolloutDefaults() {
  const source = path.join(projectRoot, 'packages/config/src/flags.ts')
  if (!fs.existsSync(source)) return null
  const text = fs.readFileSync(source, 'utf8')
  const read = (key) => {
    const declaration = new RegExp(
      `${key}\\s*:\\s*\\{[^}]*?defaultValue\\s*:\\s*(true|false)`,
      's'
    ).exec(text)
    return declaration ? declaration[1] === 'true' : null
  }
  return {
    communityReadEnabled: read('community_read_enabled'),
    communityWriteEnabled: read('community_write_enabled'),
    source: 'packages/config/src/flags.ts defaultValue',
  }
}

/** The observed Neutral range, taken from the run product rather than restated. */
function neutralRange(dispositions) {
  if (!Array.isArray(dispositions) || dispositions.length === 0) return null
  const values = dispositions
    .map((entry) => entry.classProbabilities?.Neutral)
    .filter((value) => typeof value === 'number')
  if (values.length === 0) return null
  return { min: Math.min(...values), max: Math.max(...values) }
}

function countDispositions(dispositions) {
  if (!Array.isArray(dispositions)) return null
  const counts = {}
  for (const entry of dispositions) {
    counts[entry.disposition] = (counts[entry.disposition] ?? 0) + 1
  }
  return counts
}

function summariseCorpus(manifest) {
  if (!manifest) return null
  const byBand = {}
  const byContentType = {}
  for (const file of manifest.files) {
    byBand[file.neutralBand] = (byBand[file.neutralBand] ?? 0) + 1
    byContentType[file.contentType] = (byContentType[file.contentType] ?? 0) + 1
  }
  return {
    corpusId: manifest.corpusId,
    corpusVersion: manifest.corpusVersion,
    safetyClass: manifest.safetyClass,
    fixtureCount: manifest.files.length,
    byNeutralConfidenceBand: byBand,
    byContentType,
    // Derived from the manifest's own safety class rather than asserted, so a
    // corpus that ever stopped declaring itself synthetic-safe stops claiming it.
    allFixturesDeclaredSafe: manifest.safetyClass === 'synthetic-safe',
  }
}

/**
 * Decides whether the recorded numbers still describe this working tree.
 *
 * A measurement is only current if the inputs that produced it are byte-identical
 * to what is checked out now. Anything else is reported as stale with the
 * mismatched inputs named, because attributing a measurement to a build that
 * never produced it is the same class of untruth Decision 7 exists to prevent.
 */
function assessStaleness(intermediate, current) {
  if (!intermediate) return null

  const mismatches = []
  const compare = (label, recorded, actual) => {
    if (recorded !== actual) {
      mismatches.push({ input: label, recordedAtMeasurement: recorded, current: actual })
    }
  }

  compare('commitSha', intermediate.commitSha ?? null, current.commitSha)
  compare(
    'modelManifestSha256',
    intermediate.modelManifestSha256 ?? null,
    current.modelManifestSha256
  )
  compare('policySha256', intermediate.policySha256 ?? null, current.policySha256)
  compare(
    'fixtureManifestSha256',
    intermediate.fixtureManifestSha256 ?? null,
    current.fixtureManifestSha256
  )
  compare('lockfileSha256', intermediate.lockfileSha256 ?? null, current.lockfileSha256)

  return {
    current: mismatches.length === 0,
    mismatches,
    note:
      mismatches.length === 0
        ? 'Every input that produced these numbers matches the working tree.'
        : 'These numbers were produced under different inputs and must not be read as describing this build. Re-run the readiness command.',
  }
}

/*
 * Two independent sources, kept apart on purpose. `screening` is what the gated
 * readiness run observed in this repository. `performance` is AC 8's
 * 1,000-inference measurement, which is committed in the model manifest because
 * it has to be taken from compiled output and a number taken inside a test
 * transform is not comparable to it.
 */
function buildScreeningBlock(intermediate, usable, staleness) {
  if (usable) {
    return {
      available: true,
      screeningPath: intermediate.screeningPath,
      measuredAt: intermediate.measuredAt,
      modelDigest: intermediate.modelDigest ?? null,
      policyVersion: intermediate.policyVersion ?? null,
      policyDigest: intermediate.policyDigest ?? null,
      neutralRange: neutralRange(intermediate.corpusDispositions),
      dispositionCounts: countDispositions(intermediate.corpusDispositions),
      corpusDispositions: intermediate.corpusDispositions ?? null,
      staleness,
    }
  }
  return {
    available: false,
    screeningPath: null,
    reason: intermediate
      ? 'A readiness measurement exists but was produced under different inputs, so it is withheld rather than reported as current.'
      : `No readiness measurement has been produced on this checkout. Run \`${COMMANDS.model.readiness}\`, which writes ${INTERMEDIATE}.`,
    staleness,
  }
}

function buildPerformanceBlock(modelManifest) {
  const performance = modelManifest?.performance
  if (!performance?.measured) {
    return {
      available: false,
      reason: 'The model manifest carries no measured performance block yet.',
      absoluteCeilings: performance?.absoluteCeilings ?? null,
      caveats: MEASUREMENT_CAVEATS,
    }
  }
  return {
    available: true,
    source: `${MODEL_MANIFEST} performance.measured`,
    executedFrom: performance.measured.environment?.executedFrom ?? null,
    measured: performance.measured,
    absoluteCeilings: performance.absoluteCeilings ?? null,
    regressionGate: performance.regressionGate ?? null,
    uncappedThreeTimesPeakResidentMib:
      performance.uncappedThreeTimesPeakResidentMib ?? null,
    caveats: MEASUREMENT_CAVEATS,
  }
}

function buildPayload() {
  const current = {
    commitSha: gitCommitSha(),
    modelManifestSha256: sha256File(MODEL_MANIFEST),
    policySha256: sha256File(POLICY),
    fixtureManifestSha256: sha256File(FIXTURE_MANIFEST),
    lockfileSha256: sha256File(LOCKFILE),
  }

  const modelManifest = readJson(MODEL_MANIFEST)
  const policy = readJson(POLICY)
  const intermediate = readJson(INTERMEDIATE)
  const staleness = assessStaleness(intermediate, current)
  const measurementIsUsable = Boolean(intermediate) && staleness?.current === true
  const observedRange = measurementIsUsable
    ? neutralRange(intermediate.corpusDispositions)
    : null

  return {
    artifact: 'community-content-screening-measurements',
    artifactVersion: 1,
    storyKey: '6-2-production-content-screening-readiness',
    generatedAt: new Date().toISOString(),
    generatedBy: COMMANDS.evidence.emit,

    /*
     * The first thing a reader meets, because the single most damaging way to
     * misread this file is as a release decision.
     */
    scope: {
      rendersVerdict: false,
      carriesSignature: false,
      note: 'Story 6.2 emits measurements and labels the path that produced each one. Story 6.2b owns the corpus-backed gates, the evidence payload, its hash and the single recorded signature. Nothing in this file is a release decision.',
    },

    divisionOfProof: {
      thisStoryProves: 'the policy and the pipeline',
      story62bProves: "the model's accuracy",
      gateSignatureDependsOn: 'both',
      statement:
        'The deterministic evaluation proves that unsafe class-probability vectors return block, that every threshold is crossed from both sides, and that no vector reaches pass without a confident Neutral. The lifecycle suite drives a fake inference runtime emitting an unsafe vector, which proves the transport from worker message through validation, class mapping, policy evaluation, reason codes, and engine identity to a block verdict. Neither establishes that the real model emits a high Porn or Hentai probability for genuinely unsafe input, and no synthetic vector can. That single link is what AC 7 assigns to Story 6.2b corpus-backed measurement.',
    },

    build: {
      ...current,
      workingTreeClean: gitWorkingTreeClean(),
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
    },

    modelIdentity: modelManifest && {
      modelFamily: modelManifest.modelFamily,
      packageName: modelManifest.packageName,
      packageVersion: modelManifest.packageVersion,
      backend: modelManifest.backend,
      classNames: modelManifest.classNames,
      inputWidth: modelManifest.inputWidth,
      inputHeight: modelManifest.inputHeight,
    },

    modelVerification: verifyModel(),

    /*
     * Taken from the loader rather than composed here. The loader is what
     * actually stamps `moderation_engine_version` on a row, so a string built
     * independently in this file could agree with the manifest and still
     * disagree with what ran. Absent until a readiness run records it.
     */
    engineIdentity: intermediate?.identity
      ? {
          textEngineVersion: intermediate.identity.textEngineVersion ?? null,
          imageEngineVersion: intermediate.identity.imageEngineVersion ?? null,
          source: 'screening loader, recorded by the readiness run',
        }
      : {
          textEngineVersion: null,
          imageEngineVersion: null,
          source: null,
          note: `The engine identity is produced by the screening loader at runtime and is not composed here. Run \`${COMMANDS.model.readiness}\` to record it.`,
        },

    /*
     * Presence only, never the path. The restricted evaluation assets live
     * outside the repository by design, and an absolute local path in a
     * committed artifact is exactly what the story keeps out of hosted logs.
     */
    evidenceCorpus: {
      variable: 'COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR',
      configured: Boolean(process.env.COMMUNITY_SCREENING_EVIDENCE_CORPUS_DIR?.trim()),
      note: 'Restricted evaluation assets stay outside Git; only their versioned manifest and hashes are committed. Story 6.2b owns those corpora.',
    },

    policyIdentity: policy && {
      policyId: policy.policyId,
      version: policy.version,
      policySha256: current.policySha256,
      neutralPassMinimum: policy.image?.neutralPassMinimum,
      unsafeClasses: policy.image?.unsafeClasses,
      unsafeBlockMinimum: policy.image?.unsafeBlockMinimum,
      probabilitySumTolerance: policy.image?.probabilitySumTolerance,
      boundaryDisposition: policy.image?.boundaryDisposition,
    },

    fixtureCorpus: summariseCorpus(readJson(FIXTURE_MANIFEST)),

    /*
     * `screeningPath` is the field that stops a fixture run being read as a
     * real-model run. It is never inferred: it is whatever the run that produced
     * the numbers recorded about itself.
     */
    runtimeMeasurement: {
      screening: buildScreeningBlock(intermediate, measurementIsUsable, staleness),
      performance: buildPerformanceBlock(modelManifest),
    },

    endToEndJourneysDeclared: [
      {
        id: '6.2-E2E-01',
        name: 'safe upload publishes through the full stack',
        refusedBy: null,
        screeningPathIsRunSelected: true,
        intent:
          'exercise the HTTP, storage, outbox, BullMQ, model and PostgreSQL path to a terminal published author state, and assert the persisted engine identity matches the screening path the run declared',
        command: COMMANDS.pipeline.endToEnd,
      },
      {
        id: '6.2-E2E-02',
        name: 'disallowed caption never publishes and never reaches another feed',
        refusedBy: 'text-screener',
        screeningPathIsRunSelected: true,
        intent:
          'exercise non-publication, absence from a second member feed, and the absence of any raw matched term or class probability in a client payload',
        doesNotProve:
          'anything about image blocking. No unsafe imagery exists in this repository, so this journey is refused by the text screener and must not be read as end-to-end proof that the image model blocks anything.',
        command: COMMANDS.pipeline.endToEnd,
      },
    ],

    limitations: [
      {
        id: 'no-unsafe-imagery-in-repository',
        statement:
          'No unsafe imagery may enter this repository, so no end-to-end journey and no fixture measures the image model against genuinely unsafe input.',
        mitigation:
          'Image blocking is proved at the disposition-function level against synthetic class-probability vectors, and the paired unsafe journey is refused by the text screener and labelled as such.',
        revisitWhen:
          "Story 6.2b measures the model against its corpora, which is where the model's own accuracy is established.",
      },
      {
        id: 'developer-hardware-only',
        statement:
          'Any runtime measurement in this payload was taken on developer hardware, which is a sanity floor rather than release evidence.',
        mitigation:
          'The absolute ceilings in the model manifest bound a pathological run, and the committed regression gate is set from a measured value at three times its size.',
        revisitWhen:
          'Story 6.2b measures on the named hosted target with its CPU allocation, memory limit and replica topology.',
      },
      {
        id: 'synthetic-safe-corpus',
        statement:
          'The committed fixture corpus is synthetic woven-textile imagery, not photographs of real submissions, so it does not describe the distribution of real Community uploads.',
        mitigation: observedRange
          ? `The corpus spans a measured Neutral range from ${observedRange.max.toFixed(4)} down to ${observedRange.min.toFixed(4)}, so it exercises both the pass and the review branch of the pinned policy.`
          : 'The corpus is designed to span the model confidence range so that both the pass and the review branch of the pinned policy are exercised. No measured range is available on this checkout.',
        revisitWhen:
          'Story 6.2b measures the false-positive rate on at least 250 openly licensed real fashion photographs.',
      },
      {
        id: 'local-dispatch-cadence',
        statement:
          'The end-to-end stack dispatches the moderation outbox once a second; production uses a one-minute scheduler.',
        mitigation:
          'The one-second cadence is a test-harness setting only and is never presented as latency evidence.',
        revisitWhen: 'Story 6.2b measures queue latency against the deployed worker.',
      },
    ],

    rollout: {
      ...(readRolloutDefaults() ?? {
        communityReadEnabled: null,
        communityWriteEnabled: null,
        source: null,
      }),
      note: 'Read from the shared flag registry defaults. Both production Community rollout controls remain disabled, and nothing in this story authorizes changing them.',
    },

    commands: COMMANDS,
  }
}

/*
 * `_bmad-output` is inside the repository prettier glob, so a hand-serialised
 * payload fails `npm run lint`: prettier collapses short arrays that
 * JSON.stringify always expands. Formatting through prettier's own API is what
 * keeps a generated artifact and the lint gate from disagreeing.
 */
async function writeJson(relativePath, value) {
  const fullPath = path.join(projectRoot, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  const prettier = await import('prettier')
  const options = (await prettier.resolveConfig(fullPath)) ?? {}
  const formatted = await prettier.format(`${JSON.stringify(value, null, 2)}\n`, {
    ...options,
    parser: 'json',
  })
  fs.writeFileSync(fullPath, formatted)
}

async function main() {
  const payload = buildPayload()

  if (payload.fixtureCorpus === null) {
    console.error(
      `[measurements] Fixture manifest missing at ${FIXTURE_MANIFEST}. Run \`${COMMANDS.fixtureCorpus.generate}\`.`
    )
    process.exit(1)
  }
  if (!payload.modelIdentity || !payload.policyIdentity) {
    console.error(
      '[measurements] The model manifest or the screening policy is missing, so no truthful identity can be recorded.'
    )
    process.exit(1)
  }

  await writeJson(OUTPUT, payload)

  const { screening, performance } = payload.runtimeMeasurement
  console.log(`Wrote ${OUTPUT}`)
  console.log(
    `  screening path: ${screening.available ? screening.screeningPath : 'none (no usable readiness measurement)'}`
  )
  if (screening.available) {
    console.log(`  corpus dispositions: ${JSON.stringify(screening.dispositionCounts)}`)
  } else {
    console.warn(`  ${screening.reason}`)
  }
  if (screening.staleness && !screening.staleness.current) {
    for (const mismatch of screening.staleness.mismatches) {
      console.warn(`  stale input: ${mismatch.input}`)
    }
  }
  console.log(
    `  performance: ${performance.available ? `from ${performance.executedFrom}` : 'not measured'}`
  )
  console.log('  verdict: none, by design. Story 6.2b renders it.')
}

main().catch((error) => {
  console.error('Community screening measurement error:', error)
  process.exit(1)
})
