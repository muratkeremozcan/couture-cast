/**
 * Story 1.2b R28: the runner starts no Android flow until a `pm clear` probe
 * completes within its bound, and captures the device state for every probe
 * that does not. See scripts/lib/package-manager-readiness.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SLOW_PROBE_CAPTURES,
  captureSlowProbeState,
  resolveProbeSerials,
  saveDiagnostic,
  waitForPackageManagerReady,
} from '../../../scripts/lib/package-manager-readiness.mjs'

type Probe = (signal: AbortSignal) => Promise<{ code: number | null; output: string }>

/** A probe that never answers until its signal aborts, like a blocked pm clear. */
const blocked: Probe = (signal) =>
  new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve({ code: null, output: 'killed' }))
  )
const quick: Probe = () => Promise.resolve({ code: 0, output: 'Success\n' })
const answers =
  (code: number | null, output: string): Probe =>
  () =>
    Promise.resolve({ code, output })
const noWait = () => Promise.resolve()

let directory: string | undefined
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('package manager readiness probe', () => {
  it('1.2b-R28-05 proceeds after one quick probe without capturing anything', async () => {
    const onUnreadyProbe = vi.fn()
    const log = vi.fn()

    const result = await waitForPackageManagerReady({
      runProbe: quick,
      onUnreadyProbe,
      log,
      probeTimeoutMs: 1_000,
    })

    expect(result.attempts).toBe(1)
    expect(onUnreadyProbe).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Package manager ready: pm clear probe 1 succeeded in \d+ ms$/
      )
    )
  })

  it('1.2b-R28-06 kills a blocked probe, captures it, and waits for a quick one', async () => {
    const probes = [blocked, blocked, quick]
    const runProbe = vi.fn<Probe>((signal) => probes.shift()!(signal))
    const onUnreadyProbe = vi.fn()
    const log = vi.fn()

    const result = await waitForPackageManagerReady({
      runProbe,
      onUnreadyProbe,
      log,
      probeTimeoutMs: 30,
      overallTimeoutMs: 10_000,
      sleep: noWait,
    })

    expect(result.attempts).toBe(3)
    expect(result.durationsMs).toHaveLength(3)
    expect(onUnreadyProbe.mock.calls).toEqual([[1], [2]])
    // Every blocked probe was told to stop.
    for (const [signal] of runProbe.mock.calls.slice(0, 2))
      expect(signal.aborted).toBe(true)
    expect(log.mock.calls.map(([message]) => String(message).split(':')[0])).toEqual([
      'Package manager not ready',
      'Package manager not ready',
      'Package manager ready',
    ])
  })

  it('1.2b-R28-07 fails with every probe outcome once the overall bound passes', async () => {
    let clock = 0
    const onUnreadyProbe = vi.fn(() => {
      clock += 40
    })

    await expect(
      waitForPackageManagerReady({
        runProbe: blocked,
        onUnreadyProbe,
        log: () => undefined,
        probeTimeoutMs: 10,
        overallTimeoutMs: 100,
        now: () => clock,
        sleep: noWait,
      })
    ).rejects.toThrow(
      /never answered pm clear with Success in 100 ms \(probe 1 did not complete within 10 ms; probe 2 /
    )
    expect(onUnreadyProbe).toHaveBeenCalledTimes(3)
  })

  it('1.2b-R28-08 saves logcat, processes and package and activity dumps for a slow probe', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-readiness-'))
    const run = vi.fn((_adb: string, args: string[]) =>
      Promise.resolve({ code: 0, output: `output of ${args.slice(2).join(' ')}` })
    )

    await captureSlowProbeState({
      adbBinary: '/sdk/adb',
      serial: 'emulator-5554',
      artifactDir: directory,
      attempt: 2,
      log: () => undefined,
      run,
    })

    for (const [name, args] of SLOW_PROBE_CAPTURES) {
      expect(run).toHaveBeenCalledWith(
        '/sdk/adb',
        ['-s', 'emulator-5554', ...args],
        expect.any(AbortSignal)
      )
      const file = path.join(directory, `pm-readiness-emulator-5554-probe-2-${name}.txt`)
      expect(fs.readFileSync(file, 'utf8')).toBe(`output of ${args.join(' ')}`)
    }
    expect(SLOW_PROBE_CAPTURES.map(([name]) => name)).toEqual([
      'logcat',
      'processes',
      'package',
      'activity-processes',
    ])
  })
  it.each([
    ['a fast non-zero exit', answers(1, "Error: Can't find service: package")],
    ['an adb that would not start', answers(null, 'Error: spawn adb ENOENT')],
    ['adb reporting the device offline', answers(1, 'error: device offline')],
    ['exit 0 without Success', answers(0, 'Failed')],
  ])(
    '1.2b-R29-01 keeps waiting through %s and only proceeds on Success',
    async (_name, failing) => {
      const probes = [failing, failing, quick]
      const onUnreadyProbe = vi.fn()
      const log = vi.fn()

      const result = await waitForPackageManagerReady({
        runProbe: (signal) => probes.shift()!(signal),
        onUnreadyProbe,
        log,
        probeTimeoutMs: 1_000,
        sleep: noWait,
      })

      expect(result.attempts).toBe(3)
      expect(onUnreadyProbe.mock.calls).toEqual([[1], [2]])
      expect(String(log.mock.calls[0]?.[0])).toMatch(
        /^Package manager not ready: pm clear probe 1 exited/
      )
      expect(String(log.mock.calls[2]?.[0])).toMatch(/^Package manager ready/)
    }
  )

  it('1.2b-R29-02 pauses between unready probes so a fast failure does not spin', async () => {
    const probes = [answers(1, 'error: device offline'), quick]
    const sleep = vi.fn(() => Promise.resolve())

    await waitForPackageManagerReady({
      runProbe: (signal) => probes.shift()!(signal),
      onUnreadyProbe: () => undefined,
      log: () => undefined,
      retryDelayMs: 2_000,
      sleep,
    })

    expect(sleep).toHaveBeenCalledExactlyOnceWith(2_000)
  })

  it.each([
    [
      'an intended device that is offline',
      ['emulator-5554'],
      [['emulator-5554', 'offline']],
      /emulator-5554 offline/,
    ],
    [
      'an intended device adb does not list',
      ['emulator-5556'],
      [['emulator-5554', 'device']],
      /emulator-5556 missing/,
    ],
    [
      'no named device and none ready',
      [],
      [['emulator-5554', 'unauthorized']],
      /adb reports 0 ready \(emulator-5554 unauthorized\)/,
    ],
    [
      'no named device and two ready',
      [],
      [
        ['emulator-5554', 'device'],
        ['emulator-5556', 'device'],
      ],
      /adb reports 2 ready/,
    ],
  ])('1.2b-R29-03 refuses to skip %s', (_name, intended, states, message) => {
    expect(() =>
      resolveProbeSerials(intended, new Map(states as [string, string][]))
    ).toThrow(message)
  })

  it('1.2b-R29-04 probes the intended devices, or the single ready one', () => {
    const states = new Map([
      ['emulator-5554', 'device'],
      ['emulator-5556', 'device'],
    ])
    expect(resolveProbeSerials(['emulator-5556', 'emulator-5554'], states)).toEqual([
      'emulator-5556',
      'emulator-5554',
    ])
    expect(resolveProbeSerials([], new Map([['emulator-5554', 'device']]))).toEqual([
      'emulator-5554',
    ])
  })

  it('1.2b-R29-05 logs a capture that cannot be written and still finishes the round', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-readiness-'))
    // A file where the capture directory should be makes every write fail.
    const blockedDir = path.join(directory, 'not-a-directory')
    fs.writeFileSync(blockedDir, '')
    const run = vi.fn(() => Promise.resolve({ code: 0, output: 'dump' }))
    const log = vi.fn()

    await expect(
      captureSlowProbeState({
        adbBinary: '/sdk/adb',
        serial: 'emulator-5554',
        artifactDir: path.join(blockedDir, 'captures'),
        attempt: 1,
        log,
        run,
      })
    ).resolves.toBeUndefined()

    expect(run).toHaveBeenCalledTimes(SLOW_PROBE_CAPTURES.length)
    const messages = log.mock.calls.map(([message]) => String(message))
    expect(messages).toHaveLength(SLOW_PROBE_CAPTURES.length)
    SLOW_PROBE_CAPTURES.forEach(([name], index) => {
      expect(messages[index]).toMatch(
        new RegExp(`^Could not save ${name} for pm clear probe 1`)
      )
    })
  })

  it('1.2b-R29-06 a capture write error never escapes saveDiagnostic', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-readiness-'))
    const file = path.join(directory, 'file')
    fs.writeFileSync(file, '')
    const log = vi.fn()

    expect(
      saveDiagnostic(path.join(file, 'child.txt'), 'x', log, 'the window stack')
    ).toBe(false)
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^Could not save the window stack to /)
    expect(
      saveDiagnostic(path.join(directory, 'ok', 'a.txt'), 'x', log, 'a capture')
    ).toBe(true)
  })
})
