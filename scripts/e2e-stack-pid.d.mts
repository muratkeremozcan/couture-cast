export interface E2eStackRecord {
  pid: number
  processStartedAt: string
  launcherPath: string
  writtenAt: string
  token: string
}
export interface ProcessIdentity {
  startedAt: string
  command: string
}
export type LauncherIdentityMismatch =
  | 'not-running'
  | 'launcher-path-mismatch'
  | 'start-time-mismatch'
  | 'command-mismatch'
export declare const E2E_STACK_LAUNCHER: string
export declare function e2eStackLauncherPath(repoRoot: string): string
export declare function e2eStackRecordPath(
  repoRoot: string,
  webPort: string | number,
  directory?: string
): string
export declare function readProcessIdentity(pid: number): ProcessIdentity | null
export declare function commandHasArgument(command: string, argument: string): boolean
export declare function launcherIdentityMismatch(
  record: E2eStackRecord,
  liveIdentity: ProcessIdentity | null,
  expectedLauncherPath: string
): LauncherIdentityMismatch | null
export declare function writeE2eStackRecord(
  recordPath: string,
  options: {
    pid?: number
    launcherPath: string
    readIdentity?: (pid: number) => ProcessIdentity | null
  }
): E2eStackRecord | null
export declare function readE2eStackRecord(recordPath: string): E2eStackRecord | null
export declare function removeE2eStackRecordIfOwned(
  recordPath: string,
  token: string
): boolean
export declare function stopE2eStack(
  recordPath: string,
  options: {
    expectedLauncherPath: string
    timeoutMs?: number
    readIdentity?: (pid: number) => ProcessIdentity | null
  }
): Promise<
  | 'no-record'
  | 'unreadable-record'
  | LauncherIdentityMismatch
  | 'already-exited'
  | 'stopped'
  | 'still-running'
>
