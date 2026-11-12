import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./verify-dependency-tree.mjs', import.meta.url))

test('the installed tree passes every native check', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('a tree without its native pieces fails, naming each, so the action installs', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tree-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'scripts/ci'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), '{}')
  copyFileSync(script, path.join(root, 'scripts/ci/verify-dependency-tree.mjs'))
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/ci/verify-dependency-tree.mjs')],
    {
      encoding: 'utf8',
    }
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
