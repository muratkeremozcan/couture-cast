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
 * The scripts each project's build runs: each package's build-workspace-package.mjs (web's
 * prebuild and the API build), and for the API the root preinstall check-node-version.mjs (its
 * install runs lifecycle scripts; web's passes --ignore-scripts) and the build command's
 * prisma-migrate-deploy.mjs (Vercel project settings, mirrored by `vercel:build` in apps/api's
 * package.json). scripts/vercel-build-inputs.test.mjs resolves both commands through every npm
 * hook to keep this list exact. What these import or name by path is an input too
 * (scriptInputs). Every other file under scripts/ is CI and test
 * tooling no build reads, and changes to it used to rebuild both projects: from 2026-11-13 to
 * 2026-11-16, 27 of 40 API and 15 of 28 web preview rebuilds on a branch that already had one
 * changed no build input outside scripts/.
 */
export const BUILD_SCRIPTS = {
  web: ['scripts/build-workspace-package.mjs'],
  api: [
    'scripts/check-node-version.mjs',
    'scripts/build-workspace-package.mjs',
    'scripts/prisma-migrate-deploy.mjs',
  ],
}

/**
 * This file, which the ignored build step runs before every build: an input of both projects,
 * so a change to the map rebuilds them. It is not scanned, since it names every project's
 * scripts and runs none of them.
 */
export const IGNORE_STEP = 'scripts/vercel-build-inputs.mjs'

/**
 * Relative references in a script: import, export from, import(), require(), and any other
 * quoted path that starts with ./ or ../ (a file a script reads or spawns by path).
 */
const RELATIVE_REFERENCE = /['"`](\.{1,2}\/[^'"`\s]+)['"`]/g

/** A quoted path from the repository root, as a script run with `cwd: repoRoot` names one. */
const ROOT_REFERENCE = /['"`](scripts\/[^'"`\s]+)['"`]/g

/**
 * The scripts `entries` load, closed over the references their code makes into scripts/, by a
 * path relative to the script or to the repository root. Comment lines are skipped: they name
 * scripts the build never runs. A reference to a file that does not exist stays in the set, so
 * adding that file later changes the inputs.
 * @param {readonly string[]} entries repository paths
 * @param {(file: string) => string | null} read a file's text, or null when it is absent
 * @returns {Set<string>}
 */
/** A script's text without its comment lines (`//`, `/*` and the ` * ` of a block). */
function codeLines(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

export function scriptInputs(entries, read) {
  const found = new Set()
  const queue = [...entries]
  while (queue.length) {
    const file = /** @type {string} */ (queue.pop())
    if (found.has(file)) continue
    found.add(file)
    const source = read(file)
    if (source === null) continue
    const text = codeLines(source)
    for (const [, reference] of text.matchAll(ROOT_REFERENCE))
      queue.push(path.posix.normalize(reference))
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
  if (under('scripts')) return file === IGNORE_STEP || scripts.has(file)
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
 * The tree of the checkout's tracked files as they stand, staged and unstaged edits, staged
 * additions and deletions included, written through a copy of its index so the checkout and its
 * own index stay untouched.
 * @param {string} cwd
 * @returns {string} the tree's object id
 */
export function workingTree(cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-build-inputs-'))
  const index = path.join(dir, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    const own = git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], cwd)
    if (own.status !== 0) throw new Error(`git rev-parse failed (${failure(own)})`)
    // The checkout's own index holds what is staged, new files included; with none, HEAD.
    const steps = fs.existsSync(own.stdout.trim())
      ? [['add', '--update', '--', ':/']]
      : [
          ['read-tree', 'HEAD'],
          ['add', '--update', '--', ':/'],
        ]
    if (fs.existsSync(own.stdout.trim())) fs.copyFileSync(own.stdout.trim(), index)
    for (const args of steps) {
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

/** A full commit SHA, the only revision these accept from outside. */
const SHA = /^[a-f0-9]{40}$/

/**
 * The commits on `head`'s whole first-parent history, `head` first, whose `project` inputs equal
 * `head`'s: any of them is a deployment of the source `head` builds. The walk has no limit:
 * production keeps serving its last build through any number of merges that change nothing it
 * builds (263 commits on main took 11 s on 2026-11-16).
 * Production E2E accepts each, since the ignored build step leaves the last built one serving.
 * The list skips over commits with other inputs: when a build failed, the deployment before it
 * keeps serving, and a later commit that reverts to its source is skipped against it.
 * @param {string} cwd @param {Project} project @param {string} head
 * @returns {string[]}
 */
export function equivalentCommits(cwd, project, head) {
  if (!SHA.test(head)) throw new Error(`${JSON.stringify(head)} is not a commit SHA`)
  // A shallow clone would cut the walk short and turn away the commit still serving.
  const shallow = git(['rev-parse', '--is-shallow-repository'], cwd)
  if (shallow.stdout?.trim() !== 'false')
    throw new Error('equivalentCommits needs the whole history (checkout fetch-depth: 0)')
  const listed = git(['rev-list', '--first-parent', head], cwd)
  if (listed.status !== 0)
    throw new Error(`git rev-list ${head} failed (${failure(listed)})`)
  const commits = listed.stdout.split('\n').filter(Boolean)
  const target = inputsHashAt(cwd, project, commits[0])
  return commits.filter((commit) => inputsHashAt(cwd, project, commit) === target)
}

/** A GitHub owner or repository name: letters, digits, `-`, `_` and `.`, never `..`. */
const GITHUB_NAME = /^(?!\.\.?$)[A-Za-z0-9_.-]+$/

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
  if (![owner, slug].every((name) => GITHUB_NAME.test(name)))
    return {
      status: 1,
      stderr:
        'fatal: VERCEL_GIT_REPO_OWNER or VERCEL_GIT_REPO_SLUG is not a GitHub owner or repository name',
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
 * preview checks need it (scripts/vercel-preview-deploy.mjs). A redeploy of the deployed commit
 * always builds, so a changed environment variable or build setting takes effect through
 * Redeploy. A missing or malformed commit, an unreachable one, or any git failure builds.
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
  const commits = productionCommits(env, cwd)
  if ('reason' in commits) return { build: true, reason: commits.reason }
  const { previous, head } = commits
  return compareInputs(/** @type {Project} */ (project), previous, head, cwd)
}

/**
 * The deployed commit and the one under test, or why the build cannot be skipped: a missing or
 * malformed commit, a redeploy of the deployed commit, or a previous commit the clone cannot
 * fetch.
 * @param {NodeJS.ProcessEnv} env @param {string} cwd
 * @returns {{ previous: string, head: string } | { reason: string }}
 */
function productionCommits(env, cwd) {
  const previous = env.VERCEL_GIT_PREVIOUS_SHA?.trim() ?? ''
  if (!SHA.test(previous))
    return {
      reason: previous
        ? `VERCEL_GIT_PREVIOUS_SHA ${JSON.stringify(previous)} is not a commit SHA`
        : 'no previous successful production deployment (VERCEL_GIT_PREVIOUS_SHA is empty)',
    }
  const head = env.VERCEL_GIT_COMMIT_SHA?.trim() || 'HEAD'
  if (head !== 'HEAD' && !SHA.test(head))
    return { reason: `VERCEL_GIT_COMMIT_SHA ${JSON.stringify(head)} is not a commit SHA` }
  // A redeploy of the deployed commit is how a changed environment variable or build setting
  // reaches production: the source is the same, so only this rule lets it build.
  const resolved = git(['rev-parse', '--verify', `${head}^{commit}`], cwd).stdout?.trim()
  if (resolved === previous)
    return {
      reason: `${previous} is the last successful production deployment, so this is a redeploy, which always builds`,
    }
  if (git(['cat-file', '-e', `${previous}^{commit}`], cwd).status !== 0) {
    const fetched = fetchFromPublicRepository(previous, env, cwd)
    if (fetched.status !== 0)
      return { reason: `could not fetch ${previous} (${failure(fetched)})` }
  }
  return { previous, head }
}

/**
 * @param {Project} project @param {string} previous @param {string} head @param {string} cwd
 * @returns {{ build: boolean, reason: string }}
 */
function compareInputs(project, previous, head, cwd) {
  try {
    if (inputsHashAt(cwd, project, previous) === inputsHashAt(cwd, project, head))
      return {
        build: false,
        reason: `${project} inputs at ${head} equal those of ${previous}, the last successful production deployment`,
      }
    return { build: true, reason: describeChange(cwd, project, previous, head) }
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
