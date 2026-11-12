import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Paths no preview deployment and no preview check reads.
const outsidePreviews = ['apps/mobile', 'docs', '_bmad-output']

// The exact-SHA preview checks (CI, end-to-end tests) read everything else, tests and workflows
// included. Keeping the full branch diff means a later mobile commit still checks earlier API
// or web changes.
const previewPaths = ['.', ...outsidePreviews.map((dir) => `:(exclude)${dir}`)]

// Paths no Vercel build reads: tests, workflows and load scripts run in CI against a deployment.
// A preview deployment is reused only for the same inputs (scripts/vercel-preview-deploy.mjs).
// Everything else stays an input of both projects, shared packages, the lockfile, root
// configuration, prisma and scripts included, so a new top-level path builds by default.
const outsideBuilds = [
  ...outsidePreviews,
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
 * Whether the branch changes any of `paths` since it left `base`.
 * @param {string} cwd @param {string} base @param {string} head @param {string[]} paths
 * @returns {{ required: boolean, reason: string }}
 */
export function previewDecision(cwd, base, head = 'HEAD', paths = previewPaths) {
  const comparison = git(['merge-base', base, head], cwd)
  const ancestor = comparison.stdout?.trim()
  if (comparison.status !== 0 || !/^[a-f0-9]{40}$/.test(ancestor))
    return {
      required: true,
      reason: `no common ancestor with ${base} (${failure(comparison)})`,
    }
  const result = git(['diff', '--name-only', ancestor, head, '--', ...paths], cwd)
  if (result.status !== 0)
    return { required: true, reason: `diff failed (${failure(result)})` }
  const changed = result.stdout.split('\n').filter(Boolean)
  if (!changed.length)
    return { required: false, reason: `no input changed since ${ancestor}` }
  return { required: true, reason: describeChanged(changed) }
}

/** @param {string} cwd @param {string} base @param {string} [head] @param {string[]} [paths] */
export function previewRequired(cwd, base, head = 'HEAD', paths = previewPaths) {
  return previewDecision(cwd, base, head, paths).required
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
