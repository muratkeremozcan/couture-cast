// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// TEA ruling r47 (r45 P2-1): a residual entry may list a volatile key only when two committed
// runs prove the volatile region data deterministic. The entry names the runs; the harness reads
// them from the repository at HEAD and recomputes everything, so no field of the entry is
// trusted beyond the paths it names. Entry shape:
//
//   volatileProof: {
//     runs: [
//       { dir: '<repository-relative dir holding the captures>',
//         evidence: { <stage>: '<capture name>', ... } },   // the leg's stages, exactly
//       ...                                                  // two runs or more
//     ],
//   }
//
// Each run must have (TEA rulings r47 and r48):
//   - a committed evidence manifest (`<dir>/manifest.json`, or the run root's one level up),
//     exactly { leg: 'live-font', sha, inputs }, whose sha is a commit that is HEAD or an
//     ancestor of it; the leg's inputs are recomputed from git at that sha and at HEAD and must
//     not differ (the manifest's own inputs map is never read);
//   - a committed capture hash list beside its captures, `<dir>/capture-hashes.json`, which the
//     runner writes at the end of every run:
//       { version: 1, leg: 'live-font', sha: '<the run's HEAD, the manifest sha>',
//         captures: { '<capture name>': '<sha256 of the capture file>' } }
//     naming the manifest's sha and every capture the proof uses with its sha256;
//   - every capture `<dir>/<name>.json` committed at HEAD, hashing as listed, of the run's
//     platform and of the stage it stands for, whose volatile keys recomputed by stage equal
//     this run's.
// All runs share one manifest sha; across them no two captures hash alike (a copied run) and no
// two runs share a launch (pid with its mount identity). A malformed file fails the proof with
// its reason, never with a crash.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { canonicalVolatileKeys, captureVolatileKeys } from './live-font-scale-proof.mjs'

const CAPTURE_NAME = /^[a-z]+-\d{3}-[a-z]+-[0-9a-z.-]+$/
const SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
/** The capture hash list the runner writes beside its captures. */
export const CAPTURE_HASHES = 'capture-hashes.json'
/** The capture stage each leg stage stands for. */
const CAPTURE_STAGE = {
  before: 'before',
  settled: 'settled',
  updated: 'updated',
  coldBefore: 'cold',
  cold: 'cold',
  coldBeforeUpdated: 'cold',
  coldUpdated: 'cold',
}

/** sha256 of bytes, hex. */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * The capture hash list of the run dir `dir` at its end: every capture file there
 * (`<screen>-NNN-<stage>-<scale>.json`) by name with its sha256, under the run's HEAD `sha`.
 * `fs` is injectable for the units.
 */
export function captureHashes({ dir, sha, fs }) {
  const captures = {}
  for (const file of fs.readdirSync(dir).sort()) {
    const name = file.replace(/\.json$/, '')
    // A capture's page list (`-pages`) and a failed scroll-back read (`-not-restored`) are not
    // captures.
    if (
      file.endsWith('.json') &&
      CAPTURE_NAME.test(name) &&
      !/-(?:pages|not-restored)$/.test(name)
    )
      captures[name] = sha256(fs.readFileSync(path.join(dir, file)))
  }
  return { version: 1, leg: 'live-font', sha, captures }
}

/** Whether `sha` names a commit that is HEAD or an ancestor of it, in `repoRoot`. */
export function commitAncestor(repoRoot) {
  const git = (args) =>
    spawnSync('git', args, { cwd: repoRoot, timeout: 30_000, killSignal: 'SIGKILL' })
  return (sha) => {
    const commit = git(['cat-file', '-e', `${sha}^{commit}`])
    if (commit.error) throw commit.error
    if (commit.status !== 0) return false
    const ancestor = git(['merge-base', '--is-ancestor', sha, 'HEAD'])
    if (ancestor.error) throw ancestor.error
    return ancestor.status === 0
  }
}

const exactFields = (object, fields) =>
  object !== null &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...fields].sort())

/** A repository-relative path that stays inside the repository. */
const safeDir = (dir) =>
  typeof dir === 'string' &&
  dir !== '' &&
  !path.isAbsolute(dir) &&
  !dir.includes('\\') &&
  dir.split('/').every((part) => part !== '' && part !== '.' && part !== '..')

/** `git show HEAD:<file>` in `repoRoot`, bounded; null when HEAD has no such file. */
export function committedReader(repoRoot) {
  return (file) => {
    const result = spawnSync('git', ['show', `HEAD:${file}`], {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30_000,
      killSignal: 'SIGKILL',
    })
    if (result.error) throw result.error
    return result.status === 0 ? result.stdout : null
  }
}

/** Why the entry's shape is no proof for a leg with these stages, or null. */
function shapeProblem(proof, stages) {
  if (!exactFields(proof, ['runs']) || !Array.isArray(proof.runs))
    return 'volatileProof must be { runs }'
  if (proof.runs.length < 2) return 'volatileProof needs two runs or more'
  for (const [index, run] of proof.runs.entries()) {
    if (!exactFields(run, ['dir', 'evidence']) || !safeDir(run.dir))
      return `volatileProof run ${index} must be { dir, evidence } with a repository path`
    if (
      !exactFields(run.evidence, stages) ||
      !stages.every((stage) => CAPTURE_NAME.test(String(run.evidence[stage])))
    )
      return `volatileProof run ${index} evidence must name a capture for ${stages.join(',')}`
  }
  if (new Set(proof.runs.map((run) => run.dir)).size !== proof.runs.length)
    return 'volatileProof runs must be distinct dirs'
  return null
}

