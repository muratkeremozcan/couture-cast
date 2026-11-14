#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 CX-10 clarification (TEA, 2026-11-13): device evidence counts for the PR's exact
// head when every input its leg reads is unchanged between the build commit and the head. Each
// artifact gets a manifest of the build SHA and, per input path, its `git rev-parse <sha>:<path>`
// object id. At the final head `verify` recomputes them and names every leg whose inputs changed;
// those legs rerun on the new head.
//
//   node scripts/lib/evidence-manifest.mjs write --leg live-font --out <file> [--rev HEAD]
//   node scripts/lib/evidence-manifest.mjs verify <manifest.json>... [--rev HEAD]
import { spawnSync } from 'node:child_process'
import fs, { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** What every app build reads: the app, its packages, the install and the root build config. */
export const APP_INPUTS = [
  'apps/mobile',
  'packages',
  'package.json',
  'package-lock.json',
  'patches',
  '.nvmrc',
  'tsconfig.base.json',
  'tsconfig.json',
  'babel.config.js',
  'metro.config.js',
  'app.json',
  'eas.json',
]
// Legs that boot the local API read the server and its schema. Every leg takes the whole maestro/
// tree (TEA, Antigravity r9: a false rerun is cheap, a false pass is not).
const SERVER_INPUTS = ['apps/api', 'packages/db', 'supabase']
const SHARED_INPUTS = [...APP_INPUTS, 'maestro']
// Data the story68 native harness reads: the native Supabase bootstrap and Maestro flow budgets.
const HARNESS_DATA = [
  'scripts/lib/fixtures',
  'scripts/ci/native-supabase-bootstrap.sql',
  'scripts/maestro-flow-durations.json',
]

/**
 * Each leg's inputs: paths (a directory counts as its tree), globs over tracked files (recursive:
 * `dir/prefix*` matches every tracked file under `dir` whose path there starts with `prefix`), and
 * harness entry files whose code closure is followed (relative imports and requires, and scripts
 * named by repository path, which a harness spawns). Data a harness reads by repository path is
 * listed here; evidence-manifest.test.mjs fails when a harness names one its leg does not cover.
 */
export const LEGS = {
  'live-font': {
    paths: [...SHARED_INPUTS, ...SERVER_INPUTS, ...HARNESS_DATA],
    globs: ['scripts/lib/live-font-*'],
    entries: ['scripts/run-live-font-proof.mjs', 'scripts/run-story68-native.mjs'],
  },
  'ios-build': {
    paths: [...SHARED_INPUTS, ...SERVER_INPUTS, ...HARNESS_DATA],
    globs: ['scripts/lib/story68-*'],
    entries: ['scripts/run-story68-native.mjs'],
  },
  'network-timeout': {
    paths: [...SHARED_INPUTS],
    globs: [],
    entries: ['scripts/ci/android-network-timeout.sh', 'scripts/lib/network-tarpit.mjs'],
  },
  'android-evidence': {
    paths: [...SHARED_INPUTS],
    globs: [],
    entries: [
      'scripts/lib/minified-debuggable-evidence.mjs',
      'scripts/ci/android-release-abis.mjs',
      'scripts/lib/cx06-reflection-mutant.mjs',
    ],
  },
  'test-store': {
    // The journey loads the manifest writer by URL, so it is recorded here as a path.
    paths: [
      ...SHARED_INPUTS,
      ...SERVER_INPUTS,
      ...HARNESS_DATA,
      'scripts/lib/evidence-manifest.mjs',
    ],
    globs: [],
    entries: [
      'scripts/run-story68-native.mjs',
      'scripts/lib/minified-debuggable-evidence.mjs',
      'scripts/run-test-store-journey.mjs',
      'scripts/test-store-preview-webhook.mjs',
    ],
  },
  upgrade: {
    paths: [...SHARED_INPUTS, ...SERVER_INPUTS, ...HARNESS_DATA],
    globs: [],
    entries: ['scripts/run-story68-native.mjs'],
  },
}

// A git call killed at its bound reads as a failed one (status null), the same as before.
const GIT_TIMEOUT_MS = 30_000

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  return { ok: result.status === 0, out: result.stdout.trim() }
}

/** The object id of `path` at `rev`, or null when the path does not exist there. */
export function objectId(rev, file, cwd) {
  const { ok, out } = git(['rev-parse', '--verify', '--quiet', `${rev}:${file}`], cwd)
  return ok ? out : null
}

