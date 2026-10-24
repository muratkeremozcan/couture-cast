/** Type declarations for `lifecycle.mjs`, for its unit tests under `playwright/`. */

export type RunLifecycle = {
  /** Resolves with the run's exit code once teardown has finished. */
  done: Promise<number>
  teardown(reason: 'completed' | 'signal'): Promise<number>
  /** Settles with the startup sequence and the test run. */
  work: Promise<unknown>
}

export declare function startRunLifecycle(options: {
  owner: { close(): Promise<void>; readonly closing: boolean }
  run: () => Promise<number>
  release: () => Promise<number>
  settleMs?: number
  log?: (message: string) => void
  reportError?: (error: unknown) => void
}): RunLifecycle
