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
  waitForPackageManagerReady,
} from '../../../scripts/lib/package-manager-readiness.mjs'

type Probe = (signal: AbortSignal) => Promise<{ code: number | null; output: string }>

/** A probe that never answers until its signal aborts, like a blocked pm clear. */
const blocked: Probe = (signal) =>
  new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve({ code: null, output: 'killed' }))
  )
const quick: Probe = () => Promise.resolve({ code: 0, output: 'Success\n' })

let directory: string | undefined
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('package manager readiness probe', () => {
  it('1.2b-R28-05 proceeds after one quick probe without capturing anything', async () => {
    const onSlowProbe = vi.fn()
    const log = vi.fn()

    const result = await waitForPackageManagerReady({
      runProbe: quick,
      onSlowProbe,
      log,
      probeTimeoutMs: 1_000,
    })

    expect(result.attempts).toBe(1)
    expect(onSlowProbe).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Package manager ready: pm clear probe 1 completed in \d+ ms \(exit 0, Success\)$/
      )
    )
  })

  it('1.2b-R28-06 kills a blocked probe, captures it, and waits for a quick one', async () => {
    const probes = [blocked, blocked, quick]
    const runProbe = vi.fn<Probe>((signal) => probes.shift()!(signal))
    const onSlowProbe = vi.fn()
    const log = vi.fn()

    const result = await waitForPackageManagerReady({
      runProbe,
      onSlowProbe,
      log,
      probeTimeoutMs: 30,
      overallTimeoutMs: 10_000,
    })

    expect(result.attempts).toBe(3)
    expect(result.durationsMs).toHaveLength(3)
    expect(onSlowProbe.mock.calls).toEqual([[1], [2]])
    // Every blocked probe was told to stop.
    for (const [signal] of runProbe.mock.calls.slice(0, 2))
      expect(signal.aborted).toBe(true)
    expect(log.mock.calls.map(([message]) => String(message).split(':')[0])).toEqual([
      'Package manager not ready',
      'Package manager not ready',
      'Package manager ready',
    ])
  })

  it('1.2b-R28-07 fails with every probe duration once the overall bound passes', async () => {
    let clock = 0
    const onSlowProbe = vi.fn(() => {
      clock += 40
    })

    await expect(
      waitForPackageManagerReady({
        runProbe: blocked,
        onSlowProbe,
        log: () => undefined,
        probeTimeoutMs: 10,
        overallTimeoutMs: 100,
        now: () => clock,
      })
    ).rejects.toThrow(
      /never answered pm clear within 10 ms in 100 ms \(probe durations: /
    )
    expect(onSlowProbe).toHaveBeenCalledTimes(3)
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
})
