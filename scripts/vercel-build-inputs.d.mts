export type Project = 'web' | 'api'
export declare const PROJECT_APPS: Record<Project, string>
export declare const OUTSIDE_BUILDS: readonly string[]
export declare const BUILD_SCRIPTS: Record<Project, readonly string[]>
export declare function scriptInputs(
  entries: readonly string[],
  read: (file: string) => string | null
): Set<string>
export declare function isBuildInput(
  project: Project,
  file: string,
  scripts: ReadonlySet<string>
): boolean
export declare function failure(result: {
  error?: { code?: string }
  signal?: string | null
  status: number | null
  stderr?: string
}): string
export declare function buildInputEntries(
  cwd: string,
  project: Project,
  rev: string
): string[]
export declare function inputsHashAt(cwd: string, project: Project, rev?: string): string
export declare function workingTree(cwd: string): string
export declare function equivalentCommits(
  cwd: string,
  project: Project,
  head: string,
  limit?: number
): string[]
export declare function buildDecision(
  project: string,
  env: Record<string, string | undefined>,
  cwd?: string
): { build: boolean; reason: string }
