import type { PreviewProject } from './vercel-preview-inputs.mjs'
export type Deployment = {
  id?: string
  uid?: string
  url?: string
  readyState?: string
  state?: string
  readyStateReason?: string | null
  errorMessage?: string | null
  created?: number
  meta?: Record<string, string>
}
export declare const BUILD_SETTINGS: string[]
export declare function configIdentity(
  project: Record<string, unknown>,
  envs: Record<string, unknown>[],
  branch: string
): string
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
  list: () => Promise<Deployment[]>
  create: (body: Record<string, unknown>) => Promise<Deployment>
  get: (id: string) => Promise<Deployment>
  cancel: (id: string) => Promise<unknown>
  sleep?: (ms: number) => Promise<void>
  attempts?: number
  intervalMs?: number
  log?: (message: string) => void
}): Promise<{ id: string; url: string; sha: string; reused: boolean }>
