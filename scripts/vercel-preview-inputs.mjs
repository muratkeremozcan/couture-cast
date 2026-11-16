import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, laneInputs, readWorkspaceDependencies } from './ci/lanes.mjs'
import {
  failure,
  inputsHashAt,
  PROJECT_APPS,
  workingTree,
} from './vercel-build-inputs.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The lane in scripts/ci/lanes.mjs that runs the preview deploys and their end-to-end tests. */
export const PREVIEW_LANE = 'preview'

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
}

/**
 * Whether the branch changes a file the preview lane builds, runs or reads since it left `base`.
 * The lane map (scripts/ci/lanes.mjs) decides, as it does for the pull request's own plan; the
 * diff covers the whole branch, so a later mobile commit still checks earlier API or web
 * changes. Renames count as a deletion and an addition, so moving runtime code under docs/
 * still names the path it left.
 * @param {string} cwd @param {string} base @param {string} [head]
 * @param {Record<string, string[]>} [dependencies] each workspace's @couture dependencies, read
 *   by default from the manifests in `cwd`
 * @returns {{ required: boolean, reason: string }}
 */
export function previewDecision(cwd, base, head = 'HEAD', dependencies) {
  const comparison = git(['merge-base', base, head], cwd)
  const ancestor = comparison.stdout?.trim()
  if (comparison.status !== 0 || !/^[a-f0-9]{40}$/.test(ancestor))
    return {
      required: true,
      reason: `no common ancestor with ${base} (${failure(comparison)})`,
    }
  const result = git(['diff', '--name-only', '--no-renames', ancestor, head], cwd)
  if (result.status !== 0)
    return { required: true, reason: `diff failed (${failure(result)})` }
  let inputs
  try {
    inputs = laneInputs(dependencies ?? readWorkspaceDependencies(cwd))
  } catch (error) {
    return { required: true, reason: `the lane map could not be read (${error.message})` }
  }
  const changed = result.stdout
    .split('\n')
    .filter(Boolean)
    .filter((file) => classify(file, inputs).lanes.includes(PREVIEW_LANE))
  if (!changed.length)
    return { required: false, reason: `no preview input changed since ${ancestor}` }
  return { required: true, reason: describeChanged(changed) }
}

/**
 * @param {string} cwd @param {string} base @param {string} [head]
 * @param {Record<string, string[]>} [dependencies]
 */
export function previewRequired(cwd, base, head = 'HEAD', dependencies) {
  return previewDecision(cwd, base, head, dependencies).required
}

function describeChanged(changed) {
  const more = changed.length > 3 ? ` and ${changed.length - 3} more` : ''
  return `changed ${changed.slice(0, 3).join(', ')}${more}`
}

/**
 * The identity of a project's build inputs in a clean checkout: a hash over every tracked
 * path, mode and blob the project builds from (scripts/vercel-build-inputs.mjs, which the
 * ignored build step on main asks too). Two commits with the same hash build the same source,
 * whatever their history, so it needs neither commit's ancestry.
 * @param {string} cwd @param {'web' | 'api'} project
 * @returns {string}
 */
export function inputsHash(cwd, project) {
  if (!Object.hasOwn(PROJECT_APPS, project))
    throw new Error(`Unknown preview project ${JSON.stringify(project)}`)
  const committed = inputsHashAt(cwd, project, 'HEAD')
  // A deployment builds the commit, so an edit to an input the commit lacks would mislabel it.
  if (inputsHashAt(cwd, project, workingTree(cwd)) !== committed)
    throw new Error('the checkout has uncommitted changes to the build inputs')
  return committed
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // An explicit manual run or forced rebuild asks for previews whatever the branch changed;
  // only the automatic decision skips a branch no preview check reads.
  const preview =
    process.env.REQUIRE_PREVIEWS === 'true'
      ? { required: true, reason: 'requested explicitly' }
      : previewDecision(repoRoot, 'refs/remotes/origin/main')
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `required=${preview.required}\n`)
  console.log(`Preview checks required: ${preview.required} (${preview.reason})`)
}
