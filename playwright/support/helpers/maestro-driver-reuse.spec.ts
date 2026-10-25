/**
 * Story 6.7 R62: the runner installs Maestro's Android driver once per device per run
 * and reuses it after checking it is complete. See scripts/lib/maestro-driver-reuse.mjs.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  MAESTRO_DRIVER_INSTRUMENTATION,
  MaestroDriverNotReady,
  createMaestroDriverReuse,
  missingMaestroDriverParts,
  launchShardedSuite,
  withTestOptions,
} from '../../../scripts/lib/maestro-driver-reuse.mjs'

const PACKAGES = 'package:dev.mobile.maestro\npackage:dev.mobile.maestro.test\n'
/** A single-device Android flow's arguments: driver reuse and the pinned port (R18). */
const PINNED = ['--no-reinstall-driver', '--driver-host-port', '17001']
const INSTRUMENTATION = [
  'instrumentation:androidx.test.services/.TestService (target=android)',
  `instrumentation:${MAESTRO_DRIVER_INSTRUMENTATION} (target=dev.mobile.maestro)`,
  '',
].join('\n')

/** A device whose driver packages appear and disappear as the fakes act on them. */
function fakeDevice(initial: string[] = []) {
  const packages = new Set(initial)
  const inspect = vi.fn((device: string) => {
    void device
    return Promise.resolve({
      packagesOutput: [...packages].map((name) => `package:${name}\n`).join(''),
      instrumentationOutput: packages.has('dev.mobile.maestro.test')
        ? INSTRUMENTATION
        : '',
    })
  })
  const uninstall = vi.fn((device: string, name: string) => {
    void device
    if (!packages.delete(name))
      return Promise.reject(new Error('Failure [not installed]'))
    return Promise.resolve()
  })
  /** What a Maestro invocation with --no-reinstall-driver leaves behind. */
  const maestroInstalls = () => {
    packages.add('dev.mobile.maestro')
    packages.add('dev.mobile.maestro.test')
  }
  return { packages, inspect, uninstall, maestroInstalls }
}

