export interface E2eStackRecord {
  pid: number
  startedAt: string
  token: string
}
export declare const E2E_STACK_LAUNCHER: string
export declare function e2eStackRecordPath(
  repoRoot: string,
  webPort: string | number,
  directory?: string
): string
export declare function writeE2eStackRecord(
  recordPath: string,
  pid?: number
): E2eStackRecord
export declare function readE2eStackRecord(recordPath: string): E2eStackRecord | null
export declare function removeE2eStackRecordIfOwned(
  recordPath: string,
  token: string
): boolean
export declare function processCommand(pid: number): string | null
export declare function isE2eStackLauncher(
  pid: number,
  readCommand?: (pid: number) => string | null
): boolean
export declare function stopE2eStack(
  recordPath: string,
  options?: { timeoutMs?: number; readCommand?: (pid: number) => string | null }
): Promise<'no-record' | 'stale-record' | 'already-exited' | 'stopped' | 'still-running'>
