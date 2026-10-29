import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  NATIVE_MAESTRO_FLOWS,
  assertGenericMaestroFlows,
  discoverRunnableMaestroFlows,
} from './native-maestro-flows.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const native = 'share-card-export.yaml'

describe('native-only Maestro flows', () => {
  test('the share-card export flow exists in maestro/ and is the registered native flow', () => {
    assert.deepEqual([...NATIVE_MAESTRO_FLOWS], [native])
    assert.equal(fs.existsSync(path.join(root, 'maestro', native)), true)
  })

  test('generic run-maestro discovery keeps every other root flow and drops the native one', () => {
    const flows = discoverRunnableMaestroFlows(root)
    const roots = fs
      .readdirSync(path.join(root, 'maestro'))
      .filter((name) => /\.ya?ml$/.test(name))
    assert.equal(flows.includes(`maestro/${native}`), false)
    assert.deepEqual(
      flows,
      roots
        .filter((name) => name !== native)
        .map((name) => `maestro/${name}`)
        .sort()
    )
  })

  test('an explicit native flow request throws, in any path form, and generic flows pass', () => {
    for (const flow of [`maestro/${native}`, native, `./maestro/${native}`])
      assert.throws(
        () => assertGenericMaestroFlows(['maestro/sanity.yaml', flow]),
        /Use scripts\/run-story68-native\.mjs for share-card-export\.yaml/
      )
    assert.doesNotThrow(() => assertGenericMaestroFlows(['maestro/sanity.yaml']))
  })

  test('run-maestro.mjs discovers through the shared helper and guards before any setup', () => {
    // Executing run-maestro.mjs rebuilds shared packages at import, so this reads the
    // wiring; the helpers above carry the behavior.
    const source = fs.readFileSync(path.join(root, 'scripts/run-maestro.mjs'), 'utf8')
    assert.match(
      source,
      /const discoverFlows = \(\) => discoverRunnableMaestroFlows\(projectRoot\)/
    )
    const guard = source.indexOf('assertGenericMaestroFlows(flowsToRun)')
    assert.ok(guard > source.indexOf('const flowsToRun ='))
    assert.ok(guard < source.indexOf('const run = async () => {'))
  })

  test('the full-suite shard resolver never shards the native flow and records no duration for it', () => {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/resolve-maestro-shard.mjs',
        '--suite',
        'full',
        '--shard',
        '1',
        '--shards',
        '1',
      ],
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stderr)
    const list = /^list=(.*)$/m.exec(result.stdout)?.[1].split(' ')
    assert.ok(list?.includes('maestro/sanity.yaml'))
    assert.equal(list.includes(`maestro/${native}`), false)
    assert.equal(result.stderr.includes(native), false)
    const durations = JSON.parse(
      fs.readFileSync(path.join(root, 'scripts/maestro-flow-durations.json'), 'utf8')
    )
    assert.equal(native in durations, false)
  })
})
