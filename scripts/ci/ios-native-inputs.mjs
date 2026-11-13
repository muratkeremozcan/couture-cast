#!/usr/bin/env node
// Story 6.15 D6 and SL-11: which changes are native iOS changes, the ones ios-native.yml must test
// before they merge (scripts/ci/ios-native-evidence.mjs) and after (its push trigger). The list is
// the push paths of ios-native.yml. Two of them are shared with every workspace, so a path match
// alone would send a web-only or API-only dependency bump through a 75-minute iOS run:
//
//   package-lock.json  counts only when an entry it changed is one apps/mobile installs, which the
//                      lockfile alone tells: the mobile workspace, everything it resolves, and the
//                      workspaces it links, with their own dependencies.
//   package.json       counts only when the root fields every install reads changed (workspaces,
//                      overrides, engines, packageManager) or a root script ios-native.yml runs.
//
// A file whose before or after content cannot be read counts, so an unknown never skips iOS.
//
//   push-changes  (ios-changes job) writes run=true unless a merge to main changed no native iOS
//                 input; every dispatch and nightly run tests its commit.
//
// It imports Node built-ins and the lane map, which imports Node built-ins only, so it runs from a
// sparse checkout with no install.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { matchesAny } from './lanes.mjs'

export const IOS_NATIVE_WORKFLOW = '.github/workflows/ios-native.yml'
// The jobs both iOS workflows call, whose root npm scripts an iOS run executes.
export const IOS_JOBS_WORKFLOW = '.github/workflows/ios-native-jobs.yml'
export const LOCKFILE = 'package-lock.json'
export const ROOT_MANIFEST = 'package.json'
export const MOBILE_WORKSPACE = 'apps/mobile'
export const ROOT_FIELDS = ['workspaces', 'overrides', 'engines', 'packageManager']
const COMMIT = /^[0-9a-f]{40}$/

/**
 * The push paths of ios-native.yml, read without a YAML parser: they are the native iOS inputs,
 * and a merge to main runs the workflow when one of them changes.
 */
export function pushPaths(text) {
  const lines = text.split('\n')
  const push = lines.findIndex((line) => line === '  push:')
  const start = lines.findIndex((line, index) => index > push && line === '    paths:')
  if (push < 0 || start < 0) throw new Error('ios-native.yml has no push paths')
  const paths = []
  for (const line of lines.slice(start + 1)) {
    const match = /^ {6}- '([^']+)'$/.exec(line)
    if (!match) break
    paths.push(match[1])
  }
  if (paths.length === 0) throw new Error('ios-native.yml has no push paths')
  return paths
}

/** Where `name` resolves from the package at lockfile key `from`, by Node's lookup. */
function resolvePackage(packages, from, name) {
  let base = from
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
    if (candidate in packages) return candidate
    if (!base) return null
    const index = base.lastIndexOf('/node_modules/')
    base = index === -1 ? '' : base.slice(0, index)
  }
}

/** The names a lockfile entry depends on; a workspace's development dependencies install too. */
function dependencyNames(key, entry) {
  const workspace = !key.startsWith('node_modules/') && !key.includes('/node_modules/')
  return new Set([
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}),
    ...(workspace ? Object.keys(entry.devDependencies ?? {}) : []),
  ])
}

/**
 * The lockfile keys apps/mobile installs: the workspace, every package it resolves, and every
 * workspace it links, each workspace with its development dependencies too. Null when the
 * lockfile is not one this can read.
 */
export function mobileClosure(lock) {
  const packages = lock?.packages
  if (!packages || typeof packages !== 'object' || !packages[MOBILE_WORKSPACE])
    return null
  const seen = new Set()
  const stack = [MOBILE_WORKSPACE]
  while (stack.length) {
    const key = stack.pop()
    if (seen.has(key)) continue
    seen.add(key)
    const entry = packages[key] ?? {}
    if (entry.link && typeof entry.resolved === 'string') {
      stack.push(entry.resolved)
      continue
    }
    for (const name of dependencyNames(key, entry)) {
      const found = resolvePackage(packages, key, name)
      if (found) stack.push(found)
    }
  }
  return seen
}

/** The changed lockfile entries apps/mobile installs before or after; null when unreadable. */
export function mobileLockChanges(before, after) {
  const was = mobileClosure(before)
  const now = mobileClosure(after)
  if (!was || !now) return null
  const keys = new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])
  return [...keys]
    .filter(
      (key) =>
        (was.has(key) || now.has(key)) &&
        JSON.stringify(before.packages[key]) !== JSON.stringify(after.packages[key])
    )
    .sort()
}

