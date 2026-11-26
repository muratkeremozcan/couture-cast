// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): the runner endpoint behind 7.9-NVIS-005..008 (live dark flip).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appearanceCommands,
  MAX_BODY_BYTES,
  nightModeCommands,
  startDeviceAppearanceEndpoint,
  statusBarDemoCommands,
} from './device-appearance-endpoint.mjs'

const DEVICE = 'emulator-5554'

test('[7.9-NVIS-U01] night mode runs exactly cmd uimode night on the named device', () => {
  assert.deepEqual(nightModeCommands(DEVICE, 'yes'), [
    ['-s', DEVICE, 'shell', 'cmd', 'uimode', 'night', 'yes'],
  ])
  assert.deepEqual(
    appearanceCommands('/night', { device: DEVICE, mode: 'no' }, [DEVICE]),
    {
      commands: [['-s', DEVICE, 'shell', 'cmd', 'uimode', 'night', 'no']],
    }
  )
})

test('[7.9-NVIS-U02] status bar demo fixes the clock at 12:00 and hides notifications', () => {
  const commands = statusBarDemoCommands(DEVICE, true).map((args) => args.join(' '))
  assert.equal(commands[0], `-s ${DEVICE} shell settings put global sysui_demo_allowed 1`)
  assert.ok(
    commands.includes(
      `-s ${DEVICE} shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200`
    )
  )
  assert.ok(
    commands.includes(
      `-s ${DEVICE} shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false`
    )
  )
  assert.deepEqual(
    statusBarDemoCommands(DEVICE, false).map((args) => args.join(' ')),
    [`-s ${DEVICE} shell am broadcast -a com.android.systemui.demo -e command exit`]
  )
})

test('[7.9-NVIS-U03] refuses an unknown device, an unknown mode and an unknown route', () => {
  assert.deepEqual(
    appearanceCommands('/night', { device: 'other', mode: 'yes' }, [DEVICE]),
    {
      status: 400,
      message: 'Unknown device other',
    }
  )
  assert.equal(
    'status' in appearanceCommands('/night', { device: DEVICE, mode: 'auto' }, [DEVICE]),
    true
  )
  assert.equal(
    'status' in
      appearanceCommands('/status-bar', { device: DEVICE, demo: 'yes' }, [DEVICE]),
    true
  )
  assert.deepEqual(appearanceCommands('/shell', { device: DEVICE }, [DEVICE]), {
    status: 404,
    message: 'No route /shell',
  })
})

test('[7.9-NVIS-U04] the endpoint runs the commands in order and reports adb failures as 502', async () => {
  const ran = []
  let fail = false
  const endpoint = await startDeviceAppearanceEndpoint({
    adbBinary: 'adb',
    devices: [DEVICE],
    run: async (binary, args) => {
      ran.push([binary, ...args].join(' '))
      return fail
        ? { code: 1, output: 'Error: device offline' }
        : { code: 0, output: 'ok\n' }
    },
  })
  try {
    assert.match(endpoint.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    const ok = await fetch(`${endpoint.url}/night`, {
      method: 'POST',
      body: JSON.stringify({ device: DEVICE, mode: 'yes' }),
    })
    assert.equal(ok.status, 200)
    assert.deepEqual(ran, [`adb -s ${DEVICE} shell cmd uimode night yes`])

    fail = true
    const broken = await fetch(`${endpoint.url}/night`, {
      method: 'POST',
      body: JSON.stringify({ device: DEVICE, mode: 'no' }),
    })
    assert.equal(broken.status, 502)
    assert.match(await broken.text(), /device offline/)

    const notJson = await fetch(`${endpoint.url}/night`, {
      method: 'POST',
      body: 'night',
    })
    assert.equal(notJson.status, 400)
    const get = await fetch(`${endpoint.url}/night`)
    assert.equal(get.status, 405)
  } finally {
    await endpoint.close()
  }
})

test('[7.9-NVIS-U14] malformed requests get fixed answers and never break the server (Codex P3-3)', async () => {
  // A device value whose toString is not callable would throw if it were stringified.
  assert.deepEqual(
    appearanceCommands('/night', { device: { toString: 1 }, mode: 'yes' }, [DEVICE]),
    { status: 400, message: 'device must be a string' }
  )
  assert.deepEqual(appearanceCommands('/night', null, [DEVICE]), {
    status: 400,
    message: 'device must be a string',
  })
  const endpoint = await startDeviceAppearanceEndpoint({
    adbBinary: 'adb',
    devices: [DEVICE],
    run: async () => {
      throw new Error('runner exploded')
    },
  })
  try {
    const odd = await fetch(`${endpoint.url}/night`, {
      method: 'POST',
      body: JSON.stringify({ device: { toString: 1 }, mode: 'yes' }),
    })
    assert.equal(odd.status, 400)
    const huge = await fetch(`${endpoint.url}/night`, {
      method: 'POST',
      body: 'x'.repeat(MAX_BODY_BYTES + 1),
    })
    assert.equal(huge.status, 413)
    const failed = await fetch(`${endpoint.url}/night`, {
      method: 'POST',
      body: JSON.stringify({ device: DEVICE, mode: 'yes' }),
    })
    assert.equal(failed.status, 500)
    // Still serving after all three.
    const after = await fetch(`${endpoint.url}/night`, { method: 'GET' })
    assert.equal(after.status, 405)
  } finally {
    await endpoint.close()
  }
})
