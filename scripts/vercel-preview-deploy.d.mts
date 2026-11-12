import type { PreviewProject } from './vercel-preview-inputs.mjs'
export type Deployment = {
  id?: string
  uid?: string
  url?: string
  readyState?: string
  state?: string
  readyStateReason?: string | null
  errorMessage?: string | null
  target?: string | null
  created?: number
  createdAt?: number
  meta?: Record<string, string>
}
export declare const BUILD_SETTINGS: string[]
export declare const PREVIEW_SOURCE: string
export declare function configIdentity(
  project: Record<string, unknown>,
  envs: Record<string, unknown>[],
  branch: string
): string
export type PreviewResult = { id: string; url: string; sha: string; reused: boolean }
export declare function previewDeployment(input: {
  project: PreviewProject
  branch: string
  sha: string
  inputs: string
  config: string
  force?: boolean
  repoId: string | number
  projectId: string
  projectName: string
  deadline: number
  list: () => Promise<Deployment[]>
  create: (body: Record<string, unknown>, force: boolean) => Promise<Deployment>
  get: (id: string) => Promise<Deployment>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  log?: (message: string) => void
}): Promise<PreviewResult>
export declare function run(
  project: PreviewProject,
  env: NodeJS.ProcessEnv,
  options?: {
    fetchImpl?: typeof fetch
    cwd?: string
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    log?: (message: string) => void
  }
): Promise<PreviewResult>
