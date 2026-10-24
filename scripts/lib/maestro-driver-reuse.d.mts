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
}): {
  argsFor(platform: 'android' | 'ios', device: string): Promise<string[]>
  recordInvocation(platform: 'android' | 'ios', device: string): void
}

export declare function withTestOptions(
  args: readonly string[],
  extra: readonly string[]
): string[]
