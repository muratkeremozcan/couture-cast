/**
 * Story 6.7 R62: Maestro installs its Android driver once per device per run.
 *
 * Every `maestro test` invocation uninstalls and reinstalls the driver app
 * (`dev.mobile.maestro`) and its instrumentation app (`dev.mobile.maestro.test`)
 * unless told otherwise, and the runner starts one invocation per flow. On CI run
 * 40081299288 (shard 7) that reinstall stalled: the driver app came back, the
 * instrumentation app's install never finished, and the flow died 102 s later with
 * `DeviceServerDiedException` during `deviceInfo`, before its first command.
 *
 * Every flow passes `--no-reinstall-driver`: Maestro then installs the driver only
 * when it is missing and leaves it installed when the invocation closes (the default
 * mode uninstalls it at close, so nothing would be left to reuse). Before a device's
 * first flow the runner removes any driver already there and checks it is gone, so a
 * cached AVD snapshot can never hand this run a driver from another Maestro version;
 * that flow's Maestro installs a fresh one. Every later flow on the device first
 * checks both packages are installed and the instrumentation registered. When they
 * are not, that flow fails at once with a cause naming what is missing, and the
 * device's next flow starts fresh again.
 *
 * Story 6.7b R18: before every Android flow the runner's `settle` step stops the
 * driver an earlier flow left running, waits out a Maestro session record left by
 * an invocation whose driver never started, and checks the driver port is free on
 * the device (scripts/lib/maestro-android-driver-session.mjs). A single-device
 * invocation then pins the driver to that port with `--driver-host-port`.
 */
import {
  DRIVER_HOST_PORT_ARG,
  MAESTRO_ANDROID_DRIVER_PORT,
} from './maestro-android-driver-session.mjs'

export const MAESTRO_DRIVER_PACKAGES = ['dev.mobile.maestro', 'dev.mobile.maestro.test']

export const MAESTRO_DRIVER_INSTRUMENTATION =
  'dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner'

export const NO_REINSTALL_DRIVER_ARG = '--no-reinstall-driver'

export class MaestroDriverNotReady extends Error {
  /**
   * @param {string} device
   * @param {readonly string[]} missing
   */
  constructor(device, missing) {
    super(`Maestro driver not ready on ${device}: ${missing.join('; ')}`)
    this.name = 'MaestroDriverNotReady'
    this.missing = missing
  }
}

/**
 * What the driver lacks on a device, from `pm list packages dev.mobile.maestro` and
 * `pm list instrumentation`. Empty means it can be reused.
 *
 * @param {string} packagesOutput
 * @param {string} instrumentationOutput
 * @returns {string[]}
 */
export function missingMaestroDriverParts(packagesOutput, instrumentationOutput) {
  const packages = new Set(
    packagesOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('package:'))
      .map((line) => line.slice('package:'.length))
  )
  const missing = MAESTRO_DRIVER_PACKAGES.filter((name) => !packages.has(name)).map(
    (name) => `package ${name} is not installed`
  )
  // `instrumentation:<component> (target=<package>)`
  const registered = instrumentationOutput
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .includes(`instrumentation:${MAESTRO_DRIVER_INSTRUMENTATION}`)
  if (!registered)
    missing.push(`instrumentation ${MAESTRO_DRIVER_INSTRUMENTATION} is not registered`)
  return missing
}

/**
 * The driver packages a device still holds, from `pm list packages dev.mobile.maestro`.
 *
 * @param {string} packagesOutput
 * @returns {string[]}
 */
function presentDriverPackages(packagesOutput) {
  const lines = new Set(packagesOutput.split(/\r?\n/).map((line) => line.trim()))
  return MAESTRO_DRIVER_PACKAGES.filter((name) => lines.has(`package:${name}`))
}

/**
 * @param {{
 *   inspect: (device: string) => Promise<{ packagesOutput: string, instrumentationOutput: string }>
 *   uninstall: (device: string, packageName: string) => Promise<unknown>
 *   settle?: (device: string, driverPort: number | null) => Promise<void>
 * }} options
 */
