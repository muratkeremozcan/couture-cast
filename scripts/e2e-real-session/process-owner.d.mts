/** Type declarations for `process-owner.mjs`, for its unit tests under `playwright/`. */
import type { ChildProcess } from 'node:child_process'

export declare class TeardownStarted extends Error {}

export declare function processGroupGone(pgid: number): boolean

export type OwnedProcess = {
  name: string
  child: ChildProcess
  pgid: number
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export type ProcessOwner = {
  readonly closing: boolean
  assertRunning(): void
  spawn(
    name: string,
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; logFile?: string }
  ): OwnedProcess
  stop(handle: OwnedProcess | undefined): Promise<void>
  close(): Promise<void>
  owned(): { name: string; pgid: number }[]
}

export declare function createProcessOwner(options?: {
  graceMs?: number
  killWaitMs?: number
}): ProcessOwner
