import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Both projects and the preview waiter use this comparison. Keeping the full
// branch diff means a later mobile commit still deploys earlier API/web changes.
const previewPaths = [
  '.',
  ':(exclude)apps/mobile',
  ':(exclude)docs',
  ':(exclude)_bmad-output',
]

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
}

/** @param {string} cwd @param {string} base @param {string} head */
export function previewRequired(cwd, base, head = 'HEAD') {
  const comparison = git(['merge-base', base, head], cwd)
  const ancestor = comparison.stdout?.trim()
  if (comparison.status !== 0 || !/^[a-f0-9]{40}$/.test(ancestor)) return true
  const result = git(['diff', '--quiet', ancestor, head, '--', ...previewPaths], cwd)
  // Git exits 1 for changes and >1 for errors. Both require a deployment.
  return result.status !== 0
}

/** @param {NodeJS.ProcessEnv} env @param {string} cwd */
export function ignoredBuildExitCode(env, cwd = repoRoot) {
  if (env.VERCEL_ENV !== 'preview') return 1
  // A Vercel clone may contain only the preview branch. Fetch the production
  // branch explicitly; an unavailable common ancestor always keeps the build.
  const fetched = git(['fetch', '--no-tags', '--depth=50', 'origin', 'main'], cwd)
  if (fetched.status !== 0) return 1
  const base = git(['rev-parse', 'FETCH_HEAD'], cwd).stdout?.trim()
  if (!/^[a-f0-9]{40}$/.test(base)) return 1
  if (git(['merge-base', base, 'HEAD'], cwd).status !== 0) {
    const branch =
      env.VERCEL_GIT_COMMIT_REF ??
      git(['symbolic-ref', '--short', 'HEAD'], cwd).stdout?.trim()
    if (!branch || git(['check-ref-format', '--branch', branch], cwd).status !== 0)
      return 1
    // The main fetch does not deepen the preview side of a shallow clone.
    // Recover both histories within a bounded fetch; missing history still keeps the build.
    const deepened = git(
      ['fetch', '--no-tags', '--deepen=1000', 'origin', 'main', branch],
      cwd
    )
    if (deepened.status !== 0) return 1
  }
  return previewRequired(cwd, base) ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--ignore') {
    process.exitCode = ignoredBuildExitCode(process.env)
    console.log(
      process.exitCode === 0
        ? 'Preview inputs unchanged; skipping both projects.'
        : 'Preview build required.'
    )
  } else {
    const required = previewRequired(repoRoot, 'refs/remotes/origin/main')
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`)
    }
    console.log(`Preview build and exact-SHA checks required: ${required}`)
  }
}
