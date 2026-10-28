export const browserWatermarkPhases: readonly string[]
export const browserWatermarkChecks: readonly string[]
export function assertBrowserWatermarkEvidence(value: unknown): void
export function closedBrowserWatermarkFailure(error: unknown): string
export function browserWatermarkHoldDeadlineMs(authorizationBudgetMs: number): number
export function withBrowserWatermarkLock(input: {
  connectionString: string
  authorizationBudgetMs: number
  createClient(options: {
    connectionString: string
    connectionTimeoutMillis: number
    query_timeout: number
  }): {
    connect(): Promise<unknown>
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
    end(): Promise<unknown>
    on(event: string, listener: (...args: unknown[]) => void): unknown
  }
  whileLocked(context: {
    signal: AbortSignal
    waitForBlocked: () => Promise<unknown>
    checkBlocked: () => Promise<boolean>
  }): Promise<void>
  onPhase(phase: string): void
  onHeld(ms: number): void
  onCheck(check: string, value: boolean): void
  now?: () => number
}): Promise<{
  heldMs: number
  blockedSourceObserved: boolean
  blockedSourceAtRelease: boolean
}>

type CommunityReadinessRequest = {
  url(): string
  postDataJSON(): { targets?: { postId?: string }[] } | null
}
type CommunityReadinessResponse = {
  url(): string
  status(): number
  request(): CommunityReadinessRequest
  json(): Promise<unknown>
}
export function afterInitialCommunityVerification(input: {
  page: {
    on(event: 'request', listener: (request: CommunityReadinessRequest) => void): unknown
    on(
      event: 'response',
      listener: (response: CommunityReadinessResponse) => void
    ): unknown
    off(event: 'request', listener: (request: CommunityReadinessRequest) => void): unknown
    off(
      event: 'response',
      listener: (response: CommunityReadinessResponse) => void
    ): unknown
    waitForResponse(
      predicate: (response: CommunityReadinessResponse) => boolean,
      options: { timeout: number }
    ): Promise<CommunityReadinessResponse>
  }
  postId: string
  navigate(): Promise<void>
}): Promise<void>
