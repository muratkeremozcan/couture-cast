export declare function filesUnder(root: string): string[]

export declare function replaceDistFromStaging(
  staging: string,
  dist: string
): { moved: number; removed: number }

export declare function pidAlive(pid: number): boolean

export declare function acquireBuildLock(options: {
  lockFile: string
  waitMs?: number
  log?: (message: string) => void
  now?: () => number
  sleep?: (ms: number) => void
}): () => void

export declare function removeAbandonedStaging(packageDir: string): void
