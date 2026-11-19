// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import {
  STORY68_NATIVE_MINIMUM_FREE_BYTES,
  assertStory68DiskSpace,
} from '../lib/test-disk-space.mjs'

const FLAG_KEYS = [
  'STORY68_NATIVE_TEST_BUILD',
  'CC68_RELEASE_PROOF_LOOPBACK',
  'EAS_BUILD_PROFILE',
]
const NO_FLAGS = {
  STORY68_NATIVE_TEST_BUILD: null,
  CC68_RELEASE_PROOF_LOOPBACK: null,
  EAS_BUILD_PROFILE: null,
}
const PROOF_FLAGS = {
  STORY68_NATIVE_TEST_BUILD: '1',
  CC68_RELEASE_PROOF_LOOPBACK: '1',
  EAS_BUILD_PROFILE: 'cc68-release-proof',
}
const CLEANUP_ARGS = [
  'scripts/run-story68-native.mjs',
  'prebuild',
  '--platform',
  'android',
  '--clean',
  'yes',
]

const MIB = 1024 ** 2
// What the kernel log holds when the OOM killer ends the emulator, among unrelated lines.
const OOM_RECORDS = [
  '[ 1203.512001] java invoked oom-killer: gfp_mask=0x140cca(GFP_HIGHUSER_MOVABLE|__GFP_COMP), order=0, oom_score_adj=0',
  '[ 1203.540000] oom-kill:constraint=CONSTRAINT_NONE,nodemask=(null),cpuset=/,mems_allowed=0,global_oom,task=qemu-system-x86,pid=4321,uid=1001',
  '[ 1203.551234] Out of memory: Killed process 4321 (qemu-system-x86) total-vm:9876543kB, anon-rss:4123456kB, file-rss:0kB, shmem-rss:0kB, UID:1001 pgtables:9000kB oom_score_adj:0',
]
const UNRELATED_KERNEL_LINES = [
  '[   12.004211] EXT4-fs (sda1): mounted filesystem with ordered data mode.',
  '[  901.337000] audit: type=1400 audit(1763467200.000:42): apparmor="STATUS" operation="profile_load"',
]

// Fake commands on PATH record each call with the proof flags it saw. CC68_CI_FAILURE picks one
// failure: the proof, the cleanup prebuild, the swap, or the emulator gone after the build.
// CC68_CI_FREE_MIB is the free disk df reports under RUNNER_TEMP.
const FAKE = `
const fs = require('node:fs')
const command = require('node:path').basename(process.argv[1])
const args = process.argv.slice(2)
const flags = Object.fromEntries(${JSON.stringify(FLAG_KEYS)}.map(key => [key, process.env[key] ?? null]))
fs.appendFileSync(process.env.CC68_CI_EVENTS, JSON.stringify({ command, args, flags }) + '\\n')
const failure = process.env.CC68_CI_FAILURE
if (command === 'uname') { console.log('Linux'); process.exit(0) }
if (command === 'df') {
  console.log('Filesystem     1048576-blocks   Used Available Capacity Mounted on')
  console.log('/dev/root             ' + (Number(process.env.CC68_CI_FREE_MIB) + 50000) + ' 50000 ' + process.env.CC68_CI_FREE_MIB + '       30% /')
  process.exit(0)
}
if (command === 'sudo' && args.join(' ') === '-n dmesg') {
  console.log(${JSON.stringify([UNRELATED_KERNEL_LINES[0], ...OOM_RECORDS, UNRELATED_KERNEL_LINES[1]].join('\n'))})
  process.exit(0)
}
if (command === 'adb' && args.includes('get-state')) {
  if (failure === 'emulator-gone') { console.error("error: device 'emulator-5554' not found"); process.exit(1) }
  console.log('device')
}
if (failure === 'proof' && args.includes('release-live-font')) process.exit(19)
if (failure === 'cleanup' && args.includes('prebuild') && flags.CC68_RELEASE_PROOF_LOOPBACK === '0') process.exit(37)
if (failure === 'swap' && command === 'sudo' && args[0] === 'fallocate') process.exit(28)
`

