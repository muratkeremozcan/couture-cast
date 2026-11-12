// Story 6.15 D6: scripts/ci/native-ios-runtime.sh gives each segment of the one iOS job its own
// runtime. These run it against stub node, pgrep and pkill in a scratch directory.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const script = path.resolve('scripts/ci/native-ios-runtime.sh')

/** A scratch harness, runner temp and tmp, with stub tools that log their arguments. */
function scratch(t, { nodeFails = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-ios-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin')
  const log = path.join(root, 'calls.log')
  fs.mkdirSync(bin)
  const fail = nodeFails.map((name) => `*${name}*) exit 1 ;;`).join(' ')
  fs.writeFileSync(
    path.join(bin, 'node'),
    `#!/usr/bin/env bash\necho "node $*" >> "${log}"\ncase "$*" in ${fail} *) exit 0 ;; esac\n`,
    { mode: 0o755 }
  )
  // No owned service is running.
  fs.writeFileSync(path.join(bin, 'pgrep'), '#!/usr/bin/env bash\nexit 1\n', {
    mode: 0o755,
  })
  fs.writeFileSync(
    path.join(bin, 'pkill'),
    `#!/usr/bin/env bash\necho "pkill $*" >> "${log}"\nexit 1\n`,
    { mode: 0o755 }
  )
  const harness = path.join(root, 'runtime')
  const tmp = path.join(root, 'tmp')
  const runnerTemp = path.join(root, 'runner')
  fs.mkdirSync(harness)
  fs.mkdirSync(tmp)
  fs.mkdirSync(runnerTemp)
  const run = (...args) =>
    spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CC68_HARNESS_DIR: harness,
        CC68_TMP: tmp,
        RUNNER_TEMP: runnerTemp,
      },
    })
  const calls = () =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
  return { harness, tmp, runnerTemp, run, calls }
}

test('start provisions the runtime, then starts auth, the API and Metro for iOS', async (t) => {
  const { run, calls, tmp } = scratch(t)
  assert.equal(run('start').status, 0)
  // The services run in the background; wait for their stub exits.
  for (
    let i = 0;
    i < 50 && fs.readdirSync(tmp).filter((f) => f.endsWith('.exit')).length < 3;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 100))
  const made = calls()
  assert.equal(made[0], 'node scripts/e2e-share-card/prepare.mjs')
  for (const call of [
    'node scripts/e2e-share-card/auth.mjs',
    'node scripts/run-story68-native.mjs serve',
    'node scripts/run-story68-native.mjs metro --platform ios',
    'node scripts/maestro-install.mjs',
  ])
    assert.ok(made.includes(call), call)
})

test('exits fails, naming the service, when one exited and passes when none did', (t) => {
  const { run, tmp } = scratch(t)
  assert.equal(run('exits').status, 0)
  fs.writeFileSync(path.join(tmp, 'cc68-api.exit'), '1\n')
  fs.writeFileSync(path.join(tmp, 'cc68-api.log'), 'a\nb\n')
  const result = run('exits')
  assert.equal(result.status, 1)
  assert.match(
    result.stdout,
    /owned api service exited early with status 1; its private log has 2 lines/
  )
})

test('stop cleans up, stops the services and moves the runtime aside for the next segment', (t) => {
  const { run, calls, harness, tmp, runnerTemp } = scratch(t)
  fs.writeFileSync(path.join(harness, 'resources.json'), '{}')
  fs.writeFileSync(path.join(tmp, 'cc68-metro.exit'), '1\n')
  fs.writeFileSync(path.join(tmp, 'cc68-simulator'), 'device\n')
  assert.equal(run('stop', 'shard-2').status, 0)
  const made = calls()
  assert.equal(made[0], 'node scripts/e2e-share-card/cleanup.mjs')
  assert.ok(
    made.some((call) =>
      call.startsWith('pkill -TERM -f scripts/run-story68-native.mjs metro')
    )
  )
  assert.ok(made.includes('node scripts/ci/native-ios-device-cleanup.mjs'))
  assert.equal(fs.existsSync(harness), false)
  assert.ok(
    fs.existsSync(path.join(runnerTemp, 'ios-native-runtimes/shard-2/resources.json'))
  )
  // The next segment starts with no exit file and no simulator receipt of this one.
  assert.deepEqual(fs.readdirSync(tmp), [])
})

test('a failed cleanup fails stop, and the runtime still moves aside', (t) => {
  const { run, harness, runnerTemp } = scratch(t, { nodeFails: ['cleanup.mjs'] })
  assert.equal(run('stop', 'expo-go').status, 1)
  assert.equal(fs.existsSync(harness), false)
  assert.ok(fs.existsSync(path.join(runnerTemp, 'ios-native-runtimes/expo-go')))
})

test('stop refuses a segment name that is not a plain word', (t) => {
  const { run, harness } = scratch(t)
  assert.equal(run('stop', '../escape').status, 2)
  assert.ok(fs.existsSync(harness))
  assert.equal(run('nothing').status, 2)
})