/** The file at `rev`, or null. */
function show(rev, file, cwd) {
  const result = spawnSync('git', ['show', `${rev}:${file}`], {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  return result.status === 0 ? result.stdout : null
}

/** Relative `.mjs`/`.js` specifiers a module imports statically or dynamically with a literal. */
export function relativeImports(source) {
  const found = new Set()
  const patterns = [
    /\bimport\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /\bexport\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    // A relative require call, including a createRequire(import.meta.url) require. (Spelled out
    // here without a literal, so this file can sit in a leg's closure without naming a file.)
    /\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) found.add(match[1])
  return [...found]
}

/** Top-level repository directories a harness may name files in. */
const REPO_ROOTS = ['apps', 'packages', 'scripts', 'maestro', 'supabase', 'playwright']

/**
 * Repository paths a module names in string literals, whole ('scripts/lib/fixtures/x.json') or
 * up to a template placeholder (`maestro/live-font/${flow}.yaml` names maestro/live-font), and
 * root-relative path.join or path.resolve arguments (path.join(root, 'maestro', 'story65')).
 */
export function repoPathLiterals(source, { shell = false } = {}) {
  const roots = REPO_ROOTS.join('|')
  const found = new Set()
  // A shell script names paths bare: node scripts/lib/network-tarpit.mjs --port 4010.
  if (shell)
    for (const match of source.matchAll(
      new RegExp(`(?:^|[\\s=("'])((?:${roots})/[A-Za-z0-9_.@/-]*[A-Za-z0-9_.@-])`, 'gm')
    ))
      found.add(match[1])
  const literal = new RegExp(
    `['"\`]((?:${roots})/[A-Za-z0-9_.@/-]*?)/?(?=['"\`]|\\$\\{)`,
    'g'
  )
  for (const match of source.matchAll(literal)) if (match[1]) found.add(match[1])
  const joined = /path\.(?:join|resolve)\(\s*\w+\s*,((?:\s*['"][^'"]+['"]\s*,?)+)/g
  for (const match of source.matchAll(joined)) {
    const parts = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((part) => part[1])
    const joinedPath = path.posix.normalize(parts.join('/'))
    if (new RegExp(`^(?:${roots})/`).test(joinedPath)) found.add(joinedPath)
  }
  return [...found].sort()
}

/** Files a module at `file` names relative to itself: new URL('../x.json', import.meta.url). */
export function moduleRelativeLiterals(source, file) {
  const found = new Set()
  for (const match of source.matchAll(
    /new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g
  ))
    found.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])))
  // A URL to a directory (the repository root, for one) names no single input.
  return [...found].filter((named) => !named.endsWith('/') && named !== '.').sort()
}

const isScript = (file) => /\.(?:mjs|cjs|js|sh)$/.test(file)

/**
 * `entries` plus every script they reach at `rev`: relative imports and requires, and scripts
 * named by repository path, which a harness spawns (`node scripts/x.mjs`).
 */
export function importClosure(entries, rev, cwd) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    const source = show(rev, file, cwd)
    if (source === null) throw new Error(`evidence_manifest_entry_missing:${file}`)
    seen.add(file)
    for (const specifier of relativeImports(source)) {
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), specifier)
      )
      // Installed packages are pinned by package-lock.json, which every leg records.
      if (!target.split('/').includes('node_modules')) queue.push(target)
    }
    for (const named of repoPathLiterals(source, { shell: file.endsWith('.sh') }))
      if (
        named.startsWith('scripts/') &&
        isScript(named) &&
        show(rev, named, cwd) !== null
      )
        queue.push(named)
  }
  return [...seen].sort()
}

/** Tracked files at `rev` matching a `dir/prefix*` glob. */
function globFiles(glob, rev, cwd) {
  const dir = path.posix.dirname(glob)
  const prefix = path.posix.basename(glob).replace(/\*$/, '')
  const { out } = git(['ls-tree', '-r', '--name-only', rev, '--', `${dir}/`], cwd)
  return out
    .split('\n')
    .filter((file) => file && file.slice(dir.length + 1).startsWith(prefix))
}

/** Whether `file` lies inside one of `inputs`: equal to it, or under a directory input. */
export const covered = (file, inputs) =>
  inputs.some((input) => file === input || file.startsWith(`${input}/`))

/**
 * Repository paths the leg's harness names, that exist at `rev`, and that its inputs do not
 * cover, each with the file naming it. Empty for a complete leg.
 */
