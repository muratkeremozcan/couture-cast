/**
 * Story 6.7 R62: the runner reinstalls Maestro's Android driver once per device per run
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
const complete = () =>
  Promise.resolve({ packagesOutput: PACKAGES, instrumentationOutput: INSTRUMENTATION })

describe('Maestro driver reuse (R62)', () => {
  it('R62-01 reinstalls on the first flow of a device and reuses the driver after it', async () => {
    const inspect = vi.fn(complete)
    const reuse = createMaestroDriverReuse({ inspect })
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([])
    expect(inspect).not.toHaveBeenCalled()
    reuse.recordInvocation('android', 'emulator-5554')
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([
      '--no-reinstall-driver',
    ])
    expect(inspect).toHaveBeenCalledWith('emulator-5554')
    // Another device has its own first flow.
    expect(await reuse.argsFor('android', 'emulator-5556')).toEqual([])
  })

  it('R62-02 leaves iOS on the default reinstall', async () => {
    const inspect = vi.fn(complete)
    const reuse = createMaestroDriverReuse({ inspect })
    reuse.recordInvocation('ios', 'booted')
    expect(await reuse.argsFor('ios', 'booted')).toEqual([])
    expect(inspect).not.toHaveBeenCalled()
  })

  it('R62-03 names every missing part, fails that flow, and reinstalls on the next', async () => {
    const inspect = vi.fn().mockResolvedValueOnce({
      packagesOutput: 'package:dev.mobile.maestro\n',
      instrumentationOutput:
        'instrumentation:androidx.test.services/.TestService (target=android)\n',
    })
    const reuse = createMaestroDriverReuse({ inspect })
    reuse.recordInvocation('android', 'emulator-5554')
    const failure: unknown = await reuse
      .argsFor('android', 'emulator-5554')
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MaestroDriverNotReady)
    expect((failure as Error).message).toBe(
      'Maestro driver not ready on emulator-5554: package dev.mobile.maestro.test is not installed; ' +
        `instrumentation ${MAESTRO_DRIVER_INSTRUMENTATION} is not registered`
    )
    expect(await reuse.argsFor('android', 'emulator-5554')).toEqual([])
  })

  it('R62-04 fails closed when adb cannot list the driver', async () => {
    const reuse = createMaestroDriverReuse({
      inspect: () => Promise.reject(new Error('device offline')),
    })
    reuse.recordInvocation('android', 'emulator-5554')
    await expect(reuse.argsFor('android', 'emulator-5554')).rejects.toThrow(
      'Maestro driver not ready on emulator-5554: adb could not list the driver (device offline)'
    )
  })

  it('R62-05 reads only exact package and instrumentation lines', () => {
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

  it('R62-06 places the option right after the test subcommand', () => {
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
