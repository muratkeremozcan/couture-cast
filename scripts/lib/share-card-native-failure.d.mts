export type NativeFlowFailure = {
  flow: string
  classification:
    | 'snapshot'
    | 'elementtimeout'
    | 'driverconnection'
    | 'assertion'
    | 'holddeadline'
    | 'harnessstop'
    | 'unknown'
  durationMs: number
  platform: 'android' | 'ios'
}

export declare function assertNativeFlowFailure(
  value: unknown
): asserts value is NativeFlowFailure

export declare function summarizeNativeFlowFailure(input: {
  flow: string
  platform: 'android' | 'ios'
  durationMs: number
  log: string
  harnessStop?: string | null
}): NativeFlowFailure
