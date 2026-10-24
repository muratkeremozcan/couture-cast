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
 */

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
 * }} options
 */
export function createMaestroDriverReuse({ inspect, uninstall }) {
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
     * @param {'android' | 'ios'} platform
     * @param {string} device
     * @returns {Promise<string[]>}
     */
    async argsFor(platform, device) {
      if (platform !== 'android') return []
      if (installed.has(device)) await checkReusable(device)
      else await startFresh(device)
      return [NO_REINSTALL_DRIVER_ARG]
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
