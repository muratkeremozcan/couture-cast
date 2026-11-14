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
// Each run must have: every capture `<dir>/<name>.json` committed at HEAD, whose volatile keys
// recomputed by stage equal this run's; a committed evidence manifest (`<dir>/manifest.json`, or
// the run root's one level up) for the live-font leg whose inputs are unchanged at HEAD; and the
// same manifest sha as every other run. Across the runs no two captures may hash alike (a copied
// run) and no two runs may share a launch (pid with its mount identity).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { changedInputs } from './evidence-manifest.mjs'
import { canonicalVolatileKeys, captureVolatileKeys } from './live-font-scale-proof.mjs'

const CAPTURE_NAME = /^[a-z]+-\d{3}-[a-z]+-[0-9a-z.-]+$/
const SHA = /^[0-9a-f]{40}$/

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

/** One run read back from the repository, or why it cannot prove anything. */
function readRun(run, index, { stages, platform, read, changed, current }) {
  const manifest = manifestOf(run.dir, read)
  if (!manifest)
    return { problem: `volatileProof run ${index} has no committed manifest` }
  if (manifest.leg !== 'live-font' || !SHA.test(String(manifest.sha)))
    return { problem: `volatileProof run ${index} manifest is no live-font manifest` }
  if (changed(manifest).length)
    return { problem: `volatileProof run ${index} inputs changed since ${manifest.sha}` }
  const hashes = []
  const launches = new Set()
  const keys = {}
  for (const stage of stages) {
    const file = `${run.dir}/${run.evidence[stage]}.json`
    const bytes = read(file)
    if (bytes === null)
      return { problem: `volatileProof run ${index} ${file} is not committed` }
    hashes.push(createHash('sha256').update(bytes).digest('hex'))
    const capture = JSON.parse(String(bytes))
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
 * file's bytes at HEAD or null (committedReader), `changed(manifest)` the manifest's inputs that
 * differ at HEAD (evidence-manifest changedInputs); both are injectable for the units.
 */
export function createVolatileProofCheck({
  platform,
  repoRoot,
  read = committedReader(repoRoot),
  changed = (manifest) => changedInputs(manifest, { cwd: repoRoot, requireClean: false }),
}) {
  return (proof, currentKeys) => {
    const stages = Object.keys(currentKeys).sort()
    const shape = shapeProblem(proof, stages)
    if (shape) return shape
    const current = canonicalVolatileKeys(currentKeys)
    const runs = []
    for (const [index, run] of proof.runs.entries()) {
      const read_ = readRun(run, index, { stages, platform, read, changed, current })
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
