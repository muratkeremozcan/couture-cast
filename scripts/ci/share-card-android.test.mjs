// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { parse } from 'yaml'

async function journey(
  t,
  sdk,
  expected = '36',
  status = 0,
  accel = 'KVM (version 12) is installed and usable.',
  { suite = sdk.trim() === '32' ? 'all' : 'matrix', failOn = '' } = {}
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
    ['32', 'all', ['proof', 'matrix', 'rapid-watermark'], []],
    ['36', 'matrix', ['matrix'], []],
    ['36', 'original', ['proof'], []],
    [
      '36',
      'interaction',
      ['rapid-watermark', 'a11y', 'fallback-focus'],
      ['bash scripts/ci/share-card-android-release-font.sh'],
    ],
  ]
  const owned = ['proof', 'matrix', 'rapid-watermark', 'a11y', 'fallback-focus']
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

  test('the Android36 partitions together cover every proof command exactly once', async (t) => {
    const ran = []
    for (const suite of ['matrix', 'original', 'interaction']) {
      const { result, commands } = await journey(t, '36', '36', 0, undefined, { suite })
      assert.equal(result.status, 0, result.stderr)
      ran.push(
        ...[...owned, 'font'].filter((command) =>
          commands.includes(command === 'font' ? font : `mjs ${command} `)
        )
      )
    }
    // The pre-split API36 journey: proof, matrix, rapid, a11y, fallback and Release font.
    assert.deepEqual([...ran].sort(), [
      'a11y',
      'fallback-focus',
      'font',
      'matrix',
      'proof',
      'rapid-watermark',
    ])
  })

  for (const [name, sdk, suite] of [
    ['an unpartitioned API36 run', '36', 'all'],
    ['an empty API36 suite', '36', ''],
    ['an unknown API36 suite', '36', 'browser'],
    ['an Android36 suite on API32', '32', 'matrix'],
    ['an empty API32 suite', '32', ''],
    ['a mixed-case suite', '36', 'Matrix'],
  ]) {
    test(`${name} stops before install`, async (t) => {
      const { result, commands } = await journey(t, sdk, sdk, 0, undefined, { suite })
      assert.equal(result.status, 2)
      assert.match(result.stderr, /suite must match the verified Android API/)
      assert.doesNotMatch(commands, /install |node |bash |accel-check/)
    })
  }

  for (const [suite, failOn] of [
    ['matrix', 'mjs matrix '],
    ['original', 'mjs proof '],
    ['interaction', 'mjs a11y '],
    ['interaction', 'android-release-font'],
  ]) {
    test(`a failing ${failOn.trim()} command fails the ${suite} suite and stops later proofs`, async (t) => {
      const { result, commands } = await journey(t, '36', '36', 0, undefined, {
        suite,
        failOn,
      })
      assert.notEqual(result.status, 0)
      assert.ok(commands.includes(failOn))
      if (failOn === 'mjs a11y ') assert.equal(commands.includes('fallback-focus'), false)
    })
  }

  test('a failing sign-in stops every suite before its proofs', async (t) => {
    for (const suite of ['matrix', 'original', 'interaction']) {
      const { result, commands } = await journey(t, '36', '36', 0, undefined, {
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
