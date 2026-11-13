// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  APP_INPUTS,
  LEGS,
  changedInputs,
  importClosure,
  legInputs,
  moduleRelativeLiterals,
  relativeImports,
  repoPathLiterals,
  uncoveredReads,
  writeManifest,
} from './evidence-manifest.mjs'

/** A throwaway repository holding the live-font leg's inputs. */
function fixtureRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-manifest-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const write = (file, text) => {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'user.name', 'fixture')
  write('apps/mobile/app.json', '{}')
  write('packages/utils/index.ts', 'export {}')
  write('package.json', '{}')
  write('package-lock.json', '{}')
  write('maestro/live-font/open-home.yaml', 'appId: x')
  write('maestro/story65/open-app.yaml', 'appId: x')
  write('scripts/lib/live-font-journey.mjs', "import { a } from './helper.mjs'\n")
  write('scripts/lib/helper.mjs', 'export const a = 1\n')
  write('scripts/run-live-font-proof.mjs', "import './lib/live-font-journey.mjs'\n")
  write('scripts/run-story68-native.mjs', '')
  const commit = (message) => {
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  return { dir, write, commit, git }
}

test('relativeImports reads static, side-effect, dynamic and re-export specifiers', () => {
  const source = [
    "import fs from 'node:fs'",
    "import { a } from './a.mjs'",
    "import './b.mjs'",
    "const c = await import('../c.mjs')",
    "export { d } from './d.mjs'",
  ].join('\n')
  assert.deepEqual(relativeImports(source).sort(), [
    '../c.mjs',
    './a.mjs',
    './b.mjs',
    './d.mjs',
  ])
})

test('a manifest records each input and verify finds nothing changed at the same tree', (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const manifest = writeManifest({ leg: 'live-font', cwd: repo.dir })
  assert.equal(manifest.leg, 'live-font')
  assert.match(manifest.sha, /^[0-9a-f]{40}$/)
  for (const file of [
    'apps/mobile',
    'packages',
    'scripts/lib/helper.mjs',
    'scripts/run-live-font-proof.mjs',
  ])
    assert.match(manifest.inputs[file], /^[0-9a-f]{40}$/, file)
  // Optional inputs this repository lacks are recorded as absent.
  assert.equal(manifest.inputs['.nvmrc'], null)
  // A docs-only commit changes no input.
  repo.write('docs/notes.md', 'notes')
  repo.commit('docs')
  assert.deepEqual(changedInputs(manifest, { cwd: repo.dir }), [])
})

test('verify names a changed app path, a changed harness import and a new harness import', (t) => {
  const repo = fixtureRepo(t)
  repo.commit('build')
  const manifest = writeManifest({ leg: 'live-font', cwd: repo.dir })
  repo.write('scripts/lib/helper.mjs', 'export const a = 2\n')
  repo.write('apps/mobile/app.json', '{"changed":true}')
  repo.write('scripts/lib/helper.mjs', "import './extra.mjs'\nexport const a = 2\n")
  repo.write('scripts/lib/extra.mjs', '')
  repo.write('.nvmrc', '22')
  repo.commit('change')
  assert.deepEqual(
    changedInputs(manifest, { cwd: repo.dir }).map((change) => change.path),
    ['.nvmrc', 'apps/mobile', 'scripts/lib/extra.mjs', 'scripts/lib/helper.mjs']
  )
})

test('imports into node_modules are left to package-lock.json', (t) => {
  const repo = fixtureRepo(t)
  repo.write('scripts/lib/helper.mjs', "import '../../node_modules/pkg/index.js'\n")
  const sha = repo.commit('installed import')
  assert.deepEqual(importClosure(['scripts/lib/helper.mjs'], sha, repo.dir), [
    'scripts/lib/helper.mjs',
  ])
})

// TEA, 2026-11-13: the build compiles the working tree, so a manifest refuses uncommitted or
// untracked input files, and a revision other than the checked-out HEAD.
test('writing a manifest refuses a dirty or untracked input and a non-HEAD revision', (t) => {
  const repo = fixtureRepo(t)
  const first = repo.commit('build')
  repo.write('apps/mobile/app.json', '{"edited":true}')
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:.*apps\/mobile\/app\.json/,
  })
  repo.commit('edit')
  repo.write('scripts/lib/new-helper.mjs', '')
  repo.write('scripts/lib/helper.mjs', "import './new-helper.mjs'\nexport const a = 1\n")
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:/,
  })
  repo.commit('import')
  // An untracked file inside an input directory counts too.
  repo.write('packages/utils/stray.ts', 'export {}')
  assert.throws(() => writeManifest({ leg: 'live-font', cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:.*packages\/utils\/stray\.ts/,
  })
  repo.commit('stray')
  // A change outside the inputs is fine; an older revision is refused.
  repo.write('docs/notes.md', 'notes')
  assert.equal(writeManifest({ leg: 'live-font', cwd: repo.dir }).leg, 'live-font')
  assert.throws(() => writeManifest({ leg: 'live-font', rev: first, cwd: repo.dir }), {
    message: `evidence_manifest_rev_not_head:${first}`,
  })
})

