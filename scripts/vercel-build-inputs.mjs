#!/usr/bin/env node
/**
 * The files each Vercel project builds from, in one place for every decision that asks:
 *
 * - the preview deploys reuse a deployment only for the same inputs
 *   (scripts/vercel-preview-inputs.mjs, scripts/vercel-preview-deploy.mjs);
 * - the ignored build step skips a production build of main when the inputs equal those of
 *   the last successful production deployment (`ignoreCommand` in apps/web/vercel.json and
 *   apps/api/vercel.json);
 * - the production E2E run accepts the deployment a skipped build left serving
 *   (.github/workflows/pw-e2e-prod.yml).
 *
 * Vercel runs the ignored build step in its build clone before any install, so this file
 * imports node: built-ins only. That clone has no git remote and about ten commits of history
 * (probed 2026-11-12), so a commit it lacks is fetched from the public repository Vercel names.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @typedef {'web' | 'api'} Project */

/** Each project's app; a project builds from the repository less the other app. */
export const PROJECT_APPS = { web: 'apps/web', api: 'apps/api' }

/**
 * Paths no Vercel build reads: tests, workflows and load scripts run in CI against a
 * deployment. Everything else outside scripts/ stays an input of both projects (shared
 * packages, the lockfile, root configuration, prisma, supabase), so a new top-level path builds
 * by default.
 */
export const OUTSIDE_BUILDS = [
  'apps/mobile',
  'docs',
  '_bmad-output',
  '.github',
  'playwright',
  'maestro',
  'k6',
  'pact',
]

/**
 * The scripts a build runs. Both installs and the package builds run check-node-version.mjs
 * (the root preinstall) and build-workspace-package.mjs (each package's build); the API's
 * build command (its Vercel project settings, mirrored by `vercel:build` in apps/api's
 * package.json) also runs prisma-migrate-deploy.mjs. What they import or name by relative
 * path is an input too (scriptInputs). Every other file under scripts/ is CI and test
 * tooling no build reads, and changes to it used to rebuild both projects: from 2026-11-13 to
 * 2026-11-16, 27 of 40 API and 15 of 28 web preview rebuilds on a branch that already had one
 * changed no build input outside scripts/.
 */
export const BUILD_SCRIPTS = {
  web: ['scripts/check-node-version.mjs', 'scripts/build-workspace-package.mjs'],
  api: [
    'scripts/check-node-version.mjs',
    'scripts/build-workspace-package.mjs',
    'scripts/prisma-migrate-deploy.mjs',
  ],
}

/**
 * Relative references in a script: import, export from, import(), require(), and any other
 * quoted path that starts with ./ or ../ (a file a script reads or spawns by path).
 */
