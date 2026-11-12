// Story 6.14 follow-up: every job restores the dependency tree its lockfile pins, whole, or
// installs and saves it. About 30 jobs a push each spent 50 to 85 s installing it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const read = (file) =>
  parse(readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8'))
const action = read('.github/actions/node-dependencies/action.yml')
const step = (name) => {
  const found = action.runs.steps.find((candidate) => candidate.name === name)
  assert.ok(found, name)
  return found
}
const TREE = ['node_modules', 'apps/*/node_modules', 'packages/*/node_modules']

test('the tree is keyed on exactly what decides it, and only an exact key restores it', () => {
  const restore = step('Restore the dependency tree for this lockfile')
  assert.equal(restore.uses, 'actions/cache/restore@v4')
  assert.equal(
    restore.with.key,
    "node-modules-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles(inputs.node-version-file, '.npmrc', 'package-lock.json', 'package.json', 'apps/*/package.json', 'packages/*/package.json') }}"
  )
  assert.equal(restore.with['restore-keys'], undefined)
  assert.deepEqual(restore.with.path.trim().split('\n'), TREE)
  // A custom command may build another tree.
  assert.equal(
    restore.if,
    // Linux only (about 1 GB compressed of the 10 GB cache); a custom command may build
    // another tree.
    "runner.os == 'Linux' && (inputs.install-command == 'npm ci' || inputs.install-command == 'npm install')"
  )
})

test('a hit skips the install; a miss installs and saves before any later step', () => {
  const steps = action.runs.steps.map((candidate) => candidate.name)
  assert.deepEqual(steps, [
    'Restore the dependency tree for this lockfile',
    'Setup Node',
    'Verify the restored dependency tree',
    'Install dependencies',
    'Save the dependency tree for this lockfile',
  ])
  assert.equal(step('Install dependencies').if, "steps.verify.outputs.works != 'true'")
  // A hit whose native pieces fail on this runner installs too.
  const verify = step('Verify the restored dependency tree')
  assert.equal(verify.if, "steps.modules.outputs.cache-hit == 'true'")
  assert.match(verify.run, /if node scripts\/ci\/verify-dependency-tree\.mjs; then/)
  assert.equal(verify['continue-on-error'], undefined)
  const save = step('Save the dependency tree for this lockfile')
  assert.equal(save.uses, 'actions/cache/save@v4')
  assert.deepEqual(save.with.path.trim().split('\n'), TREE)
  assert.equal(save.with.key, '${{ steps.modules.outputs.cache-primary-key }}')
  // Only a fresh install, only of a custom-free command, and only if the lockfile is
  // still the one the key names.
  assert.match(save.if, /steps\.modules\.outcome == 'success'/)
  assert.match(save.if, /steps\.modules\.outputs\.cache-hit != 'true'/)
  assert.match(
    save.if,
    /cache-primary-key == format\('node-modules-v1-\{0\}-\{1\}-\{2\}', runner\.os, runner\.arch, hashFiles\(inputs\.node-version-file, '\.npmrc', 'package-lock\.json', 'package\.json', 'apps\/\*\/package\.json', 'packages\/\*\/package\.json'\)\)/
  )
  assert.equal(save['continue-on-error'], true)
  // The npm download cache is restored only for an install.
  assert.equal(
    step('Setup Node').with.cache,
    "${{ steps.modules.outputs.cache-hit != 'true' && 'npm' || '' }}"
  )
})

test('both setup actions take their tree from it', () => {
  for (const file of [
    '.github/actions/install/action.yml',
    '.github/actions/setup-node-env/action.yml',
  ]) {
    const steps = read(file).runs.steps
    assert.deepEqual(
      steps.map((candidate) => candidate.uses),
      ['./.github/actions/node-dependencies'],
      file
    )
  }
})
