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
export declare function inputsChanged(
  cwd: string,
  from: string,
  to: string,
  paths: string[]
): { changed: string[] } | { reason: string }
export declare function ignoredBuildDecision(
  env: NodeJS.ProcessEnv,
  cwd?: string,
  project?: string
): { code: 0 | 1; reason: string }
export declare function ignoredBuildExitCode(
  env: NodeJS.ProcessEnv,
  cwd?: string,
  project?: string
): number
