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
  withTestOptions,
} from '../../../scripts/lib/maestro-driver-reuse.mjs'

const PACKAGES = 'package:dev.mobile.maestro\npackage:dev.mobile.maestro.test\n'
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
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([
      '--no-reinstall-driver',
    ])
    // The test app goes first: it targets the driver app.
    expect(device.uninstall.mock.calls).toEqual([
      ['emulator-5554', 'dev.mobile.maestro.test'],
      ['emulator-5554', 'dev.mobile.maestro'],
    ])
    expect(device.packages.size).toBe(0)
    device.maestroInstalls()
    reuse.recordInvocation('android', 'emulator-5554')
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([
      '--no-reinstall-driver',
    ])
    expect(device.uninstall).toHaveBeenCalledTimes(2)
    // Another device has its own first flow.
    expect(await reuse.argsFor('android', 'emulator-5556')).toEqual([
      '--no-reinstall-driver',
    ])
    expect(device.uninstall).toHaveBeenCalledTimes(4)
  })

  it('R62-02 starts fresh on a device that has no driver yet', async () => {
    const device = fakeDevice()
    const reuse = createMaestroDriverReuse(device)
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([
      '--no-reinstall-driver',
    ])
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
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([
      '--no-reinstall-driver',
    ])
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
