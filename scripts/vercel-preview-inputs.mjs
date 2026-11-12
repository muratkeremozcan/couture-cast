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

/** Origin, then the public repository Vercel names, which its clone has no remote for. */
function remotesOf(env) {
  const remotes = ['origin']
  const { VERCEL_GIT_PROVIDER, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG } = env
  if (VERCEL_GIT_PROVIDER === 'github' && VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG)
    remotes.push(
      `https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git`
    )
  return remotes
}

/**
 * Fetches main into FETCH_HEAD: from origin or, when the clone's origin cannot be fetched,
 * from the public repository Vercel names. A Vercel clone may contain only the preview branch.
 * @param {NodeJS.ProcessEnv} env @param {string} cwd
 * @returns {{ remote: string, base: string } | { reason: string }}
 */
function fetchMain(env, cwd) {
  const misses = []
  for (const remote of remotesOf(env)) {
    const fetched = git(['fetch', '--no-tags', '--depth=50', remote, 'main'], cwd)
    if (fetched.status !== 0) {
      misses.push(
        `fetch ${remote === 'origin' ? 'origin' : 'public URL'}: ${failure(fetched)}`
      )
      continue
    }
    const base = git(['rev-parse', 'FETCH_HEAD'], cwd).stdout?.trim()
    if (/^[a-f0-9]{40}$/.test(base)) return { remote, base }
    misses.push(
      `FETCH_HEAD unreadable after fetching ${remote === 'origin' ? 'origin' : 'public URL'}`
    )
  }
  return { reason: `main unavailable (${misses.join('; ')})` }
}

/**
 * Deepens a shallow clone until main and HEAD share history, or says why it could not.
 * @param {NodeJS.ProcessEnv} env @param {string} cwd @param {string} remote @param {string} base
 * @returns {string | undefined} the reason the build must run, when history stays unavailable
 */
function recoverHistory(env, cwd, remote, base) {
  if (git(['merge-base', base, 'HEAD'], cwd).status === 0) return undefined
  const branch =
    env.VERCEL_GIT_COMMIT_REF ??
    git(['symbolic-ref', '--short', 'HEAD'], cwd).stdout?.trim()
  if (!branch || git(['check-ref-format', '--branch', branch], cwd).status !== 0)
    return `shallow history and no usable branch name (${branch})`
  // The main fetch does not deepen the preview side of a shallow clone.
  // Recover both histories within a bounded fetch; missing history still keeps the build.
  const deepened = git(
    ['fetch', '--no-tags', '--deepen=1000', remote, 'main', branch],
    cwd
  )
  return deepened.status === 0 ? undefined : `deepen failed (${failure(deepened)})`
}

/**
 * Which of `paths` differ between two commits, compared tree to tree.
 * @param {string} cwd @param {string} from @param {string} to @param {string[]} paths
 * @returns {{ changed: string[] } | { reason: string }}
 */
export function inputsChanged(cwd, from, to, paths) {
  const result = git(['diff', '--name-only', from, to, '--', ...paths], cwd)
  if (result.status !== 0) return { reason: `diff failed (${failure(result)})` }
  return { changed: result.stdout.split('\n').filter(Boolean) }
}

function describeChanged(changed) {
  const more = changed.length > 3 ? ` and ${changed.length - 3} more` : ''
  return `changed ${changed.slice(0, 3).join(', ')}${more}`
}

/**
 * Makes `sha` readable in a shallow clone, fetching that one commit from origin or the
 * public repository Vercel names.
 * @param {NodeJS.ProcessEnv} env @param {string} cwd @param {string} sha
 * @returns {string | undefined} why it could not, if it could not
 */
function ensureCommit(env, cwd, sha) {
  if (git(['cat-file', '-e', `${sha}^{commit}`], cwd).status === 0) return undefined
  const misses = []
  for (const remote of remotesOf(env)) {
    const fetched = git(['fetch', '--no-tags', '--depth=1', remote, sha], cwd)
    if (fetched.status === 0) return undefined
    misses.push(
      `fetch ${remote === 'origin' ? 'origin' : 'public URL'}: ${failure(fetched)}`
    )
  }
  return `commit ${sha} unavailable (${misses.join('; ')})`
}

/**
 * The ignored build step of one Vercel project: build (1) or skip (0), and why.
 *
 * A build is skipped when nothing needs it: no preview check reads what the branch changed
 * against main, or the branch's last ready deployment of this project (Vercel's
 * VERCEL_GIT_PREVIOUS_SHA) was built from the same inputs, so the preview wait can test that
 * deployment in its place. Vercel's clone has no remote and ten commits of history (measured
 * 2026-11-12), so main and the earlier commit come from the public repository.
 * @param {NodeJS.ProcessEnv} env @param {string} cwd @param {string | undefined} project
 * @returns {{ code: 0 | 1, reason: string }}
 */
export function ignoredBuildDecision(env, cwd = repoRoot, project) {
  const paths = projectBuildPaths[/** @type {'web' | 'api'} */ (project)]
  if (!paths) return { code: 1, reason: `unknown project ${JSON.stringify(project)}` }
  if (env.VERCEL_ENV !== 'preview')
    return { code: 1, reason: `VERCEL_ENV is ${env.VERCEL_ENV ?? 'unset'}` }
  const notes = []
  const main = fetchMain(env, cwd)
  if ('reason' in main) notes.push(main.reason)
  else {
    const missing = recoverHistory(env, cwd, main.remote, main.base)
    if (missing) notes.push(missing)
    else {
      const preview = previewDecision(cwd, main.base, 'HEAD')
      if (!preview.required)
        return {
          code: 0,
          reason: `no preview check reads this branch (${preview.reason})`,
        }
      notes.push(`preview checks run (${preview.reason})`)
    }
  }
  const previous = env.VERCEL_GIT_PREVIOUS_SHA
  if (!previous || !/^[a-f0-9]{40}$/.test(previous))
    return {
      code: 1,
      reason: `no earlier ${project} deployment of this branch; ${notes.join('; ')}`,
    }
  const unavailable = ensureCommit(env, cwd, previous)
  if (unavailable) return { code: 1, reason: unavailable }
  const diff = inputsChanged(cwd, previous, 'HEAD', paths)
  if ('reason' in diff) return { code: 1, reason: diff.reason }
  if (diff.changed.length)
    return { code: 1, reason: `${describeChanged(diff.changed)} since ${previous}` }
  return {
    code: 0,
    reason: `no ${project} input changed since ${previous}, the branch's last ${project} deployment`,
  }
}

/** @param {NodeJS.ProcessEnv} env @param {string} [cwd] @param {string} [project] */
export function ignoredBuildExitCode(env, cwd = repoRoot, project) {
  return ignoredBuildDecision(env, cwd, project).code
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === '--ignore') {
    const project = process.argv[3]
    const { code, reason } = ignoredBuildDecision(process.env, repoRoot, project)
    process.exitCode = code
    console.log(
      code === 0
        ? `Ignored build step: ${project} inputs unchanged; skipping (${reason}).`
        : `Ignored build step: ${project} build required (${reason}).`
    )
  } else {
    const preview = previewDecision(repoRoot, 'refs/remotes/origin/main')
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `required=${preview.required}\n`)
    console.log(`Preview checks required: ${preview.required} (${preview.reason})`)
  }
}
