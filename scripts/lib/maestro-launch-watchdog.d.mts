export type OpenLaunchApp = {
  line: number
  command: string
  step: string
  lastLine: string
}

export declare const LAUNCH_APP_STALL_MS: number

export declare function openLaunchApp(logText: string): OpenLaunchApp | undefined

export declare function createLaunchStallDetector(options?: {
  boundMs?: number
  now?: () => number
}): {
  observe(logText: string): (OpenLaunchApp & { elapsedMs: number }) | undefined
}

export declare function createLaunchStallCheck(options: {
  device: string
  readDebugLog: () => string | undefined
  readDeviceProcesses: () => Promise<string>
  boundMs?: number
  intervalMs?: number
  now?: () => number
}): { intervalMs: number; check: () => Promise<string | undefined> }

export declare function launchStallError(message: string): Error & { stalled: true }

export declare function deviceCommandsInFlight(psOutput: string): string[]

export declare function describeLaunchStall(
  stall: { command: string; step: string; lastLine: string; elapsedMs: number },
  evidence: { device: string; commands?: string[]; captureError?: string }
): string
