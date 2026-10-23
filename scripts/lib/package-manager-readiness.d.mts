export type AdbResult = { code: number | null; output: string }

export declare const PROBE_TIMEOUT_MS: number
export declare const READINESS_TIMEOUT_MS: number
export declare const PROBE_RETRY_DELAY_MS: number
export declare const SLOW_PROBE_CAPTURES: [string, string[]][]

export declare function waitForPackageManagerReady(options: {
  runProbe: (signal: AbortSignal) => Promise<AdbResult>
  onUnreadyProbe: (attempt: number) => Promise<void> | void
  log: (message: string) => void
  probeTimeoutMs?: number
  overallTimeoutMs?: number
  retryDelayMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<{ attempts: number; durationsMs: number[] }>

export declare function resolveProbeSerials(
  intendedSerials: string[],
  adbStates: Map<string, string>
): string[]

export declare function runAdb(
  adbBinary: string,
  args: string[],
  signal?: AbortSignal
): Promise<AdbResult>

export declare function adbDeviceStates(
  adbBinary: string,
  run?: typeof runAdb
): Promise<Map<string, string>>

export declare function captureSlowProbeState(options: {
  adbBinary: string
  serial: string
  artifactDir: string
  attempt: number
  log: (message: string) => void
  timeoutMs?: number
  run?: typeof runAdb
}): Promise<void>

export declare function saveDiagnostic(
  file: string,
  content: string,
  log: (message: string) => void,
  label: string
): boolean
