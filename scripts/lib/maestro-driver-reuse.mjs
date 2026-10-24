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
 * The first flow on a device still reinstalls, so a cached AVD snapshot can never
 * keep a driver from another Maestro version. Every later flow on that device passes
 * `--no-reinstall-driver`, after the device shows both packages installed and the
 * instrumentation registered. When it does not, that flow fails at once with a cause
 * naming what is missing, and the device's next flow reinstalls.
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
 * @param {{
 *   inspect: (device: string) => Promise<{ packagesOutput: string, instrumentationOutput: string }>
 * }} options
 */
export function createMaestroDriverReuse({ inspect }) {
  /** Devices whose driver an earlier invocation of this run installed. */
  const installed = new Set()
  return {
    /**
     * The extra `maestro test` arguments for the next flow on `device`. Throws
     * `MaestroDriverNotReady` when a reused driver is incomplete.
     *
     * @param {'android' | 'ios'} platform
     * @param {string} device
     * @returns {Promise<string[]>}
     */
    async argsFor(platform, device) {
      if (platform !== 'android' || !installed.has(device)) return []
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
