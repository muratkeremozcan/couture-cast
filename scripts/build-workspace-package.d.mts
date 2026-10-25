export declare function filesUnder(root: string): string[]

export declare function replaceDistFromStaging(
  staging: string,
  dist: string
): { moved: number; removed: number }

export declare function acquireBuildLock(options: {
  packageDir: string
  waitMs: number
  staleMs: number
  onCompromised: (error: Error) => void
}): Promise<{ release: () => Promise<void>; token: string }>

export declare function ownsBuildLock(packageDir: string, token: string): boolean

export declare function removeAbandonedStaging(packageDir: string, keep?: string): void
