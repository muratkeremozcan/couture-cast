export declare const MAESTRO_DRIVER_PACKAGES: readonly string[]
export declare const MAESTRO_DRIVER_INSTRUMENTATION: string
export declare const NO_REINSTALL_DRIVER_ARG: string

export declare class MaestroDriverNotReady extends Error {
  constructor(device: string, missing: readonly string[])
  missing: readonly string[]
}

export declare function missingMaestroDriverParts(
  packagesOutput: string,
  instrumentationOutput: string
): string[]

export declare function createMaestroDriverReuse(options: {
  inspect: (
    device: string
  ) => Promise<{ packagesOutput: string; instrumentationOutput: string }>
  uninstall: (device: string, packageName: string) => Promise<unknown>
  settle?: (device: string, driverPort: number | null) => Promise<void>
}): {
  argsFor(
    platform: 'android' | 'ios',
    device: string,
    options?: { driverPort?: number | null }
  ): Promise<string[]>
  recordInvocation(platform: 'android' | 'ios', device: string): void
}

export declare function withTestOptions(
  args: readonly string[],
  extra: readonly string[]
): string[]

export declare function runWithDriverOnDevices<T>(
  reuse: ReturnType<typeof createMaestroDriverReuse>,
  platform: 'android' | 'ios',
  devices: readonly string[],
  invoke: (driverArgs: string[]) => Promise<T>
): Promise<T>

export declare function launchShardedSuite(options: {
  reuse: ReturnType<typeof createMaestroDriverReuse>
  platform: 'android' | 'ios'
  devices: readonly string[]
  args: readonly string[]
  run: (args: string[]) => Promise<unknown>
}): Promise<{ refused: string } | { refused?: undefined; exitError?: Error }>