function runScript({ failure = 'none', githubLinux = false, freeMib = 200 * 1024 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-release-ci-'))
  try {
    const bin = path.join(directory, 'bin')
    fs.mkdirSync(bin)
    const events = path.join(directory, 'events.jsonl')
    const commands = [
      'node',
      'adb',
      'sudo',
      'free',
      'swapon',
      ...(githubLinux ? ['uname', 'df'] : []),
    ]
    for (const command of commands)
      fs.writeFileSync(path.join(bin, command), `#!${process.execPath}\n${FAKE}`, {
        mode: 0o755,
      })
    const result = spawnSync('bash', ['scripts/ci/share-card-android-release-font.sh'], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        ANDROID_SERIAL: 'emulator-5554',
        CC68_CI_EVENTS: events,
        CC68_CI_FAILURE: failure,
        CC68_CI_FREE_MIB: String(freeMib),
        CC68_RELEASE_PROOF_LOOPBACK: undefined,
        STORY68_NATIVE_TEST_BUILD: undefined,
        EAS_BUILD_PROFILE: undefined,
        // This spec itself runs on GitHub's Linux runners; only the swap tests take that path.
        GITHUB_ACTIONS: githubLinux ? 'true' : undefined,
        RUNNER_TEMP: githubLinux ? '/runner-temp' : undefined,
      },
    })
    const records = fs
      .readFileSync(events, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    return { result, records }
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
}

const nodeCalls = (records) => records.filter((record) => record.command === 'node')

describe('share-card-android-release-font.sh', () => {
  for (const failure of ['none', 'proof', 'cleanup']) {
    test(`actual CI Release script scopes proof flags and cleanly switches off after ${failure}`, () => {
      const { result, records } = runScript({ failure })
      assert.equal(
        result.status,
        failure === 'proof' ? 19 : failure === 'cleanup' ? 37 : 0,
        result.stderr
      )
      assert.deepEqual(
        records.map((record) => record.command),
        ['node', 'node', 'adb', 'adb', 'node', 'node']
      )
      for (const record of records.slice(0, 2))
        assert.deepEqual(record.flags, PROOF_FLAGS)
      assert.ok(records[0].args.includes('--clean') && records[0].args.includes('yes'))
      assert.ok(records[1].args.includes('Release'))
      // The emulator still answers after the Release build, before anything is installed.
      assert.deepEqual(records[2].args, ['-s', 'emulator-5554', 'get-state'])
      // Over the dev client, keeping its session: the proof build shares its signing key.
      assert.deepEqual(records[3], {
        command: 'adb',
        args: [
          '-s',
          'emulator-5554',
          'install',
          '-r',
          'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
        ],
        flags: NO_FLAGS,
      })
      assert.equal(records[4].args.includes('release-live-font'), true)
      assert.equal(records[4].flags.CC68_RELEASE_PROOF_LOOPBACK, null)
      assert.deepEqual(records[5].args, CLEANUP_ARGS)
      assert.equal(records[5].flags.CC68_RELEASE_PROOF_LOOPBACK, '0')
    })
  }

  test('an emulator that exits during the Release build fails before the install, named', () => {
    const { result, records } = runScript({ failure: 'emulator-gone' })
    assert.equal(result.status, 1, result.stderr)
    assert.match(
      result.stderr,
      /^::error::The emulator emulator-5554 exited during the Release build\.$/m
    )
    assert.doesNotMatch(result.stdout + result.stderr, /install -r/)
    // The kernel's account is kept: memory, swap and the OOM records.
    assert.deepEqual(
      records.filter((record) => record.command !== 'node').map((record) => record.args),
      [['-s', 'emulator-5554', 'get-state'], ['-m'], ['--show'], ['-n', 'dmesg']]
    )
    // Every OOM record reaches the log, in order, and nothing else the kernel logged.
    const kernel = result.stdout.split('== Kernel OOM records\n')[1]
    assert.equal(kernel, `${OOM_RECORDS.join('\n')}\n`)
    // Normal generation is still restored.
    assert.deepEqual(
      nodeCalls(records).map((record) => record.args[1]),
      ['prebuild', 'build', 'prebuild']
    )
    assert.deepEqual(records.at(-1).args, CLEANUP_ARGS)
    assert.equal(records.at(-1).flags.CC68_RELEASE_PROOF_LOOPBACK, '0')
  })

  // The swap file shares RUNNER_TEMP's filesystem with the repository on GitHub's runners, and
  // run-story68-native.mjs refuses prebuild, build and release-live-font under 15 GiB free there.
  // Each case models the disk the guard then sees: free before, less the swap the script added.
  for (const { label, freeMib, swapMib } of [
    { label: 'a roomy runner gets the full 8 GiB', freeMib: 115 * 1024, swapMib: 8192 },
    {
      label: 'a 22 GiB runner gets only what keeps the guard and margin',
      freeMib: 22 * 1024,
      swapMib: 2048,
    },
    {
      label: 'a 20.5 GiB runner gets no swap at all',
      freeMib: 20 * 1024 + 512,
      swapMib: 0,
    },
  ])
    test(`swap within the disk guard: ${label}`, () => {
      const { result, records } = runScript({ githubLinux: true, freeMib })
      assert.equal(result.status, 0, result.stderr)
      const file = '/runner-temp/cc68-release-build.swap'
      const swap = records
        .filter((record) => record.command === 'sudo')
        .map((r) => r.args)
      assert.deepEqual(
        swap,
        swapMib === 0
          ? []
          : [
              ['fallocate', '-l', `${swapMib}M`, file],
              ['chmod', '600', file],
              ['mkswap', file],
              ['swapon', file],
            ]
      )
      // Skipping the swap is said once in the log; adding it says nothing.
      assert.deepEqual(
        result.stdout.match(/^::warning::.*$/gm) ?? [],
        swapMib === 0
          ? [
              `::warning::Only ${freeMib} MiB free under /runner-temp; the Release build runs without added swap so the 15 GiB disk guard still holds.`,
            ]
          : []
      )
      // The guard each native command runs still passes, with the 5 GiB build margin to spare.
      const leftBytes = (freeMib - swapMib) * MIB
      assert.equal(assertStory68DiskSpace('.', leftBytes), leftBytes)
      assert.ok(leftBytes >= STORY68_NATIVE_MINIMUM_FREE_BYTES + 5 * 1024 * MIB)
      // The swap is on before the Release prebuild starts, and the proof runs either way.
      const lastSwap = records.findLastIndex((record) => record.command === 'sudo')
      const firstNode = records.findIndex((record) => record.command === 'node')
      assert.ok(lastSwap < firstNode)
      assert.deepEqual(
        nodeCalls(records).map((record) => record.args[1]),
        ['prebuild', 'build', 'release-live-font', 'prebuild']
      )
    })

  test('a swap that cannot be added fails before any build and restores normal generation', () => {
    const { result, records } = runScript({ failure: 'swap', githubLinux: true })
    assert.equal(result.status, 1, result.stderr)
    assert.match(
      result.stderr,
      /^::error::Adding 8192 MiB of swap for the Release build failed; see the output above\.$/m
    )
    assert.deepEqual(
      nodeCalls(records).map((record) => record.args),
      [CLEANUP_ARGS]
    )
    assert.equal(records.at(-1).flags.CC68_RELEASE_PROOF_LOOPBACK, '0')
  })
})
