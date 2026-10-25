/**
 * Story 6.7b R18: a stalled Maestro `launchApp` fails at its own bound, named by
 * its step and the device's in-flight commands, long before the flow cap. See
 * scripts/lib/maestro-launch-watchdog.mjs.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  LAUNCH_APP_STALL_MS,
  createLaunchStallDetector,
  describeLaunchStall,
  deviceCommandsInFlight,
  launchStallError,
  openLaunchApp,
} from '../../../scripts/lib/maestro-launch-watchdog.mjs'
import { runMobileE2EFlow } from '../../../scripts/lib/mobile-e2e-flow-retry.mjs'

const RUNNER = 'maestro.cli.runner.CliConsoleListener'
const START = `00:21:44.310 [ INFO] ${RUNNER}.onCommandStart: Launch app "\${MAESTRO_APP_ID}" with clear state without stopping app RUNNING`
const CLEARING =
  '00:21:44.314 [ INFO] maestro.Maestro.clearAppState$lambda$8: Clearing app state host.exp.exponent'
const GRANT_FAILED = `00:23:43.494 [DEBUG] maestro.Maestro.setPermissionInternal: Failed to set permission android.permission.WRITE_SETTINGS for app host.exp.exponent: shell command failed (exit -1): ${'x'.repeat(400)}`
const LAUNCHING =
  '00:23:44.349 [ INFO] maestro.Maestro.launchApp$lambda$5: Launching app host.exp.exponent'
const DONE = `00:23:44.486 [ INFO] ${RUNNER}.onCommandFinished: Launch app "\${MAESTRO_APP_ID}" with clear state without stopping app COMPLETED`
const BEFORE = `00:21:44.306 [ INFO] ${RUNNER}.onCommandFinished: Run \${output.x = 1} COMPLETED`

const log = (...lines: string[]) => `${lines.join('\n')}\n`

describe('open launchApp in the debug log', () => {
  it('6.7b-R18-08 names the step from the last Maestro marker inside the launch', () => {
    expect(openLaunchApp(log(BEFORE, START))).toMatchObject({
      command: 'Launch app "${MAESTRO_APP_ID}" with clear state without stopping app',
      step: 'stopping the app or checking it is installed (am force-stop, pm list packages)',
      lastLine: START,
    })
    expect(openLaunchApp(log(BEFORE, START, CLEARING))).toMatchObject({
      step: 'clearing app state or granting permissions (pm clear, then one pm grant per permission)',
      lastLine: CLEARING,
    })
    const granting = openLaunchApp(
      log(
        START,
        CLEARING,
        GRANT_FAILED,
        'java.lang.SecurityException: managed by role',
        '\tat x'
      )
    )
    expect(granting?.step).toMatch(/^granting permissions/)
    expect(granting?.lastLine).toBe(`${GRANT_FAILED.slice(0, 240)}...`)
    expect(openLaunchApp(log(START, CLEARING, LAUNCHING))?.step).toBe(
      'starting the app (am start)'
    )
  })

  it('6.7b-R18-09 reports nothing once the newest launch has finished or before one starts', () => {
    expect(openLaunchApp(log(START, CLEARING, LAUNCHING, DONE))).toBeUndefined()
    expect(openLaunchApp(log(BEFORE))).toBeUndefined()
    expect(openLaunchApp('')).toBeUndefined()
  })
})

describe('launch stall detector', () => {
  it('6.7b-R18-10 fires once a launch has stayed open for the bound, and not before', () => {
    let clock = 0
    const detector = createLaunchStallDetector({ boundMs: 90_000, now: () => clock })
    expect(detector.observe(log(START, CLEARING))).toBeUndefined()
    clock = 89_999
    expect(detector.observe(log(START, CLEARING))).toBeUndefined()
    clock = 90_000
    const stall = detector.observe(log(START, CLEARING))
    expect(stall?.elapsedMs).toBe(90_000)
    expect(stall?.step).toMatch(/^clearing app state/)
  })

  it('6.7b-R18-11 times each launch on its own and forgets one that finished', () => {
    let clock = 0
    const detector = createLaunchStallDetector({ boundMs: 1_000, now: () => clock })
    expect(detector.observe(log(START))).toBeUndefined()
    clock = 900
    expect(detector.observe(log(START, CLEARING, LAUNCHING, DONE))).toBeUndefined()
    // A second launch later in the flow starts its own clock.
    clock = 1_500
    const second = log(START, CLEARING, LAUNCHING, DONE, BEFORE, START)
    expect(detector.observe(second)).toBeUndefined()
    clock = 2_400
    expect(detector.observe(second)).toBeUndefined()
    clock = 2_500
    expect(detector.observe(second)?.elapsedMs).toBe(1_000)
  })

  it('6.7b-R18-12 bounds a launch far below the 360 s flow cap', () => {
    expect(LAUNCH_APP_STALL_MS).toBe(90_000)
  })
})

describe('stall evidence', () => {
  it('6.7b-R18-13 lists the package and activity manager commands still on the device', () => {
    const ps = [
      'PID S ARGS',
      '1 S init',
      '6079 S /apex/com.android.art/bin/artd',
      '7001 S /system/bin/sh /system/bin/pm clear host.exp.exponent',
      '7002 S cmd package clear host.exp.exponent',
      '7003 S am start -a android.intent.action.VIEW',
      '7004 S com.google.android.apps.maps',
    ].join('\n')
    expect(deviceCommandsInFlight(ps)).toEqual([
      '7001 S /system/bin/sh /system/bin/pm clear host.exp.exponent',
      '7002 S cmd package clear host.exp.exponent',
      '7003 S am start -a android.intent.action.VIEW',
    ])
  })

  it('6.7b-R18-14 names the command, the step, the last log line and the device side', () => {
    const stall = { ...openLaunchApp(log(START, CLEARING))!, elapsedMs: 90_400 }
    expect(
      describeLaunchStall(stall, {
        device: 'emulator-5554',
        commands: ['7002 S cmd package clear host.exp.exponent'],
      })
    ).toBe(
      'Maestro\'s "Launch app "${MAESTRO_APP_ID}" with clear state without stopping app" ' +
        'stalled for 90 s while clearing app state or granting permissions (pm clear, then ' +
        `one pm grant per permission); last Maestro log line: ${CLEARING}; on emulator-5554 ` +
        'still running: 7002 S cmd package clear host.exp.exponent'
    )
    expect(describeLaunchStall(stall, { device: 'emulator-5554', commands: [] })).toMatch(
      /on emulator-5554 no package or activity manager command is running, so Maestro is waiting on its adb connection$/
    )
    expect(
      describeLaunchStall(stall, {
        device: 'emulator-5554',
        captureError: 'adb timed out',
      })
    ).toMatch(/on emulator-5554 the process list could not be read \(adb timed out\)$/)
  })

  it('6.7b-R18-22 fails the flow on a launch-stall kill without the watchdog retry', async () => {
    const message = describeLaunchStall(
      { ...openLaunchApp(log(START, CLEARING))!, elapsedMs: 90_000 },
      { device: 'emulator-5554', commands: [] }
    )
    const stall = launchStallError(message)
    expect(stall).toMatchObject({ message, stalled: true })
    expect('timedOut' in stall).toBe(false)

    const run = vi.fn(() => Promise.reject(stall))
    const reset = vi.fn(() => Promise.resolve())
    const onRetry = vi.fn()
    await expect(runMobileE2EFlow({ run, reset, onRetry })).rejects.toBe(stall)
    expect(run).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()

    // The 360 s flow cap still gets its single retry.
    const capped = Object.assign(new Error('maestro timed out after 360000ms'), {
      timedOut: true,
    })
    const cappedRun = vi.fn(() => Promise.reject(capped))
    await expect(runMobileE2EFlow({ run: cappedRun, reset, onRetry })).rejects.toBe(
      capped
    )
    expect(cappedRun).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
