// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import { commandsForShard } from './native-matrix-shards.mjs'

async function journey(
  t,
  sdk,
  expected = '36',
  status = 0,
  accel = 'KVM (version 12) is installed and usable.',
  { suite = sdk.trim() === '32' ? 'all-1' : 'matrix-1', failOn = '' } = {}
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc68-sdk-guard-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const capture = path.join(directory, 'commands')
  for (const binary of ['adb', 'node', 'bash']) {
    await writeFile(
      path.join(directory, binary),
      `#!/bin/bash\nprintf '%s %s\\n' '${binary}' "$*" >> "$CAPTURE"\nif [[ "$*" == *getprop* ]]; then printf '%s\\n' "$SDK"; exit "$SDK_STATUS"; fi\nif [[ -n "$FAIL_ON" && "$*" == *"$FAIL_ON"* ]]; then exit 1; fi\n`,
      { mode: 0o700 }
    )
  }
  await mkdir(path.join(directory, 'emulator'))
  await writeFile(
    path.join(directory, 'emulator', 'emulator'),
    '#!/bin/bash\nprintf \'emulator %s\\n\' "$*" >> "$CAPTURE"\nprintf \'accel:\\n0\\n%s\\naccel\\n\' "$ACCEL"\n',
    { mode: 0o700 }
  )
  const result = spawnSync('/bin/bash', ['scripts/ci/share-card-android.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:/usr/bin:/bin`,
      CAPTURE: capture,
      SDK: sdk,
      SDK_STATUS: String(status),
      CC68_ANDROID_API: expected,
      CC68_ANDROID_SUITE: suite,
      FAIL_ON: failOn,
      ANDROID_HOME: directory,
      ACCEL: accel,
    },
  })
  return { result, commands: await readFile(capture, 'utf8').catch(() => '') }
}