export function createMaestroDriverReuse({ inspect, uninstall, settle }) {
  /** Devices whose driver an earlier invocation of this run installed. */
  const installed = new Set()

  /** Removes any driver already on `device` and proves it is gone. */
  const startFresh = async (device) => {
    for (const name of [...MAESTRO_DRIVER_PACKAGES].reverse()) {
      // A package that is not installed fails to uninstall; the listing decides.
      await uninstall(device, name).catch(() => undefined)
    }
    let left
    try {
      left = presentDriverPackages((await inspect(device)).packagesOutput)
    } catch (error) {
      throw new MaestroDriverNotReady(device, [
        `adb could not list the driver (${error.message})`,
      ])
    }
    if (left.length > 0)
      throw new MaestroDriverNotReady(
        device,
        left.map((name) => `package ${name} could not be removed before a fresh install`)
      )
  }

  /** Checks the driver an earlier flow installed is still complete. */
  const checkReusable = async (device) => {
    let missing
    try {
      const { packagesOutput, instrumentationOutput } = await inspect(device)
      missing = missingMaestroDriverParts(packagesOutput, instrumentationOutput)
    } catch (error) {
      missing = [`adb could not list the driver (${error.message})`]
    }
    if (missing.length > 0) {
      installed.delete(device)
      throw new MaestroDriverNotReady(device, missing)
    }
  }

  return {
    /**
     * The extra `maestro test` arguments for the next flow on `device`, after the
     * device's driver is either removed (its first flow) or checked complete. Throws
     * `MaestroDriverNotReady` naming what is wrong.
     *
     * `driverPort` pins the driver to that port (17001 unless given). `null`
     * leaves the choice to Maestro, for one invocation across several devices,
     * which a single `--driver-host-port` would give the same port.
     *
     * @param {'android' | 'ios'} platform
     * @param {string} device
     * @param {{ driverPort?: number | null }} [options]
     * @returns {Promise<string[]>}
     */
    async argsFor(platform, device, { driverPort = MAESTRO_ANDROID_DRIVER_PORT } = {}) {
      if (platform !== 'android') return []
      if (installed.has(device)) await checkReusable(device)
      else await startFresh(device)
      if (settle) {
        try {
          await settle(device, driverPort)
        } catch (error) {
          throw new MaestroDriverNotReady(device, [error.message])
        }
      }
      return driverPort === null
        ? [NO_REINSTALL_DRIVER_ARG]
        : [NO_REINSTALL_DRIVER_ARG, DRIVER_HOST_PORT_ARG, String(driverPort)]
    },
    /**
     * Records that an invocation on `device` ran, so it installed the driver.
     *
     * @param {'android' | 'ios'} platform
     * @param {string} device
     */
    recordInvocation(platform, device) {
      if (platform === 'android') installed.add(device)
    },
  }
}

/**
 * `args` with `extra` placed right after the `test` subcommand, where Maestro
 * reads test options.
 *
 * @param {readonly string[]} args
 * @param {readonly string[]} extra
 * @returns {string[]}
 */
export function withTestOptions(args, extra) {
  if (extra.length === 0) return [...args]
  const index = args.indexOf('test')
  if (index === -1) throw new Error('Maestro arguments have no test subcommand.')
  return [...args.slice(0, index + 1), ...extra, ...args.slice(index + 1)]
}

/**
 * R68: one Maestro invocation across several devices (the parallel shard path) under
 * the same lifecycle as a serial flow. Every device is prepared first; if one cannot
 * be, nothing launches and the refusal names it. Each device the invocation ran on is
 * recorded, so a later serial flow on it reuses the driver.
 *
 * @template T
 * @param {ReturnType<typeof createMaestroDriverReuse>} reuse
 * @param {'android' | 'ios'} platform
 * @param {readonly string[]} devices
 * @param {(driverArgs: string[]) => Promise<T>} invoke
 * @returns {Promise<T>}
 */
export async function runWithDriverOnDevices(reuse, platform, devices, invoke) {
  let driverArgs = []
  for (const device of devices)
    driverArgs = await reuse.argsFor(platform, device, {
      driverPort: devices.length === 1 ? MAESTRO_ANDROID_DRIVER_PORT : null,
    })
  try {
    return await invoke(driverArgs)
  } finally {
    for (const device of devices) reuse.recordInvocation(platform, device)
  }
}

/**
 * R68: the parallel shard launch as `run-maestro.mjs` performs it. `args` is the
 * whole `maestro` command line for every device; the driver option goes in after
 * `test`. A refusal launches nothing and is returned as the cause every flow fails
 * with; Maestro's own failure is returned for the caller to weigh against the report.
 *
 * @param {{
 *   reuse: ReturnType<typeof createMaestroDriverReuse>
 *   platform: 'android' | 'ios'
 *   devices: readonly string[]
 *   args: readonly string[]
 *   run: (args: string[]) => Promise<unknown>
 * }} options
 * @returns {Promise<{ refused: string } | { refused?: undefined, exitError?: Error }>}
 */
export async function launchShardedSuite({ reuse, platform, devices, args, run }) {
  let exitError
  try {
    await runWithDriverOnDevices(reuse, platform, devices, async (driverArgs) => {
      try {
        await run(withTestOptions(args, driverArgs))
      } catch (error) {
        exitError = error
      }
    })
  } catch (error) {
    return { refused: error.message }
  }
  return { exitError }
}
