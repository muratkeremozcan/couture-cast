type StallCheck = { intervalMs: number; check: () => Promise<string | undefined> }

export declare function assignFlowsToDevices(
  flows: readonly string[],
  devices: readonly string[],
  durations?: Record<string, number>
): Map<string, string[]>

export declare function runAndroidDeviceShards(options: {
  flows: readonly string[]
  devices: readonly string[]
  durations?: Record<string, number>
  timeoutMs: number
  prepareDriver: (device: string, driverPort: number) => Promise<string[]>
  buildArgs: (flowPath: string, device: string) => string[]
  stallCheckFor: (
    flowPath: string,
    device: string
  ) => ((attemptStartedAtMs: number) => StallCheck) | undefined
  spawnOptionsFor: (flowPath: string, device: string) => object
  runMaestro: (
    args: string[],
    options: { timeoutMs: number; stallCheck?: StallCheck }
  ) => Promise<void>
  beforeAttempt?: (args: string[]) => void
  onRetry?: (flowPath: string, device: string, error: Error) => void
  recordInvocation: (device: string) => void
  onRefused: (flowPath: string, device: string, cause: string) => void
  onFinished: (
    flowPath: string,
    device: string,
    error: Error | undefined,
    startedAtMs: number
  ) => void
  log: (message: string) => void
  now?: () => number
}): Promise<Map<string, string[]>>