export function uncoveredReads(leg, rev = 'HEAD', cwd) {
  const sha = git(['rev-parse', rev], cwd).out
  const inputs = legInputs(leg, sha, cwd)
  const misses = []
  for (const file of importClosure(LEGS[leg].entries, sha, cwd)) {
    const source = show(sha, file, cwd)
    for (const named of [
      ...repoPathLiterals(source, { shell: file.endsWith('.sh') }),
      ...moduleRelativeLiterals(source, file),
    ])
      if (objectId(sha, named, cwd) !== null && !covered(named, inputs))
        misses.push(`${file} -> ${named}`)
  }
  return misses
}

/** Every input path of `leg` at `rev`, sorted. Absent optional paths are recorded as null. */
export function legInputs(leg, rev, cwd) {
  const spec = LEGS[leg]
  if (!spec) throw new Error(`evidence_manifest_unknown_leg:${leg}`)
  return [
    ...new Set([
      ...spec.paths,
      ...spec.globs.flatMap((glob) => globFiles(glob, rev, cwd)),
      ...importClosure(spec.entries, rev, cwd),
    ]),
  ].sort()
}

/**
 * Changed or untracked files under `paths` in the working tree. A device build compiles the
 * working tree, so an uncommitted edit in a leg's input would ship unrecorded (TEA, 2026-11-13).
 */
export function dirtyInputs(paths, cwd) {
  const present = paths.filter((file) => file)
  const { out } = git(
    ['status', '--porcelain', '--untracked-files=all', '--', ...present],
    cwd
  )
  return out.split('\n').filter(Boolean)
}

/**
 * The manifest of `leg` at `rev`. Writing one for a build (`requireClean`, the default) refuses
 * a working tree with any change or untracked file under the leg's inputs, and refuses a `rev`
 * other than the checked-out HEAD, since the build compiles what is checked out.
 */
export function writeManifest({ leg, rev = 'HEAD', cwd, requireClean = true }) {
  const sha = git(['rev-parse', rev], cwd).out
  if (requireClean) {
    const head = git(['rev-parse', 'HEAD'], cwd).out
    if (sha !== head) throw new Error(`evidence_manifest_rev_not_head:${sha}`)
    // The globs go in as pathspecs too, so an untracked file a glob would match is seen.
    const dirty = dirtyInputs([...legInputs(leg, sha, cwd), ...LEGS[leg].globs], cwd)
    if (dirty.length) throw new Error(`evidence_manifest_dirty_inputs:${dirty.join(';')}`)
  }
  return {
    leg,
    sha,
    inputs: Object.fromEntries(
      legInputs(leg, sha, cwd).map((file) => [file, objectId(sha, file, cwd)])
    ),
  }
}

/**
 * The inputs of `manifest` whose object ids differ at `rev`, plus files the leg reads at `rev`
 * that the manifest never recorded (a new harness import).
 */
export function changedInputs(manifest, { rev = 'HEAD', cwd, requireClean = true } = {}) {
  // Verify refuses what write refuses (Antigravity r9): dirty inputs or a rev other than HEAD.
  const now = writeManifest({ leg: manifest.leg, rev, cwd, requireClean })
  const paths = new Set([...Object.keys(manifest.inputs), ...Object.keys(now.inputs)])
  return [...paths]
    .filter((file) => manifest.inputs[file] !== now.inputs[file])
    .sort()
    .map((file) => ({
      path: file,
      built: manifest.inputs[file] ?? null,
      head: now.inputs[file] ?? null,
    }))
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  const flag = (name) => {
    const at = rest.indexOf(`--${name}`)
    return at < 0 ? undefined : rest[at + 1]
  }
  const rev = flag('rev') ?? 'HEAD'
  if (command === 'write') {
    const manifest = writeManifest({ leg: flag('leg'), rev })
    fs.writeFileSync(flag('out'), `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`evidence-manifest: ${manifest.leg} at ${manifest.sha}`)
  } else if (command === 'verify') {
    const files = rest.filter(
      (arg, index) => !arg.startsWith('--') && rest[index - 1] !== '--rev'
    )
    if (files.length === 0) {
      console.error(
        'usage: evidence-manifest.mjs verify <manifest.json>... [--rev <rev>]'
      )
      process.exit(2)
    }
    let stale = 0
    for (const file of files) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
      const changed = changedInputs(manifest, { rev })
      if (changed.length) {
        stale += 1
        console.log(
          `RERUN ${manifest.leg} (${file}): ${changed.map((c) => c.path).join(', ')}`
        )
      } else
        console.log(
          `OK ${manifest.leg} (${file}): inputs unchanged since ${manifest.sha}`
        )
    }
    process.exitCode = stale ? 1 : 0
  } else {
    console.error(
      'usage: evidence-manifest.mjs write --leg <leg> --out <file> | verify <file>...'
    )
    process.exitCode = 2
  }
}
