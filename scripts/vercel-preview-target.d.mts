import type { PreviewProject } from './vercel-preview-inputs.mjs'
export declare const IGNORED_DESCRIPTION: string
export type CommitStatus = { context: string; state: string; description?: string | null }
export type ReadyDeployment = { sha: string; url: string; created: number }
export declare function previewTarget(input: {
  project: PreviewProject
  projectSlug: string
  expectedSha: string
  cwd?: string
  statuses: () => Promise<CommitStatus[]>
  readyDeployments: () => Promise<ReadyDeployment[]>
  sleep?: (ms: number) => Promise<void>
  attempts?: number
  intervalMs?: number
  log?: (message: string) => void
}): Promise<{ sha: string; reason: string }>
