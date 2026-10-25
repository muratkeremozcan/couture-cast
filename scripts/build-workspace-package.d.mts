export declare function filesUnder(root: string): string[]

export declare function replaceDistFromStaging(
  staging: string,
  dist: string,
  hooks?: {
    beforeStep?: (done: number, total: number) => Promise<void> | void
    afterStep?: (done: number, total: number) => void
  }
): Promise<{ moved: number; removed: number }>

export declare function acquireBuildLock(options: {
  packageDir: string
  waitMs: number
  staleMs: number
  onCompromised: (error: Error) => void
}): Promise<() => Promise<void>>

export declare function removeAbandonedStaging(packageDir: string, keep?: string): void
