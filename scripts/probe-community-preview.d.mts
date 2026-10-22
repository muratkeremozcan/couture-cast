export type ProbeClaim = {
  status: 'pass' | 'fail' | 'not-executed' | 'observed-single'
  reason?: string
} & Record<string, unknown>

export type ProbeEvidence = {
  startedAt: string
  finishedAt: string
  apiBaseUrl: string
  deployment?: {
    status: number
    gitSha: string | null
    environment: string | null
    vercelId: string | null
  }
  claims: Record<string, ProbeClaim>
}

export type ProbeOptions = {
  apiBaseUrl: string
  webOrigin?: string
  bypass?: string
  readerUserId?: string
  writerUserId?: string
  allowLocalTarget?: boolean
  holdMs?: number
  sockets?: number
  samples?: number
}

export function fixtureBearer(userId: string, ttlSeconds: number): string
export function targetRefusal(
  apiBaseUrl: string,
  environment: string | null,
  allowLocalTarget?: boolean
): string | null
export function runPreviewProbe(options: ProbeOptions): Promise<ProbeEvidence>
