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
  accel = 'KVM (version 12) is installed and usable.'
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc68-sdk-guard-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const capture = path.join(directory, 'commands')
  for (const binary of ['adb', 'node', 'bash']) {
    await writeFile(
      path.join(directory, binary),
      `#!/bin/bash\nprintf '%s %s\\n' '${binary}' "$*" >> "$CAPTURE"\nif [[ "$*" == *getprop* ]]; then printf '%s\\n' "$SDK"; exit "$SDK_STATUS"; fi\n`,
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

  for (const sdk of ['32', '36']) {
    test(`Android API ${sdk} executes every required native path after one verified probe`, async (t) => {
      const { result, commands } = await journey(t, `${sdk}\r`, sdk)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(commands.match(/getprop/g)?.length, 1)
      for (const command of ['open', 'signin', 'proof', 'matrix', 'rapid-watermark'])
        assert.match(commands, new RegExp(`mjs ${command} `))
      assert.equal(commands.includes('mjs a11y '), sdk === '36')
      assert.equal(commands.includes('mjs fallback-focus '), sdk === '36')
      assert.equal(
        commands.includes('bash scripts/ci/share-card-android-release-font.sh'),
        sdk === '36'
      )
    })
  }
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
