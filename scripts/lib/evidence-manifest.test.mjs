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
  relativeImports,
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
    const manifest = writeManifest({ leg })
    for (const file of ['apps/mobile', 'packages', 'package.json', 'package-lock.json'])
      assert.match(manifest.inputs[file], /^[0-9a-f]{40}$/, `${leg}: ${file}`)
    assert.ok(
      APP_INPUTS.every((file) => file in manifest.inputs),
      leg
    )
  }
  const server = writeManifest({ leg: 'test-store' }).inputs
  assert.match(server['apps/api'], /^[0-9a-f]{40}$/)
  assert.match(server['packages/db'], /^[0-9a-f]{40}$/)
  const liveFont = writeManifest({ leg: 'live-font' }).inputs
  assert.ok('scripts/lib/live-font-scale-proof.mjs' in liveFont)
  assert.ok('scripts/lib/live-font-capture.mjs' in liveFont)
})
