export declare function filesUnder(root: string): string[]

export declare function replaceDistFromStaging(
  staging: string,
  dist: string
): { moved: number; removed: number }
