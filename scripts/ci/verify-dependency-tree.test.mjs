import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { treeProblems } from './verify-dependency-tree.mjs'

const script = fileURLToPath(new URL('./verify-dependency-tree.mjs', import.meta.url))

test('the installed tree is the lockfile tree and passes every native check', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

/** A repository whose lockfile pins a, b@2, an optional c for another platform, a link. */
function tree(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tree-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), JSON.stringify(value))
  }
  const locked = {
    '': { name: 'repo' },
    'node_modules/a': { version: '1.0.0' },
    'node_modules/b': { version: '2.0.0' },
    'node_modules/c-other-platform': { version: '1.0.0', optional: true },
    'node_modules/@couture/utils': { resolved: 'packages/utils', link: true },
  }
  write('package-lock.json', { packages: locked })
  const installed = Object.fromEntries(
    Object.entries(locked).filter(([key, entry]) => key !== '' && !entry.optional)
  )
  write('node_modules/.package-lock.json', { packages: installed })
  write('node_modules/a/package.json', { version: '1.0.0' })
  write('node_modules/b/package.json', { version: '2.0.0' })
  write('node_modules/@couture/utils/package.json', { version: '0.0.1' })
  return { root, write, installed }
}

test('a tree that matches the lockfile has no problems', (t) => {
  assert.deepEqual(treeProblems(tree(t).root), [])
})

test('a dependency deleted from disk fails, though npm recorded it (Codex review of PR 211)', (t) => {
  const { root } = tree(t)
  rmSync(path.join(root, 'node_modules/b'), { recursive: true })
  assert.deepEqual(treeProblems(root), ['node_modules/b is recorded but missing on disk'])
})

test('a missing, mismatched or extra package fails; an absent optional one does not', (t) => {
  const { root, write, installed } = tree(t)
  const withoutA = Object.fromEntries(
    Object.entries(installed).filter(([key]) => key !== 'node_modules/a')
  )
  write('node_modules/.package-lock.json', {
    packages: {
      ...withoutA,
      'node_modules/b': { version: '2.1.0' },
      'node_modules/extra': { version: '1.0.0' },
    },
  })
  write('node_modules/b/package.json', { version: '2.1.0' })
  write('node_modules/extra/package.json', { version: '1.0.0' })
  assert.deepEqual(treeProblems(root).sort(), [
    'node_modules/a is not installed',
    'node_modules/b is 2.1.0, the lockfile pins 2.0.0',
    'node_modules/extra is installed but not in the lockfile',
  ])
})

test('a tree without its native pieces fails, naming each, so the action installs', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tree-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'scripts/ci'), { recursive: true })
  mkdirSync(path.join(root, 'node_modules'))
  writeFileSync(path.join(root, 'package.json'), '{}')
  writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}')
  writeFileSync(path.join(root, 'node_modules/.package-lock.json'), '{"packages":{}}')
  copyFileSync(script, path.join(root, 'scripts/ci/verify-dependency-tree.mjs'))
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/ci/verify-dependency-tree.mjs')],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  for (const name of [
    'esbuild',
    'sharp',
    'lightningcss',
    'prisma engines',
    'supabase CLI',
  ])
    assert.match(result.stdout, new RegExp(`${name}: `))
})
