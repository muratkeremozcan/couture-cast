import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from 'yaml'

async function host(t, architecture, hvf, hvfStatus = 0) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc68-ios-host-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const capture = path.join(directory, 'commands')
  for (const binary of ['uname', 'sysctl', 'brew', 'colima']) {
    await writeFile(
      path.join(directory, binary),
      `#!/bin/bash
printf '%s %s\\n' '${binary}' "$*" >> "$CAPTURE"
case '${binary}' in
  uname) printf '%s\\n' "$HOST_ARCH";;
  sysctl) printf '%s\\n' "$HOST_HVF"; exit "$HVF_STATUS";;
esac
`,
      { mode: 0o700 }
    )
  }
  const result = spawnSync('/bin/bash', ['scripts/ci/share-card-ios-host.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:/usr/bin:/bin`,
      CAPTURE: capture,
      HOST_ARCH: architecture,
      HOST_HVF: hvf,
      HVF_STATUS: String(hvfStatus),
    },
  })
  return { result, commands: await readFile(capture, 'utf8').catch(() => '') }
}

test('iOS native CI selects an Intel runner and the verified Docker host', async () => {
  const workflow = parse(
    await readFile('.github/workflows/pr-share-card-native.yml', 'utf8')
  )
  const job = workflow.jobs['original-resource']
  const ios = job.strategy.matrix.include.find((entry) => entry.platform === 'ios')
  assert.equal(ios.os, 'macos-15-intel')
  const provision = job.steps.find(
    (step) => step.name === 'Start owned Docker VM for local Auth on macOS'
  )
  assert.equal(provision.run.trim(), 'bash scripts/ci/share-card-ios-host.sh')
  const controls = job.steps.find(
    (step) => step.name === 'Verify startup deadline controls'
  )
  assert.match(controls.run, /scripts\/ci\/share-card-ios-host\.test\.mjs/)
})

for (const [name, arch, hvf, status] of [
  ['ARM software emulation', 'arm64', '1', 0],
  ['disabled hypervisor', 'x86_64', '0', 0],
  ['missing hypervisor', 'x86_64', '', 1],
  ['malformed hypervisor', 'x86_64', '1bad', 0],
]) {
  test(`iOS Docker provisioning rejects ${name} before installing or starting a VM`, async (t) => {
    const { result, commands } = await host(t, arch, hvf, status)
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(commands, /brew |colima /)
  })
}
test('iOS Docker provisioning uses native Intel hardware virtualization', async (t) => {
  const { result, commands } = await host(t, 'x86_64', '1')
  assert.equal(result.status, 0, result.stderr)
  assert.match(commands, /sysctl -n kern.hv_support/)
  assert.match(commands, /colima start --vm-type=qemu --arch=x86_64 --cpu-type=host/)
  assert.doesNotMatch(commands, /aarch64|--cpu-type=max/)
})

test('Supabase image caches keep Intel and ARM container images separate', async (t) => {
  const action = parse(
    await readFile('.github/actions/start-local-supabase/action.yml', 'utf8')
  )
  const compute = action.runs.steps.find((step) => step.id === 'cache-key')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc68-image-architecture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keys = []
  for (const architecture of ['X64', 'ARM64']) {
    const output = path.join(directory, architecture)
    const result = spawnSync('/bin/bash', ['-e', '-c', compute.run], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_OS: 'macOS',
        RUNNER_ARCH: architecture,
        RUNNER_TEMP: directory,
        EXCLUDE: 'realtime,studio',
        CONFIG_HASH: 'a'.repeat(64),
        GITHUB_OUTPUT: output,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    keys.push(
      (await readFile(output, 'utf8')).split('\n').find((line) => line.startsWith('key='))
    )
  }
  assert.notEqual(keys[0], keys[1])
})

for (const [arch, expected] of [
  ['arm64', 'arm64'],
  ['x64', 'x86_64'],
]) {
  test(`iOS simulator build selects ${expected} for the ${arch} host`, async () => {
    const source = await readFile('scripts/run-story68-native.mjs', 'utf8')
    const marker = "} else if (command === 'build') {"
    const start = source.indexOf(marker) + marker.length
    const end = source.indexOf('\n} else if', start)
    let selected
    vm.runInNewContext(`(() => {${source.slice(start, end)}})()`, {
      ownedEnv: () => undefined,
      option: () => undefined,
      platform: 'ios',
      root: '/owned',
      directory: '/owned/runtime',
      path,
      fs: { openSync: () => 1, closeSync: () => undefined },
      process: { arch, env: {} },
      adb: '/owned/android-sdk/platform-tools/adb',
      read: () => ({}),
      console: { log: () => undefined },
      spawnSync: (_binary, args) => {
        selected = Array.from(args)
        return { status: 0 }
      },
    })
    assert.ok(selected.includes(`ARCHS=${expected}`))
    assert.ok(selected.includes('ONLY_ACTIVE_ARCH=YES'))
  })
}
