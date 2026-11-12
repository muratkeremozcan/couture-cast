export declare function filesUnder(root: string): string[]

export declare function replaceDistFromStaging(
  staging: string,
  dist: string
): { moved: number; removed: number }

export declare function runBuild(options?: { argv?: string[] }): Promise<void>

/** The stamp `dist` carries: the fingerprint of the inputs it was built from. */
export declare const FINGERPRINT_FILE: string

export declare function buildFingerprint(packageDir: string, compiler: string[]): string