test('a missing harness entry fails loudly', (t) => {
  const repo = fixtureRepo(t)
  repo.write('scripts/lib/helper.mjs', "import './gone.mjs'\n")
  const sha = repo.commit('broken')
  assert.throws(() => importClosure(['scripts/lib/helper.mjs'], sha, repo.dir), {
    message: 'evidence_manifest_entry_missing:scripts/lib/gone.mjs',
  })
})

test('every leg resolves on this repository and covers the app inputs', () => {
  for (const leg of Object.keys(LEGS)) {
    const manifest = writeManifest({ leg, requireClean: false })
    for (const file of ['apps/mobile', 'packages', 'package.json', 'package-lock.json'])
      assert.match(manifest.inputs[file], /^[0-9a-f]{40}$/, `${leg}: ${file}`)
    assert.ok(
      APP_INPUTS.every((file) => file in manifest.inputs),
      leg
    )
  }
  const server = writeManifest({ leg: 'test-store', requireClean: false }).inputs
  assert.match(server['apps/api'], /^[0-9a-f]{40}$/)
  assert.match(server['packages/db'], /^[0-9a-f]{40}$/)
  const liveFont = writeManifest({ leg: 'live-font', requireClean: false }).inputs
  assert.ok('scripts/lib/live-font-scale-proof.mjs' in liveFont)
  assert.ok('scripts/lib/live-font-capture.mjs' in liveFont)
})

// Antigravity r9 (P2-1): every leg covers every repository path its harness names, so evidence
// can never match a head whose harness data changed.
test('no harness reads a repository path outside its leg inputs', () => {
  for (const leg of Object.keys(LEGS)) assert.deepEqual(uncoveredReads(leg), [], leg)
})

test('every leg takes the whole maestro tree; legs that boot the API take the server', () => {
  for (const leg of Object.keys(LEGS)) assert.ok(LEGS[leg].paths.includes('maestro'), leg)
  for (const leg of ['live-font', 'ios-build', 'test-store', 'upgrade'])
    for (const input of ['apps/api', 'packages/db', 'supabase'])
      assert.ok(LEGS[leg].paths.includes(input), `${leg}: ${input}`)
  assert.ok(LEGS['live-font'].paths.includes('scripts/lib/fixtures'))
})

test('repository path literals, root joins and module-relative URLs are found', () => {
  const source = [
    "const a = path.join(root, 'scripts/lib/fixtures/live-font-residual-baselines.json')",
    "run('maestro', [path.join(root, 'maestro/live-font', `${flow}.yaml`)])",
    "const b = path.resolve(root, 'maestro', 'subflows', 'open.yaml')",
    'const c = `maestro/story68/${name}.yaml`',
    "spawn('node', ['scripts/ci/native-supabase.mjs'])",
    "const d = '_bmad-output/test-artifacts/runs'",
  ].join('\n')
  assert.deepEqual(repoPathLiterals(source), [
    'maestro/live-font',
    'maestro/story68',
    'maestro/subflows/open.yaml',
    'scripts/ci/native-supabase.mjs',
    'scripts/lib/fixtures/live-font-residual-baselines.json',
  ])
  assert.deepEqual(
    moduleRelativeLiterals(
      "new URL('./fixtures/x.json', import.meta.url); new URL('../../', import.meta.url)",
      'scripts/lib/y.mjs'
    ),
    ['scripts/lib/fixtures/x.json']
  )
  assert.deepEqual(
    relativeImports(
      "const r = createRequire(import.meta.url); r('./x.cjs'); require('../y.js')"
    ),
    ['../y.js']
  )
})

test('the closure follows requires and scripts a harness spawns by path; globs recurse', (t) => {
  const repo = fixtureRepo(t)
  repo.write(
    'scripts/run-live-font-proof.mjs',
    "import './lib/live-font-journey.mjs'\nspawn('node', ['scripts/spawned.mjs'])\n"
  )
  repo.write('scripts/spawned.mjs', "require('./lib/required.cjs')\n")
  repo.write('scripts/lib/required.cjs', '')
  repo.write('scripts/lib/live-font-nested/deep.json', '{}')
  const sha = repo.commit('closure')
  const inputs = legInputs('live-font', sha, repo.dir)
  for (const file of [
    'scripts/spawned.mjs',
    'scripts/lib/required.cjs',
    'scripts/lib/live-font-nested/deep.json',
  ])
    assert.ok(inputs.includes(file), file)
})

// Antigravity r9 (P2-2): verify refuses what write refuses.
test('verify refuses a dirty input tree and a rev other than HEAD', (t) => {
  const repo = fixtureRepo(t)
  const first = repo.commit('build')
  const manifest = writeManifest({ leg: 'live-font', cwd: repo.dir })
  repo.write('scripts/lib/helper.mjs', 'export const a = 3\n')
  assert.throws(() => changedInputs(manifest, { cwd: repo.dir }), {
    message: /^evidence_manifest_dirty_inputs:/,
  })
  repo.commit('change')
  assert.throws(() => changedInputs(manifest, { rev: first, cwd: repo.dir }), {
    message: `evidence_manifest_rev_not_head:${first}`,
  })
  assert.deepEqual(
    changedInputs(manifest, { cwd: repo.dir }).map((change) => change.path),
    ['scripts/lib/helper.mjs']
  )
})
