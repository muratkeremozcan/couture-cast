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
const SERVER_INPUTS = ['apps/api', 'packages/db']

/**
 * Each leg's inputs: paths (a directory counts as its tree), globs over tracked files, and
 * harness entry files whose relative imports are followed.
 */
export const LEGS = {
  'live-font': {
    paths: [...APP_INPUTS, 'maestro/live-font', 'maestro/story65'],
    globs: ['scripts/lib/live-font-*'],
    entries: ['scripts/run-live-font-proof.mjs'],
  },
  'ios-build': {
    paths: [...APP_INPUTS],
    globs: ['scripts/lib/story68-*'],
    entries: ['scripts/run-story68-native.mjs'],
  },
  'network-timeout': {
    paths: [
      ...APP_INPUTS,
      'maestro/network-timeout',
      'scripts/ci/android-network-timeout.sh',
    ],
    globs: [],
    entries: ['scripts/lib/network-tarpit.mjs'],
  },
  'android-evidence': {
    paths: [...APP_INPUTS],
    globs: [],
    entries: [
      'scripts/lib/minified-debuggable-evidence.mjs',
      'scripts/ci/android-release-abis.mjs',
      'scripts/lib/cx06-reflection-mutant.mjs',
    ],
  },
  'test-store': {
    paths: [...APP_INPUTS, ...SERVER_INPUTS, 'maestro'],
    globs: [],
    entries: [],
  },
  upgrade: {
    paths: [...APP_INPUTS, ...SERVER_INPUTS, 'maestro/story65'],
    globs: [],
    entries: [],
  },
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: result.status === 0, out: result.stdout.trim() }
}

/** The object id of `path` at `rev`, or null when the path does not exist there. */
export function objectId(rev, file, cwd) {
  const { ok, out } = git(['rev-parse', '--verify', '--quiet', `${rev}:${file}`], cwd)
  return ok ? out : null
}

/** The file at `rev`, or null. */
function show(rev, file, cwd) {
  const result = spawnSync('git', ['show', `${rev}:${file}`], { cwd, encoding: 'utf8' })
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
  ]
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) found.add(match[1])
  return [...found]
}

/** `entries` plus every file they reach through relative imports, at `rev`. */
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
  }
  return [...seen].sort()
}

/** Tracked files at `rev` matching a `dir/prefix*` glob. */
function globFiles(glob, rev, cwd) {
  const dir = path.posix.dirname(glob)
  const prefix = path.posix.basename(glob).replace(/\*$/, '')
  const { out } = git(['ls-tree', '--name-only', `${rev}:${dir}`], cwd)
  return out
    .split('\n')
    .filter((name) => name && name.startsWith(prefix))
    .map((name) => `${dir}/${name}`)
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

export function writeManifest({ leg, rev = 'HEAD', cwd }) {
  const sha = git(['rev-parse', rev], cwd).out
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
export function changedInputs(manifest, { rev = 'HEAD', cwd } = {}) {
  const now = writeManifest({ leg: manifest.leg, rev, cwd })
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