describe('Android SDK guard', () => {
  for (const [name, sdk, expected, status] of [
    ['empty', '', '36', 0],
    ['failed', '36', '36', 1],
    ['malformed', '36oops', '36', 0],
    ['wrong matrix API', '32', '36', 0],
    ['missing matrix API', '36', '', 0],
  ]) {
    test(`Android native journey rejects ${name} SDK evidence before install`, async (t) => {
      const { result, commands } = await journey(t, sdk, expected, status)
      assert.notEqual(result.status, 0)
      assert.doesNotMatch(commands, /install |node |bash /)
    })
  }

  // Every selectable suite and the exact commands it owns after install, open and signin.
  const suites = [
    ['32', 'all-1', ['proof', 'matrix', 'rapid-watermark'], []],
    ['32', 'all-2', ['permission-baseline', 'matrix'], []],
    ['36', 'matrix-1', ['matrix'], []],
    ['36', 'matrix-2', ['matrix'], []],
    ['36', 'original', ['proof'], []],
    ['36', 'controls', ['rapid-watermark', 'a11y', 'fallback-focus'], []],
    [
      '36',
      'interaction',
      ['share-sheet'],
      ['bash scripts/ci/share-card-android-release-font.sh'],
    ],
  ]
  const owned = [
    'proof',
    'permission-baseline',
    'matrix',
    'rapid-watermark',
    'a11y',
    'fallback-focus',
    'share-sheet',
  ]
  const font = 'bash scripts/ci/share-card-android-release-font.sh'

  for (const [sdk, suite, expected, extra] of suites) {
    test(`Android API ${sdk} ${suite} installs, opens and signs in before only its own proofs`, async (t) => {
      const { result, commands } = await journey(t, `${sdk}\r`, sdk, 0, undefined, {
        suite,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(commands.match(/getprop/g)?.length, 1)
      const order = ['install ', 'mjs open ', 'mjs signin ']
      const at = (needle) => commands.indexOf(needle)
      assert.ok(
        order.every(
          (needle, i) => at(needle) >= 0 && (i === 0 || at(needle) > at(order[i - 1]))
        )
      )
      for (const command of owned) {
        const ran = commands.includes(`mjs ${command} `)
        assert.equal(ran, expected.includes(command), `${suite}: ${command}`)
        if (ran)
          assert.ok(at(`mjs ${command} `) > at('mjs signin '), `${suite}: ${command}`)
      }
      assert.equal(commands.includes(font), extra.includes(font), suite)
      if (extra.includes(font)) assert.ok(at(font) > at('mjs signin '))
    })
  }

  test('the Android36 partitions together cover every proof command once and the matrix once per shard', async (t) => {
    const ran = []
    for (const suite of ['matrix-1', 'matrix-2', 'original', 'controls', 'interaction']) {
      const { result, commands } = await journey(t, '36', '36', 0, undefined, { suite })
      assert.equal(result.status, 0, result.stderr)
      ran.push(
        ...[...owned, 'font'].filter((command) =>
          commands.includes(command === 'font' ? font : `mjs ${command} `)
        )
      )
    }
    // The pre-split API36 journey (proof, matrix, rapid, a11y, fallback and Release font) and
    // the Story 6.9 share-sheet command.
    assert.deepEqual([...ran].sort(), [
      'a11y',
      'fallback-focus',
      'font',
      'matrix',
      'matrix',
      'proof',
      'rapid-watermark',
      'share-sheet',
    ])
  })

  // The API32 journey was proof, the matrix and rapid-watermark in one lane. Its two shards
  // together run each of those once and the matrix once per shard.
  test('the API32 shards together cover proof and rapid-watermark once and the matrix once per shard', async (t) => {
    const ran = []
    for (const suite of ['all-1', 'all-2']) {
      const { result, commands } = await journey(t, '32', '32', 0, undefined, { suite })
      assert.equal(result.status, 0, result.stderr)
      ran.push(...owned.filter((command) => commands.includes(`mjs ${command} `)))
    }
    assert.deepEqual([...ran].sort(), [
      'matrix',
      'matrix',
      'permission-baseline',
      'proof',
      'rapid-watermark',
    ])
  })

  // The shard plan names each shard's commands; the journey script runs exactly those, in order.
  for (const [sdk, plan, prefix] of [
    ['32', 'android-32', 'all'],
    ['36', 'android-36', 'matrix'],
  ])
    for (const shard of [1, 2])
      test(`API${sdk} shard ${shard} runs the commands its ${plan} plan names, in order`, async (t) => {
        const { result, commands } = await journey(t, sdk, sdk, 0, undefined, {
          suite: `${prefix}-${shard}`,
        })
        assert.equal(result.status, 0, result.stderr)
        const after = commands.slice(commands.indexOf('run-story68-native.mjs signin '))
        const ran = [...after.matchAll(/run-story68-native\.mjs (\S+) /g)]
          .map((m) => m[1])
          .slice(1)
        assert.deepEqual(ran, commandsForShard(plan, shard))
        assert.match(
          commands,
          new RegExp(`mjs matrix --platform android --device \\S+ --shard ${shard}/2\\n`)
        )
      })

  // U-HARNESS-ANDROID-LANES (Story 6.9): share-sheet runs once, on API36 interaction only.
  test('share-sheet runs exactly once on API36 interaction, after sign-in and before the Release font proof', async (t) => {
    const { result, commands } = await journey(t, '36', '36', 0, undefined, {
      suite: 'interaction',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(commands.match(/mjs share-sheet /g)?.length, 1)
    assert.match(commands, /mjs share-sheet --platform android --device \S+\n/)
    const at = (needle) => commands.indexOf(needle)
    // The Release font proof replaces the debug dev client that share-sheet drives. The rapid
    // watermark, TalkBack and fallback focus proofs run in android36-controls.
    assert.ok(at('mjs share-sheet ') > at('mjs signin '))
    assert.ok(at('mjs share-sheet ') < at(font))
    for (const [sdk, suite] of [
      ['32', 'all-1'],
      ['32', 'all-2'],
      ['36', 'controls'],
      ['36', 'matrix-1'],
      ['36', 'matrix-2'],
      ['36', 'original'],
    ]) {
      const other = await journey(t, sdk, sdk, 0, undefined, { suite })
      assert.equal(other.result.status, 0, other.result.stderr)
      assert.equal(other.commands.includes('share-sheet'), false, `${sdk} ${suite}`)
    }
  })

  // Spec Never: the android36-native-matrix workload does not change. Each shard runs the exact
  // pre-Story-6.9 command list, byte for byte, with only its own shard added to the matrix command;
  // native-matrix-shards.test.mjs proves the two shards report all 43 matrix cases.
  for (const shard of [1, 2])
    test(`API36 matrix shard ${shard} runs exactly the pre-Story-6.9 command list for its shard`, async (t) => {
      const { result, commands } = await journey(t, '36', '36', 0, undefined, {
        suite: `matrix-${shard}`,
      })
      assert.equal(result.status, 0, result.stderr)
      const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554'
      assert.equal(
        commands,
        [
          `adb -s ${serial} shell getprop ro.build.version.sdk`,
          'emulator -accel-check',
          `adb -s ${serial} install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`,
          `node scripts/run-story68-native.mjs open --platform android --device ${serial}`,
          `node scripts/run-story68-native.mjs signin --platform android --device ${serial}`,
          `node scripts/run-story68-native.mjs matrix --platform android --device ${serial} --shard ${shard}/2`,
          '',
        ].join('\n')
      )
    })

  test('API32 shard 1 reinitializes the owned app for its proof; shard 2 never does', async (t) => {
    const one = await journey(t, '32', '32', 0, undefined, { suite: 'all-1' })
    const two = await journey(t, '32', '32', 0, undefined, { suite: 'all-2' })
    assert.equal(one.result.status, 0, one.result.stderr)
    assert.equal(two.result.status, 0, two.result.stderr)
    assert.match(
      one.commands,
      /mjs proof --platform android --device \S+ --reinitialize-owned-app yes\n/
    )
    assert.doesNotMatch(two.commands, /reinitialize-owned-app|mjs proof /)
  })

  for (const [name, sdk, suite] of [
    ['an unpartitioned API36 run', '36', 'all'],
    ['an unsharded API32 run', '32', 'all'],
    ['a third API32 shard', '32', 'all-3'],
    ['an API32 shard on API36', '36', 'all-1'],
    ['the controls suite on API32', '32', 'controls'],
    ['an empty API36 suite', '36', ''],
    ['an unknown API36 suite', '36', 'browser'],
    ['an Android36 suite on API32', '32', 'matrix-1'],
    ['an unsharded API36 matrix', '36', 'matrix'],
    ['a third API36 matrix shard', '36', 'matrix-3'],
    ['an API36 matrix shard zero', '36', 'matrix-0'],
    ['an empty API32 suite', '32', ''],
    ['a mixed-case suite', '36', 'Matrix-1'],
  ]) {
    test(`${name} stops before install`, async (t) => {
      const { result, commands } = await journey(t, sdk, sdk, 0, undefined, { suite })
      assert.equal(result.status, 2)
      assert.match(result.stderr, /suite must match the verified Android API/)
      assert.doesNotMatch(commands, /install |node |bash |accel-check/)
    })
  }

  for (const [sdk, suite, failOn, later] of [
    ['36', 'matrix-1', 'mjs matrix ', null],
    ['36', 'matrix-2', 'mjs matrix ', null],
    ['36', 'original', 'mjs proof ', null],
    ['36', 'controls', 'mjs a11y ', 'fallback-focus'],
    ['36', 'interaction', 'mjs share-sheet ', 'android-release-font'],
    ['36', 'interaction', 'android-release-font', null],
    ['32', 'all-1', 'mjs proof ', 'mjs matrix '],
    ['32', 'all-1', 'mjs matrix ', 'rapid-watermark'],
    ['32', 'all-2', 'mjs permission-baseline ', 'mjs matrix '],
  ]) {
    test(`a failing ${failOn.trim()} command fails the API${sdk} ${suite} suite and stops later proofs`, async (t) => {
      const { result, commands } = await journey(t, sdk, sdk, 0, undefined, {
        suite,
        failOn,
      })
      assert.notEqual(result.status, 0)
      assert.ok(commands.includes(failOn))
      if (later) assert.equal(commands.includes(later), false, later)
    })
  }

  test('a failing sign-in stops every suite before its proofs', async (t) => {
    for (const [sdk, suite] of [
      ['36', 'matrix-1'],
      ['36', 'matrix-2'],
      ['36', 'original'],
      ['36', 'controls'],
      ['36', 'interaction'],
      ['32', 'all-1'],
      ['32', 'all-2'],
    ]) {
      const { result, commands } = await journey(t, sdk, sdk, 0, undefined, {
        suite,
        failOn: 'mjs signin ',
      })
      assert.notEqual(result.status, 0)
      for (const command of owned)
        assert.equal(commands.includes(`mjs ${command} `), false)
    }
  })
})

describe('Android KVM guard', () => {
  test('an emulator without usable KVM stops the journey before install', async (t) => {
    const { result, commands } = await journey(
      t,
      '32',
      '32',
      0,
      'KVM requires a CPU that supports vmx or svm'
    )
    assert.notEqual(result.status, 0)
    assert.match(commands, /emulator -accel-check/)
    assert.doesNotMatch(commands, /install |node |bash /)
  })

  test('Android CI stops before install unless the running emulator reports usable KVM', async () => {
    // The emulator binary exists only once android-emulator-runner has installed it.
    const workflow = await readFile('.github/workflows/pr-share-card-native.yml', 'utf8')
    assert.equal(workflow.includes('-accel-check'), false)
    const script = await readFile('scripts/ci/share-card-android.sh', 'utf8')
    const check = script.indexOf('"$ANDROID_HOME/emulator/emulator" -accel-check')
    assert.ok(check > 0 && check < script.indexOf('adb -s "$ANDROID_SERIAL" install'))
    assert.match(script, /grep -q 'KVM .* is installed and usable'/)
  })

  test('Android CI settles the KVM udev rule after the trigger and before the device test', async () => {
    const workflow = parse(
      await readFile('.github/workflows/pr-share-card-native.yml', 'utf8')
    )
    const step = workflow.jobs['original-resource'].steps.find(
      (row) => row.name === 'Enable and verify Android hardware acceleration'
    )
    const lines = step.run.split('\n').map((line) => line.trim())
    const trigger = lines.indexOf('sudo udevadm trigger --name-match=kvm')
    const settle = lines.findIndex((line) =>
      /^sudo udevadm settle --timeout=\d+$/.test(line)
    )
    const device = lines.indexOf('test -r /dev/kvm && test -w /dev/kvm')
    // trigger only queues the uevent, so the 0666 rule can land after an unsettled test.
    assert.ok(trigger >= 0 && settle > trigger && device > settle, step.run)
  })
})

describe('Android workflow wiring', () => {
  test('mandatory Android CI passes its matrix API to the fail-closed journey', async () => {
    const workflow = parse(
      await readFile('.github/workflows/pr-share-card-native.yml', 'utf8')
    )
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
    const android = steps.find(
      (step) => step.uses === 'reactivecircus/android-emulator-runner@v2'
    )
    assert.equal(android.env.CC68_ANDROID_API, '${{ matrix.api }}')
  })
})
