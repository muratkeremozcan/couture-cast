import type {
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process'
export function assertOwnedStory68EmulatorPort(input: {
  avd: unknown
  port: unknown
}): void
export function restoreAndroidReverse(input: {
  adb: string
  device: string
  ports: readonly number[]
  execute?: (
    binary: string,
    args: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding
  ) => Pick<SpawnSyncReturns<string>, 'status' | 'stderr' | 'error'>
}): void
export function withNativeTransport<T extends { status: number | null }>(
  invoke: () => T,
  restore: () => void
): T

export function assertOwnedStory68AppReset(input: {
  appId: string
  isolatedBuild: unknown
  debuggable: boolean
  explicit: unknown
}): void
export function assertIosReadDenied(
  state: { read: number | null; addOnly: number | null },
  requireAddOnly?: boolean
): void
export function shouldRetryIosSnapshot(input: {
  platform: string
  attempt: number
  log: string
  flow: string
}): boolean
