// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): the native shell snapshots (7.9-NVIS-001..008) run in one
// extra shard of pr-mobile-e2e.yml on the Android small_phone, the device their baselines were
// taken on. These cases hold that row, its device and its flow list, and keep the snapshot
// flow out of every other shard.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  discoverRunnableMaestroFlows,
  isVisualMaestroFlow,
  VISUAL_MAESTRO_FLOWS,
} from '../lib/native-maestro-flows.mjs'
import { matrixRows } from './workflow-step-shadowing.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workflow = parse(
  fs.readFileSync(path.join(root, '.github/workflows/pr-mobile-e2e.yml'), 'utf8')
)
const job = workflow.jobs['mobile-e2e-android']
const step = (name) => job.steps.find((row) => row.name === name)

const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-visual-lane-'))
after(() => fs.rmSync(tree, { recursive: true, force: true }))
for (const file of [
  'scripts/resolve-maestro-shard.mjs',
  'scripts/maestro-flow-durations.json',
  'scripts/lib/native-maestro-flows.mjs',
  'scripts/lib/maestro-auth-mode.mjs',
]) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true })
  fs.copyFileSync(path.join(root, file), path.join(tree, file))
}
fs.mkdirSync(path.join(tree, 'maestro'), { recursive: true })
for (const name of ['analytics.yaml', 'sanity.yaml', 'shell-visual-snapshots.yaml'])
  fs.writeFileSync(path.join(tree, 'maestro', name), '- launchApp\n')

const resolve = (...args) => {
  const result = spawnSync(
    process.execPath,
    ['scripts/resolve-maestro-shard.mjs', ...args],
    { cwd: tree, encoding: 'utf8' }
  )
  const list = /^list=(.*)$/m.exec(result.stdout)?.[1].split(' ') ?? []
  const empty = /^empty=(.*)$/m.exec(result.stdout)?.[1]
  return { ...result, list, empty }
}

describe('visual flows stay out of the suite', () => {
  test('[7.9-NVIS-U05] the snapshot flow exists and only it is a visual flow', () => {
    for (const name of VISUAL_MAESTRO_FLOWS)
      assert.ok(fs.existsSync(path.join(root, 'maestro', name)), name)
    assert.equal(isVisualMaestroFlow('maestro/shell-visual-snapshots.yaml'), true)
    assert.equal(isVisualMaestroFlow('maestro/sanity.yaml'), false)
  })

  test('[7.9-NVIS-U06] suite discovery and every member shard leave it out', () => {
    assert.deepEqual(discoverRunnableMaestroFlows(tree), [
      'maestro/analytics.yaml',
      'maestro/sanity.yaml',
    ])
    const flows = [1, 2].flatMap(
      (shard) =>
        resolve('--suite', 'full', '--shard', String(shard), '--shards', '2').list
    )
    assert.deepEqual(flows.sort(), ['maestro/analytics.yaml', 'maestro/sanity.yaml'])
  })

  test('[7.9-NVIS-U07] --lane visual lists exactly the snapshot flow, whatever the shard number', () => {
    const result = resolve(
      '--suite',
      'full',
      '--lane',
      'visual',
      '--shard',
      '11',
      '--shards',
      '9'
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.empty, 'false')
    assert.deepEqual(result.list, ['maestro/shell-visual-snapshots.yaml'])
    assert.equal(resolve('--suite', 'smoke', '--lane', 'visual').empty, 'true')
    assert.notEqual(resolve('--lane', 'visual', '--auth', 'signed-out').status, 0)
    assert.notEqual(
      resolve('--lane', 'pixels', '--shard', '1', '--shards', '1').status,
      0
    )
  })
})

describe('pr-mobile-e2e.yml visual row', () => {
  const rows = matrixRows(job.strategy.matrix)
  const visual = rows.filter((row) => row.lane === 'visual')

  test('[7.9-NVIS-U08] one member row on small_phone; every other row keeps medium_phone', () => {
    assert.equal(visual.length, 1)
    assert.equal(visual[0].auth, 'member')
    assert.equal(visual[0].profile, 'small_phone')
    assert.equal(
      rows.filter((row) => row.profile !== undefined).length,
      1,
      'only the visual row names a device'
    )
    assert.equal(job.env.ANDROID_PROFILE, "${{ matrix.profile || 'medium_phone' }}")
    assert.equal(workflow.env.ANDROID_PROFILE, 'medium_phone')
  })

  test('[7.9-NVIS-U09] the AVD cache key and both emulator steps follow the row device', () => {
    const restore = step('Restore cached AVD and snapshot')
    assert.match(restore.with.key, /\$\{\{ env\.ANDROID_PROFILE \}\}$/)
    assert.equal(
      step('Create AVD and generate snapshot for caching').with.profile,
      '${{ env.ANDROID_PROFILE }}'
    )
    assert.equal(step('Run Maestro suite').with.profile, '${{ env.ANDROID_PROFILE }}')
  })

  test('[7.9-NVIS-U10] the resolver gets the row lane, suite by default', () => {
    assert.match(
      step("Resolve this shard's flow list").run,
      /--lane "\$\{\{ matrix\.lane \|\| 'suite' \}\}"/
    )
  })
})

// CI 5f2043f2: the visual shard's own 1.5 GB AVD cache entry pushed the repository to its 10 GB
// cache limit and evicted main's Gradle dependency cache. The visual row neither restores,
// generates nor saves an AVD snapshot; every other row keeps the shared cache.
test('[7.9-NVIS-U16] the visual row keeps no AVD cache, the other rows keep theirs', () => {
  for (const name of [
    'Restore cached AVD and snapshot',
    'Create AVD and generate snapshot for caching',
    'Save AVD and snapshot to cache',
  ]) {
    const row = step(name)
    assert.ok(row, `${name} present`)
    assert.match(String(row.if), /matrix\.lane != 'visual'/, name)
  }
  assert.match(
    String(step('Create AVD and generate snapshot for caching').if),
    /steps\.avd-cache\.outputs\.cache-hit != 'true'/
  )
})