describe('Maestro driver reuse (R62)', () => {
  it('R62-01 removes a leftover driver before the first flow, then reuses the fresh one', async () => {
    const device = fakeDevice(['dev.mobile.maestro', 'dev.mobile.maestro.test'])
    const reuse = createMaestroDriverReuse(device)
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual(PINNED)
    // The test app goes first: it targets the driver app.
    expect(device.uninstall.mock.calls).toEqual([
      ['emulator-5554', 'dev.mobile.maestro.test'],
      ['emulator-5554', 'dev.mobile.maestro'],
    ])
    expect(device.packages.size).toBe(0)
    device.maestroInstalls()
    reuse.recordInvocation('android', 'emulator-5554')
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual(PINNED)
    expect(device.uninstall).toHaveBeenCalledTimes(2)
    // Another device has its own first flow.
    expect(await reuse.argsFor('android', 'emulator-5556')).toEqual(PINNED)
    expect(device.uninstall).toHaveBeenCalledTimes(4)
  })

  it('R62-02 starts fresh on a device that has no driver yet', async () => {
    const device = fakeDevice()
    const reuse = createMaestroDriverReuse(device)
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual(PINNED)
  })

  it('R62-03 leaves iOS on Maestro defaults', async () => {
    const device = fakeDevice()
    const reuse = createMaestroDriverReuse(device)
    reuse.recordInvocation('ios', 'booted')
    expect(await reuse.argsFor('ios', 'booted')).toEqual([])
    expect(device.inspect).not.toHaveBeenCalled()
    expect(device.uninstall).not.toHaveBeenCalled()
  })

  it('R62-04 names every missing part, fails that flow, and starts the next one fresh', async () => {
    const device = fakeDevice()
    const reuse = createMaestroDriverReuse(device)
    await reuse.argsFor('android', 'emulator-5554')
    // The invocation ran but its install stopped after the driver app (run 40081299288).
    device.packages.add('dev.mobile.maestro')
    reuse.recordInvocation('android', 'emulator-5554')
    const failure: unknown = await reuse
      .argsFor('android', 'emulator-5554')
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MaestroDriverNotReady)
    expect((failure as Error).message).toBe(
      'Maestro driver not ready on emulator-5554: package dev.mobile.maestro.test is not installed; ' +
        `instrumentation ${MAESTRO_DRIVER_INSTRUMENTATION} is not registered`
    )
    device.uninstall.mockClear()
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual(PINNED)
    expect(device.uninstall).toHaveBeenCalledTimes(2)
    expect(device.packages.size).toBe(0)
  })

  it('R62-05 refuses a first flow whose leftover driver could not be removed', async () => {
    const device = fakeDevice(['dev.mobile.maestro'])
    device.uninstall.mockImplementation(() => Promise.reject(new Error('Failure')))
    const reuse = createMaestroDriverReuse(device)
    await expect(reuse.argsFor('android', 'emulator-5554')).rejects.toThrow(
      'Maestro driver not ready on emulator-5554: package dev.mobile.maestro could not be removed before a fresh install'
    )
  })

  it('R62-06 fails closed when adb cannot list the driver', async () => {
    const device = fakeDevice()
    const reuse = createMaestroDriverReuse({
      ...device,
      inspect: () => Promise.reject(new Error('device offline')),
    })
    await expect(reuse.argsFor('android', 'emulator-5554')).rejects.toThrow(
      'Maestro driver not ready on emulator-5554: adb could not list the driver (device offline)'
    )
    reuse.recordInvocation('android', 'emulator-5554')
    await expect(reuse.argsFor('android', 'emulator-5554')).rejects.toThrow(
      'Maestro driver not ready on emulator-5554: adb could not list the driver (device offline)'
    )
  })

  it('6.7b-R18-15 settles the device before every Android flow and names a settle failure', async () => {
    const device = fakeDevice()
    const settle = vi.fn((serial: string, port: number | null) => {
      void serial
      void port
      return Promise.resolve()
    })
    const reuse = createMaestroDriverReuse({ ...device, settle })
    await reuse.argsFor('android', 'emulator-5554')
    device.maestroInstalls()
    reuse.recordInvocation('android', 'emulator-5554')
    await reuse.argsFor('android', 'emulator-5554')
    expect(settle.mock.calls).toEqual([
      ['emulator-5554', 17001],
      ['emulator-5554', 17001],
    ])

    settle.mockImplementation(() =>
      Promise.reject(new Error('device port 17001 on emulator-5554 is still in use'))
    )
    await expect(reuse.argsFor('android', 'emulator-5554')).rejects.toThrow(
      'Maestro driver not ready on emulator-5554: device port 17001 on emulator-5554 is still in use'
    )
    expect(await reuse.argsFor('ios', 'booted')).toEqual([])
    expect(settle).toHaveBeenCalledTimes(3)

    // Each device of a per-device shard run gets its own pinned port, settled there.
    settle.mockImplementation(() => Promise.resolve())
    expect(
      await reuse.argsFor('android', 'emulator-5556', { driverPort: 17002 })
    ).toEqual(['--no-reinstall-driver', '--driver-host-port', '17002'])
    expect(settle).toHaveBeenLastCalledWith('emulator-5556', 17002)
    // Without a pinned port Maestro picks one, and the settle step skips the port check.
    expect(await reuse.argsFor('android', 'emulator-5558', { driverPort: null })).toEqual(
      ['--no-reinstall-driver']
    )
    expect(settle).toHaveBeenLastCalledWith('emulator-5558', null)
  })

  it('R62-07 reads only exact package and instrumentation lines', () => {
    expect(missingMaestroDriverParts(PACKAGES, INSTRUMENTATION)).toEqual([])
    // A prefix match is not the package, and an instrumentation for another target is
    // not the driver's.
    expect(
      missingMaestroDriverParts(
        'package:dev.mobile.maestro.testing\npackage:dev.mobile.maestro\n',
        `instrumentation:${MAESTRO_DRIVER_INSTRUMENTATION}X (target=dev.mobile.maestro)\n`
      )
    ).toEqual([
      'package dev.mobile.maestro.test is not installed',
      `instrumentation ${MAESTRO_DRIVER_INSTRUMENTATION} is not registered`,
    ])
  })

  it('R62-08 places the option right after the test subcommand', () => {
    expect(
      withTestOptions(
        [
          '--platform',
          'android',
          '--udid',
          'emulator-5554',
          'test',
          '-e',
          'A=1',
          'flow.yaml',
        ],
        ['--no-reinstall-driver']
      )
    ).toEqual([
      '--platform',
      'android',
      '--udid',
      'emulator-5554',
      'test',
      '--no-reinstall-driver',
      '-e',
      'A=1',
      'flow.yaml',
    ])
    expect(withTestOptions(['test', 'flow.yaml'], [])).toEqual(['test', 'flow.yaml'])
  })
})

/** Several devices, each with its own driver packages. */
function fakeFleet(devices: string[]) {
  const packages = new Map(devices.map((device) => [device, new Set<string>()]))
  const on = (device: string) => {
    const set = packages.get(device)
    if (!set) throw new Error(`unknown device ${device}`)
    return set
  }
  const inspect = vi.fn((device: string) =>
    Promise.resolve({
      packagesOutput: [...on(device)].map((name) => `package:${name}\n`).join(''),
      instrumentationOutput: on(device).has('dev.mobile.maestro.test')
        ? INSTRUMENTATION
        : '',
    })
  )
  const uninstall = vi.fn((device: string, name: string) => {
    on(device).delete(name)
    return Promise.resolve()
  })
  const maestroInstallsOn = (device: string) => {
    on(device).add('dev.mobile.maestro')
    on(device).add('dev.mobile.maestro.test')
  }
  return { packages, inspect, uninstall, maestroInstallsOn }
}

