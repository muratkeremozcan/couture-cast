export type PreviewProject = 'web' | 'api'
export declare const projectBuildPaths: Record<PreviewProject, string[]>
export declare function previewDecision(
  cwd: string,
  base: string,
  head?: string,
  paths?: string[]
): { required: boolean; reason: string }
export declare function previewRequired(
  cwd: string,
  base: string,
  head?: string,
  paths?: string[]
): boolean
export declare function inputsHash(cwd: string, project: PreviewProject): string