const RELATIVE_REFERENCE = /['"`](\.{1,2}\/[^'"`\s]+)['"`]/g

/**
 * The scripts `entries` load, closed over their relative references into scripts/. A
 * reference to a file that does not exist stays in the set, so adding that file later changes
 * the inputs; a path in a comment counts too, which can only add an input.
 * @param {readonly string[]} entries repository paths
 * @param {(file: string) => string | null} read a file's text, or null when it is absent
 * @returns {Set<string>}
 */
export function scriptInputs(entries, read) {
  const found = new Set()
  const queue = [...entries]
  while (queue.length) {
    const file = /** @type {string} */ (queue.pop())
    if (found.has(file)) continue
    found.add(file)
    const text = read(file)
    if (text === null) continue
    for (const [, reference] of text.matchAll(RELATIVE_REFERENCE)) {
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), reference)
      )
      // Files outside scripts/ are inputs already unless OUTSIDE_BUILDS names them.
      if (target.startsWith('scripts/')) queue.push(target)
    }
  }
  return found
}

/**
 * Whether `project` builds from `file`, given the scripts its build reads.
 * @param {Project} project @param {string} file repository path
 * @param {ReadonlySet<string>} scripts scriptInputs for this project at the same commit
 */
export function isBuildInput(project, file, scripts) {
  const other = project === 'web' ? PROJECT_APPS.api : PROJECT_APPS.web
  const under = (dir) => file === dir || file.startsWith(`${dir}/`)
  if (OUTSIDE_BUILDS.some(under) || under(other)) return false
  if (under('scripts')) return scripts.has(file)
  return true
}

function git(args, cwd, options = {}) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
}

/** Why a git call failed, without a remote URL's credentials. */
export function failure(result) {
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

function assertProject(project) {
  if (!Object.hasOwn(PROJECT_APPS, project))
    throw new Error(`Unknown Vercel project ${JSON.stringify(project)}`)
}

/** Script text by blob id: a blob's content never changes, and walking history rereads it. */
const blobText = new Map()

/**
 * Every tracked file of `rev` that `project` builds from, as `ls-tree` lines (mode, type,
 * object and path), sorted by path.
 * @param {string} cwd @param {Project} project @param {string} rev
 * @returns {string[]}
 */
export function buildInputEntries(cwd, project, rev) {
  assertProject(project)
  const listed = git(['ls-tree', '-r', '-z', '--full-tree', rev], cwd)
  if (listed.status !== 0)
    throw new Error(`git ls-tree ${rev} failed (${failure(listed)})`)
  const entries = listed.stdout.split('\0').filter(Boolean)
  const blobs = new Map(
    entries.map((entry) => [entry.slice(entry.indexOf('\t') + 1), entry])
  )
  const read = (file) => {
    const entry = blobs.get(file)
    if (!entry) return null
    const object = entry.split('\t')[0].split(' ')[2]
    const cached = blobText.get(object)
    if (cached !== undefined) return cached
    const shown = git(['cat-file', 'blob', object], cwd)
    if (shown.status !== 0)
      throw new Error(`git cat-file ${object} failed (${failure(shown)})`)
    blobText.set(object, shown.stdout)
    return shown.stdout
  }
  const scripts = scriptInputs(BUILD_SCRIPTS[project], read)
  return entries.filter((entry) =>
    isBuildInput(project, entry.slice(entry.indexOf('\t') + 1), scripts)
  )
}

/**
 * The identity of a project's build inputs at `rev`: a hash over the path, mode and blob of
 * every file it builds from. Two commits with the same hash build the same source, whatever
 * their history.
 * @param {string} cwd @param {Project} project @param {string} [rev]
 */
export function inputsHashAt(cwd, project, rev = 'HEAD') {
  return createHash('sha256')
    .update(buildInputEntries(cwd, project, rev).join('\n'))
    .digest('hex')
}

/**
 * The tree of the checkout's tracked files as they stand, edits not yet committed included,
 * written through a throwaway index so the checkout and its own index stay untouched.
 * @param {string} cwd
 * @returns {string} the tree's object id
 */
export function workingTree(cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-build-inputs-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') }
  try {
    for (const args of [
      ['read-tree', 'HEAD'],
      ['add', '--update', '--', ':/'],
    ]) {
      const result = git(args, cwd, { env })
      if (result.status !== 0)
        throw new Error(`git ${args[0]} failed (${failure(result)})`)
    }
    const written = git(['write-tree'], cwd, { env })
    if (written.status !== 0)
      throw new Error(`git write-tree failed (${failure(written)})`)
    return written.stdout.trim()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The commits on `head`'s first-parent history, `head` first and at most `limit` of them, whose
 * `project` inputs equal `head`'s: any of them is a deployment of the source `head` builds.
 * Production E2E accepts each, since the ignored build step leaves the last built one serving.
 * @param {string} cwd @param {Project} project @param {string} head @param {number} [limit]
 * @returns {string[]}
 */
export function equivalentCommits(cwd, project, head, limit = 100) {
  const listed = git(['rev-list', '--first-parent', `--max-count=${limit}`, head], cwd)
  if (listed.status !== 0)
    throw new Error(`git rev-list ${head} failed (${failure(listed)})`)
  const commits = listed.stdout.split('\n').filter(Boolean)
  const target = inputsHashAt(cwd, project, commits[0])
  return commits.filter((commit) => inputsHashAt(cwd, project, commit) === target)
}

const SHA = /^[a-f0-9]{40}$/

/**
 * Fetches one commit, with its whole tree, from the repository Vercel names. The build clone
 * has no remote, and the repository is public.
 * @param {string} sha @param {NodeJS.ProcessEnv} env @param {string} cwd
 */
function fetchFromPublicRepository(sha, env, cwd) {
  const owner = env.VERCEL_GIT_REPO_OWNER?.trim()
  const slug = env.VERCEL_GIT_REPO_SLUG?.trim()
  if (!owner || !slug)
    return {
      status: 1,
      stderr: 'fatal: VERCEL_GIT_REPO_OWNER or VERCEL_GIT_REPO_SLUG is empty',
    }
  const url = `https://github.com/${owner}/${slug}.git`
  // No prompt can be answered here; a repository that asks for credentials fails at once.
  return git(['fetch', '--no-tags', '--depth=1', url, sha], cwd, {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

/**
 * Whether Vercel should build this deployment of `project`. Only a production build of main
 * is ever skipped, and only when its inputs equal those of the last successful production
 * deployment (VERCEL_GIT_PREVIOUS_SHA). A preview always builds: CI creates one only when the
 * preview checks need it (scripts/vercel-preview-deploy.mjs). A missing or malformed commit,
 * an unreachable one, or any git failure builds.
 * @param {string} project @param {NodeJS.ProcessEnv} env @param {string} [cwd]
 * @returns {{ build: boolean, reason: string }}
 */
export function buildDecision(project, env, cwd = repoRoot) {
  if (!Object.hasOwn(PROJECT_APPS, project))
    return { build: true, reason: `unknown project ${JSON.stringify(project ?? '')}` }
  if (env.VERCEL_ENV !== 'production')
    return {
      build: true,
      reason: `VERCEL_ENV is ${JSON.stringify(env.VERCEL_ENV ?? '')}; only a production build is ever skipped`,
    }
  const previous = env.VERCEL_GIT_PREVIOUS_SHA?.trim() ?? ''
  if (!SHA.test(previous))
    return {
      build: true,
      reason: previous
        ? `VERCEL_GIT_PREVIOUS_SHA ${JSON.stringify(previous)} is not a commit SHA`
        : 'no previous successful production deployment (VERCEL_GIT_PREVIOUS_SHA is empty)',
    }
  const head = env.VERCEL_GIT_COMMIT_SHA?.trim() || 'HEAD'
  if (git(['cat-file', '-e', `${previous}^{commit}`], cwd).status !== 0) {
    const fetched = fetchFromPublicRepository(previous, env, cwd)
    if (fetched.status !== 0)
      return { build: true, reason: `could not fetch ${previous} (${failure(fetched)})` }
  }
  try {
    const before = inputsHashAt(cwd, /** @type {Project} */ (project), previous)
    const after = inputsHashAt(cwd, /** @type {Project} */ (project), head)
    if (before === after)
      return {
        build: false,
        reason: `${project} inputs at ${head} equal those of ${previous}, the last successful production deployment`,
      }
    return {
      build: true,
      reason: describeChange(cwd, /** @type {Project} */ (project), previous, head),
    }
  } catch (error) {
    return {
      build: true,
      reason: `could not compare inputs (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

function describeChange(cwd, project, previous, head) {
  const before = new Set(buildInputEntries(cwd, project, previous))
  const after = new Set(buildInputEntries(cwd, project, head))
  const path = (entry) => entry.slice(entry.indexOf('\t') + 1)
  const changed = [
    ...new Set([
      ...[...after].filter((entry) => !before.has(entry)).map(path),
      ...[...before].filter((entry) => !after.has(entry)).map(path),
    ]),
  ].sort()
  const more = changed.length > 3 ? ` and ${changed.length - 3} more` : ''
  return `${project} inputs changed since ${previous}: ${changed.slice(0, 3).join(', ')}${more}`
}

function main(argv) {
  const [command, project, head] = argv
  if (command === 'ignore') {
    // Vercel's ignored build step: exit 0 skips the build, exit 1 builds.
    const decision = buildDecision(project, process.env)
    console.log(
      `${decision.build ? 'Building' : 'Skipping the build'}: ${decision.reason}`
    )
    // A preview with an earlier deployment also reports what a production build would decide,
    // so the comparison is seen working in Vercel's build clone before main relies on it.
    if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_PREVIOUS_SHA) {
      const rehearsal = buildDecision(project, {
        ...process.env,
        VERCEL_ENV: 'production',
      })
      console.log(
        `As a production build it would ${rehearsal.build ? 'build' : 'skip'}: ${rehearsal.reason}`
      )
    }
    return decision.build ? 1 : 0
  }
  if (command === 'equivalent' && head) {
    assertProject(project)
    const commits = equivalentCommits(repoRoot, /** @type {Project} */ (project), head)
    console.log(commits.join(' '))
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${project}=${commits.join(' ')}\n`)
    return 0
  }
  console.error(
    'usage: vercel-build-inputs.mjs ignore <web|api> | equivalent <web|api> <commit>'
  )
  return 2
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    // The ignored build step builds on any failure; elsewhere a failure fails the step.
    process.exitCode = 1
  }
}