describe('Maestro driver lifecycle on the parallel shard path (R68)', () => {
  const DEVICES = ['emulator-5554', 'emulator-5556']
  const ARGS = [
    '--platform',
    'android',
    '--udid',
    DEVICES.join(','),
    'test',
    '--shard-split',
    '2',
    'maestro/a.yaml',
    'maestro/b.yaml',
  ]

  it('R68-01 prepares both shard devices, launches once with the option, and lets the user-scoped flow reuse the driver', async () => {
    const fleet = fakeFleet(DEVICES)
    const reuse = createMaestroDriverReuse(fleet)
    const run = vi.fn((args: string[]) => {
      // Both devices were cleared before the launch.
      expect(fleet.uninstall.mock.calls.map(([device]) => device)).toEqual([
        'emulator-5554',
        'emulator-5554',
        'emulator-5556',
        'emulator-5556',
      ])
      // Several devices: one fixed host port cannot serve them all, so Maestro picks.
      expect(args.slice(4, 7)).toEqual(['test', '--no-reinstall-driver', '--shard-split'])
      for (const device of DEVICES) fleet.maestroInstallsOn(device)
      return Promise.resolve()
    })
    expect(
      await launchShardedSuite({
        reuse,
        platform: 'android',
        devices: DEVICES,
        args: ARGS,
        run,
      })
    ).toEqual({ exitError: undefined })
    expect(run).toHaveBeenCalledOnce()

    // The user-scoped pass on device zero checks the driver and reuses it.
    fleet.uninstall.mockClear()
    fleet.inspect.mockClear()
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual(PINNED)
    expect(fleet.uninstall).not.toHaveBeenCalled()
    expect(fleet.inspect).toHaveBeenCalledWith('emulator-5554')
  })

  it('R68-02 launches nothing when a shard device cannot be prepared, and names it', async () => {
    const fleet = fakeFleet(DEVICES)
    fleet.packages.get('emulator-5556')?.add('dev.mobile.maestro')
    fleet.uninstall.mockImplementation((device: string, name: string) => {
      if (device === 'emulator-5554') fleet.packages.get(device)?.delete(name)
      return Promise.reject(new Error('Failure'))
    })
    const reuse = createMaestroDriverReuse(fleet)
    const run = vi.fn(() => Promise.resolve())
    expect(
      await launchShardedSuite({
        reuse,
        platform: 'android',
        devices: DEVICES,
        args: ARGS,
        run,
      })
    ).toEqual({
      refused:
        'Maestro driver not ready on emulator-5556: package dev.mobile.maestro could not be removed before a fresh install',
    })
    expect(run).not.toHaveBeenCalled()
    // Nothing ran, so the next flow on device zero starts fresh rather than reusing.
    fleet.uninstall.mockClear()
    fleet.uninstall.mockImplementation(() => Promise.resolve())
    await reuse.argsFor('android', 'emulator-5554')
    expect(fleet.uninstall).toHaveBeenCalledTimes(2)
  })

  it("R68-03 returns Maestro's failure and still records every shard device", async () => {
    const fleet = fakeFleet(DEVICES)
    const reuse = createMaestroDriverReuse(fleet)
    const failure = new Error('maestro exited with code 1')
    const outcome = await launchShardedSuite({
      reuse,
      platform: 'android',
      devices: DEVICES,
      args: ARGS,
      run: () => {
        for (const device of DEVICES) fleet.maestroInstallsOn(device)
        return Promise.reject(failure)
      },
    })
    expect(outcome).toEqual({ exitError: failure })
    fleet.uninstall.mockClear()
    expect(await reuse.argsFor('android', 'emulator-5556')).toEqual(PINNED)
    expect(fleet.uninstall).not.toHaveBeenCalled()
  })

  it('R68-04 leaves an iOS shard launch on Maestro defaults', async () => {
    const fleet = fakeFleet(DEVICES)
    const reuse = createMaestroDriverReuse(fleet)
    const run = vi.fn(() => Promise.resolve())
    await launchShardedSuite({
      reuse,
      platform: 'ios',
      devices: DEVICES,
      args: ARGS,
      run,
    })
    expect(run).toHaveBeenCalledWith(ARGS)
    expect(fleet.uninstall).not.toHaveBeenCalled()
  })
})