/** The root scripts ios-native.yml runs, and the root scripts those run in turn. */
export function rootScriptsRun(jobsText, manifest) {
  const runs = (text) =>
    [...String(text).matchAll(/\bnpm run ([\w:.-]+)([^\n&|;]*)/g)]
      .filter((match) => !/(?:^|\s)(--workspace|-w)\b/.test(match[2]))
      .map((match) => match[1])
  const names = new Set()
  const stack = runs(jobsText)
  while (stack.length) {
    const name = stack.pop()
    if (names.has(name)) continue
    names.add(name)
    stack.push(...runs(manifest?.scripts?.[name] ?? ''))
  }
  return [...names].sort()
}

/** What changed in the root manifest that an iOS run reads; null when unreadable. */
export function rootManifestChanges(before, after, jobsText) {
  if (!before || !after) return null
  const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
  const fields = ROOT_FIELDS.filter((field) => differs(before[field], after[field]))
  const scripts = [
    ...new Set([...rootScriptsRun(jobsText, before), ...rootScriptsRun(jobsText, after)]),
  ]
    .filter((name) => differs(before.scripts?.[name], after.scripts?.[name]))
    .map((name) => `scripts.${name}`)
  return [...fields, ...scripts]
}

const parseJson = (text) => {
  try {
    return text == null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Whether each shared dependency file changed something an iOS run installs or runs, from its
 * content before and after: `{ 'package-lock.json': boolean, 'package.json': boolean }`.
 * `read(side, file)` returns the text, or null when the file is missing or unreadable.
 */
export async function dependencyChanges(read, jobsText) {
  const [lockBefore, lockAfter, rootBefore, rootAfter] = await Promise.all([
    read('before', LOCKFILE),
    read('after', LOCKFILE),
    read('before', ROOT_MANIFEST),
    read('after', ROOT_MANIFEST),
  ])
  const lock = mobileLockChanges(parseJson(lockBefore), parseJson(lockAfter))
  const root = rootManifestChanges(parseJson(rootBefore), parseJson(rootAfter), jobsText)
  return {
    [LOCKFILE]: lock === null || lock.length > 0,
    [ROOT_MANIFEST]: root === null || root.length > 0,
  }
}

/**
 * The changed paths, old paths of renames included, that ios-native.yml builds, runs or reads.
 * `dependencies` says whether each shared dependency file changed what iOS installs; a file it
 * does not answer for counts on its path alone.
 */
export function nativeIosChanges(files, inputs, dependencies = {}) {
  return files
    .flatMap((file) =>
      typeof file === 'string' ? [file] : [file.filename, file.previous_filename]
    )
    .filter(Boolean)
    .filter((name) => matchesAny(name, inputs) && dependencies[name] !== false)
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/** The ios-changes job: run=true unless a merge to main changed no native iOS input. */
export async function pushChanges({ env = process.env, run = git } = {}) {
  const decide = (answer, why) => {
    console.log(why)
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run=${answer}\n`)
    return answer
  }
  if (env.EVENT !== 'push') return decide(true, `A ${env.EVENT} run tests its commit.`)
  const before = env.BEFORE ?? ''
  if (!COMMIT.test(before) || /^0+$/.test(before))
    return decide(
      true,
      `No earlier commit to compare (${before || 'none'}); run everything.`
    )
  try {
    run(['fetch', '--no-tags', '--depth=1', 'origin', before])
    const files = run(['diff', '--name-only', '--no-renames', before, 'HEAD'])
      .split('\n')
      .filter(Boolean)
    const inputs = pushPaths(readFileSync(IOS_NATIVE_WORKFLOW, 'utf8'))
    const show = (side, file) => {
      try {
        return run(['show', `${side === 'before' ? before : 'HEAD'}:${file}`])
      } catch {
        return null
      }
    }
    const dependencies = await dependencyChanges(
      show,
      readFileSync(IOS_JOBS_WORKFLOW, 'utf8')
    )
    const changed = nativeIosChanges(files, inputs, dependencies)
    return changed.length
      ? decide(true, `Native iOS inputs changed: ${changed.join(', ')}`)
      : decide(false, 'No native iOS input changed; the nightly run covers the rest.')
  } catch (error) {
    return decide(
      true,
      `Could not compare with ${before} (${error.message}); run everything.`
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  if (process.argv[2] === 'push-changes') await pushChanges()
  else {
    console.error('usage: ios-native-inputs.mjs push-changes')
    process.exitCode = 2
  }
}
