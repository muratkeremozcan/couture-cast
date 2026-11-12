export type PreviewProject = 'web' | 'api'
/** Each workspace's @couture dependencies, as scripts/ci/lanes.mjs reads them. */
export type WorkspaceDependencies = Record<string, string[]>
export declare const PREVIEW_LANE: 'preview'
export declare const projectBuildPaths: Record<PreviewProject, string[]>
export declare function previewDecision(
  cwd: string,
  base: string,
  head?: string,
  dependencies?: WorkspaceDependencies
): { required: boolean; reason: string }
export declare function previewRequired(
  cwd: string,
  base: string,
  head?: string,
  dependencies?: WorkspaceDependencies
): boolean
export declare function inputsHash(cwd: string, project: PreviewProject): string