/** The run's committed manifest: in its dir, else the run root one level up. */
function manifestOf(dir, read) {
  for (const file of [
    `${dir}/manifest.json`,
    `${path.posix.dirname(dir)}/manifest.json`,
  ]) {
    const bytes = read(file)
    if (bytes !== null) return JSON.parse(String(bytes))
  }
  return null
}

const plainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Why a manifest is no live-font manifest at a commit HEAD descends from, or null. */
function manifestProblem(manifest, { ancestor, changed }) {
  if (
    !exactFields(manifest, ['inputs', 'leg', 'sha']) ||
    manifest.leg !== 'live-font' ||
    !SHA.test(String(manifest.sha)) ||
    !plainObject(manifest.inputs)
  )
    return 'manifest is malformed or of another leg'
  if (!ancestor(manifest.sha))
    return `manifest sha ${manifest.sha} is no commit HEAD descends from`
  if (changed(manifest.sha).length) return `inputs changed since ${manifest.sha}`
  return null
}

/** Why a capture hash list does not bind this run's captures, or null. */
function hashListProblem(list, sha) {
  if (
    !exactFields(list, ['captures', 'leg', 'sha', 'version']) ||
    list.version !== 1 ||
    list.leg !== 'live-font' ||
    !plainObject(list.captures) ||
    !Object.values(list.captures).every((hash) => SHA256.test(String(hash)))
  )
    return `${CAPTURE_HASHES} is malformed`
  if (list.sha !== sha) return `${CAPTURE_HASHES} names ${list.sha}, the manifest ${sha}`
  return null
}

/** One run read back from the repository, or why it cannot prove anything. */
function readRun(run, index, context) {
  try {
    return readRunUnsafe(run, index, context)
  } catch (error) {
    const reason = String(error?.code ?? error?.message ?? error).split('\n')[0]
    return { problem: `volatileProof run ${index} is unreadable: ${reason}` }
  }
}

function readRunUnsafe(
  run,
  index,
  { stages, platform, read, ancestor, changed, current }
) {
  const at = `volatileProof run ${index}`
  const manifest = manifestOf(run.dir, read)
  if (!manifest) return { problem: `${at} has no committed manifest` }
  const manifestIssue = manifestProblem(manifest, { ancestor, changed })
  if (manifestIssue) return { problem: `${at} ${manifestIssue}` }
  const listBytes = read(`${run.dir}/${CAPTURE_HASHES}`)
  if (listBytes === null) return { problem: `${at} has no committed ${CAPTURE_HASHES}` }
  const list = JSON.parse(String(listBytes))
  const listIssue = hashListProblem(list, manifest.sha)
  if (listIssue) return { problem: `${at} ${listIssue}` }
  const hashes = []
  const launches = new Set()
  const keys = {}
  for (const stage of stages) {
    const name = run.evidence[stage]
    const file = `${run.dir}/${name}.json`
    const bytes = read(file)
    if (bytes === null) return { problem: `${at} ${file} is not committed` }
    const hash = sha256(bytes)
    if (list.captures[name] !== hash)
      return { problem: `${at} ${name} does not hash as ${CAPTURE_HASHES} lists` }
    hashes.push(hash)
    const capture = JSON.parse(String(bytes))
    if (
      capture?.textProbe?.platform !== platform ||
      capture.stage !== CAPTURE_STAGE[stage]
    )
      return {
        problem: `${at} ${name} is no ${platform} ${CAPTURE_STAGE[stage]} capture`,
      }
    launches.add(`${capture.pid}|${capture.identity?.root ?? ''}`)
    keys[stage] = captureVolatileKeys(capture, platform)
  }
  if (canonicalVolatileKeys(keys) !== current)
    return {
      problem: `volatile keys of run ${index} (${run.dir}) differ from this run's`,
    }
  return { sha: manifest.sha, hashes, launches }
}

/**
 * The verifier the oracle calls with an entry's `volatileProof` and this leg's volatile keys by
 * stage (legVolatileKeys); it returns why the proof fails, or null. `read(file)` returns the
 * file's bytes at HEAD or null (committedReader), `ancestor(sha)` whether sha is a commit HEAD
 * descends from (commitAncestor), and `changed(sha)` the live-font inputs that differ between
 * sha and HEAD, both recomputed from git (evidence-manifest writeManifest and changedInputs,
 * which the runner passes in: importing the manifest module here would pull every leg's harness
 * paths into the live-font leg). Without `changed` no run proves anything.
 */
export function createVolatileProofCheck({
  platform,
  repoRoot,
  read = committedReader(repoRoot),
  ancestor = commitAncestor(repoRoot),
  changed,
}) {
  return (proof, currentKeys) => {
    const stages = Object.keys(currentKeys).sort()
    const shape = shapeProblem(proof, stages)
    if (shape) return shape
    const current = canonicalVolatileKeys(currentKeys)
    const runs = []
    for (const [index, run] of proof.runs.entries()) {
      const read_ = readRun(run, index, {
        stages,
        platform,
        read,
        ancestor,
        changed: changed ?? (() => [{ path: 'no input comparison' }]),
        current,
      })
      if (read_.problem) return read_.problem
      runs.push(read_)
    }
    if (new Set(runs.map((run) => run.sha)).size !== 1)
      return 'volatileProof runs were built at different heads'
    const hashes = runs.flatMap((run) => run.hashes)
    if (new Set(hashes).size !== hashes.length)
      return 'volatileProof runs share a capture (copied run)'
    const launches = runs.flatMap((run) => [...run.launches])
    if (new Set(launches).size !== launches.length)
      return 'volatileProof runs share a launch'
    return null
  }
}
