export declare const MAESTRO_ANDROID_DRIVER_PORT: number
export declare const DRIVER_HOST_PORT_ARG: string
export declare const MAESTRO_SESSION_ACTIVE_MS: number
export declare const MAESTRO_HEARTBEAT_INTERVAL_MS: number
export declare const MAESTRO_SESSIONS_FILE: string

export declare function activeMaestroSessions(
  text: string,
  options: { platform: string; device?: string; nowMs: number }
): { sessionId: string; heartbeatMs: number; ageMs: number }[]

export declare function waitForStaleMaestroSessions(options: {
  device?: string
  platform?: string
  read?: () => string
  log: (message: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<{ waitedMs: number }>

export declare function readSessionsFile(file: string): string

export declare function devicePortHolders(procNetText: string, port: number): string[]

export declare function waitForDevicePortFree(options: {
  readProcNet: () => Promise<string>
  port: number
  device: string
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<void>
