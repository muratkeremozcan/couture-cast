import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const ACTION = './.github/actions/free-runner-disk'
const action = parse(
  fs.readFileSync(path.join(root, '.github/actions/free-runner-disk/action.yml'), 'utf8')
)
const script = action.runs.steps[0].run
const targets = script.match(/^targets=\(\n([\s\S]*?)\n\)$/m)?.[1] ?? ''

const workflowsDir = path.join(root, '.github/workflows')
const workflows = fs
  .readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({
    name,
    jobs: parse(fs.readFileSync(path.join(workflowsDir, name), 'utf8')).jobs ?? {},
  }))

/** The runner labels a job can land on, with `${{ matrix.os }}` expanded. */
function runnerLabels(job) {
  if (String(job['runs-on']).includes('matrix.os'))
    return (job.strategy?.matrix?.include ?? []).map((row) => row.os)
  return [String(job['runs-on'])]
}

// A job needs the space when it builds the Android app, boots an emulator or
// runs the story 6.8 disk guard through the share-card plugin suite.
const needsSpace = (job) =>
  (job.steps ?? []).some(
    (step) =>
      String(step.uses ?? '').startsWith('reactivecircus/android-emulator-runner') ||
      /\bgradlew\b|run-story68-native\.mjs build|node-test-gate\.mjs share-card-plugins/.test(
        String(step.run ?? '')
      )
  )

async function runAction(t, { uname = 'Linux', failHomeDir = '', homeDirs = [] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc-free-runner-disk-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bin = path.join(directory, 'bin')
  const home = path.join(directory, 'home')
  const android = path.join(directory, 'android-sdk')
  await mkdir(bin)
  await mkdir(home)
  await mkdir(path.join(android, 'ndk/27.3.13750724'), { recursive: true })
  await mkdir(path.join(android, 'platforms/android-36'), { recursive: true })
  for (const name of homeDirs) await mkdir(path.join(home, name))
  for (const tool of ['tail', 'tr']) {
    const real = ['/usr/bin', '/bin']
      .map((dir) => path.join(dir, tool))
      .find(fs.existsSync)
    await symlink(real, path.join(bin, tool))
  }
  const capture = path.join(directory, 'sudo-calls')
  const fake = {
    uname: `echo ${uname}`,
    // Records each deletion instead of running it; FAIL_TARGET makes one fail.
    sudo: `printf '%s\\n' "$*" >> "${capture}"\n[ "\${@: -1}" = "$FAIL_TARGET" ] && exit 1\nexit 0`,
    // The first available-bytes read reports 10 GiB, the second 25 GiB.
    df: [
      'if [ "$1" = --output=avail ]; then',
      '  count=0',
      `  [ -f "${directory}/df-count" ] && read -r count < "${directory}/df-count"`,
      '  count=$(( count + 1 ))',
      `  echo "$count" > "${directory}/df-count"`,
      '  echo Avail',
      '  if [ "$count" -eq 1 ]; then echo 10737418240; else echo 26843545600; fi',
      'else',
      '  echo "Filesystem Size Used Avail Use% Mounted on"',
      'fi',
    ].join('\n'),
  }
  for (const [name, body] of Object.entries(fake))
    await writeFile(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o700 })
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
    env: {
      PATH: bin,
      HOME: home,
      ANDROID_HOME: android,
      FAIL_TARGET: failHomeDir ? path.join(home, failHomeDir) : '',
    },
    encoding: 'utf8',
  })
  const calls = fs.existsSync(capture)
    ? fs.readFileSync(capture, 'utf8').trim().split('\n')
    : []
  return { result, calls, home, android }
}

