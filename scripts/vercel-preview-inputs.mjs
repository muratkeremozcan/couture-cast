import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, laneInputs, readWorkspaceDependencies } from './ci/lanes.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The lane in scripts/ci/lanes.mjs that runs the preview deploys and their end-to-end tests. */
export const PREVIEW_LANE = 'preview'

// Paths no Vercel build reads: tests, workflows and load scripts run in CI against a deployment.
// A preview deployment is reused only for the same inputs (scripts/vercel-preview-deploy.mjs).
// Everything else stays an input of both projects, shared packages, the lockfile, root
// configuration, prisma and scripts included, so a new top-level path builds by default.
const outsideBuilds = [
  'apps/mobile',
  'docs',
  '_bmad-output',
  '.github',
  'playwright',
  'maestro',
  'k6',
  'pact',
]

/** Each Vercel project builds from the repository less the other app and the paths above. */
export const projectBuildPaths = {
  web: ['.', ...[...outsideBuilds, 'apps/api'].map((dir) => `:(exclude)${dir}`)],
  api: ['.', ...[...outsideBuilds, 'apps/web'].map((dir) => `:(exclude)${dir}`)],
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
}

/** Why a git call failed, without the remote URL's credentials. */
function failure(result) {
  const detail = result.error?.code ?? result.signal ?? `exit ${result.status}`
  const lines = String(result.stderr ?? '')
    .replace(/\/\/[^/@\s]+@/g, '//[credentials]@')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  // git's first fatal or error line names the cause; its hints follow it.
  const stderr = lines.find((line) => /^(fatal|error):/.test(line)) ?? lines.at(-1)
  return stderr ? `${detail}: ${stderr}` : detail
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
 * path, mode and blob the project builds from. Two commits with the same hash build the same
 * source, whatever their history, so it needs neither commit's ancestry.
 * @param {string} cwd @param {'web' | 'api'} project
 * @returns {string}
 */
export function inputsHash(cwd, project) {
  const paths = projectBuildPaths[project]
  if (!paths) throw new Error(`Unknown preview project ${JSON.stringify(project)}`)
  const listed = git(['ls-files', '--stage', '--', ...paths], cwd)
  if (listed.status !== 0) throw new Error(`git ls-files failed (${failure(listed)})`)
  const dirty = git(
    ['status', '--porcelain', '--untracked-files=no', '--', ...paths],
    cwd
  )
  if (dirty.status !== 0 || dirty.stdout.trim())
    throw new Error('the checkout has uncommitted changes to the build inputs')
  return createHash('sha256').update(listed.stdout).digest('hex')
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
