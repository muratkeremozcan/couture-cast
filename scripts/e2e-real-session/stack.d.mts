/** Type declarations for `stack.mjs`, the owned real-session stack parts both lanes share. */
import type { OwnedProcess } from './process-owner.d.mts'

export declare function resolveSupabase(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  repoRoot: string
): {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
}
export declare function resolveRedisUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): string
export declare function createIsolatedDatabase(
  sourceUrl: string,
  reserve: (database: { name: string; url: string }) => void
): Promise<{ name: string; url: string }>
export declare function dropIsolatedDatabase(
  sourceUrl: string,
  name: string
): Promise<void>
export declare function waitForHealthy(
  url: string,
  handle: OwnedProcess,
  timeoutMs: number,
  readLog: () => string,
  assertRunning: () => void
): Promise<void>
export declare function tail(file: string, lines?: number): string