describe('free-runner-disk action', () => {
  test('a non-Linux runner deletes nothing and passes', async (t) => {
    const { result, calls } = await runAction(t, { uname: 'Darwin' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Not a Linux runner \(Darwin\)/)
    assert.deepEqual(calls, [])
  })

  test('deletes each present tree, skips missing ones and reports the freed space', async (t) => {
    const { result, calls, home, android } = await runAction(t, { homeDirs: ['.rustup'] })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(calls.includes(`rm -rf -- ${home}/.rustup`), calls.join('\n'))
    assert.ok(calls.includes(`rm -rf -- ${android}/ndk`), calls.join('\n'))
    assert.ok(!calls.some((call) => call.endsWith(`${home}/.cargo`)), calls.join('\n'))
    assert.ok(!calls.some((call) => call.includes('platforms')), calls.join('\n'))
    assert.match(result.stdout, /Before:\nFilesystem[^\n]*\n/)
    assert.match(result.stdout, /After:\nFilesystem[^\n]*\n/)
    assert.match(result.stdout, /Freed 15360 MiB on \/ in \d+ s; 25 GiB now free\./)
  })

  test('a failed deletion fails the step after every other deletion finished', async (t) => {
    const { result, calls, home, android } = await runAction(t, {
      homeDirs: ['.rustup', '.cargo'],
      failHomeDir: '.cargo',
    })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /::error::Deleting a preinstalled toolchain failed/)
    assert.match(result.stdout, /Freed 15360 MiB/)
    for (const target of [`${home}/.rustup`, `${home}/.cargo`, `${android}/ndk`])
      assert.ok(calls.includes(`rm -rf -- ${target}`), `${target} in ${calls.join(', ')}`)
  })

  test('keeps every SDK part, runtime and service the jobs use', () => {
    for (const kept of [
      '/usr/lib/jvm',
      '/opt/hostedtoolcache/node',
      '/opt/hostedtoolcache/Python',
      'platforms',
      'build-tools',
      'system-images',
      'emulator',
      'platform-tools',
      'cmdline-tools',
      'docker',
    ])
      assert.ok(!targets.includes(kept), `${kept} must stay on the runner`)
    assert.match(targets, /"\$\{ANDROID_HOME:-\/usr\/local\/lib\/android\/sdk\}\/ndk"/)
  })

  test('the NDK the comment names is still the one React Native pins', () => {
    const versions = fs.readFileSync(
      path.join(root, 'node_modules/react-native/gradle/libs.versions.toml'),
      'utf8'
    )
    const pinned = versions.match(/^ndkVersion = "([^"]+)"/m)?.[1]
    assert.ok(pinned, 'react-native pins an NDK version')
    // A new pin may be one the runner image ships, and deleting it would then
    // cost a download on every build: re-check the image before updating this.
    assert.ok(script.includes(`pins NDK ${pinned}`), `update the NDK note for ${pinned}`)
  })
})

describe('free-runner-disk callers', () => {
  const callers = workflows.flatMap(({ name, jobs }) =>
    Object.entries(jobs)
      .filter(
        ([, job]) =>
          needsSpace(job) &&
          runnerLabels(job).every((label) => label.startsWith('ubuntu'))
      )
      .map(([id, job]) => ({ id: `${name}:${id}`, job }))
  )

  test('finds the Android build, emulator and disk-guard jobs', () => {
    const ids = callers.map(({ id }) => id)
    for (const expected of [
      'pr-mobile-e2e.yml:mobile-e2e-android',
      'pr-accessibility-focus.yml:android',
      'pr-accessibility-focus.yml:android-talkback',
      'pr-share-card-native.yml:original-resource',
      'pr-share-card-native.yml:android36-native-matrix',
      'pr-share-card-native.yml:android36-original',
      'pr-share-card-native.yml:android36-controls',
      'pr-share-card-native.yml:android36-interaction',
      'pr-share-card-native.yml:browser-acceptance',
    ])
      assert.ok(ids.includes(expected), `${expected} in ${ids.join(', ')}`)
  })

  for (const { id, job } of callers)
    test(`${id} frees disk right after checkout and its port reservation`, () => {
      const steps = job.steps.map((step) => String(step.uses ?? ''))
      const anchor = Math.max(
        steps.indexOf('actions/checkout@v4'),
        steps.indexOf('./.github/actions/reserve-supabase-ports')
      )
      assert.equal(steps.indexOf('actions/checkout@v4'), 0)
      assert.equal(steps.indexOf(ACTION), anchor + 1)
    })
})
