import { type safeDecodeCommunityFeedCursor } from '../src/contracts/http'

export type CursorResult = ReturnType<typeof safeDecodeCommunityFeedCursor>

export const failureMessageOf = (result: CursorResult): string | undefined =>
  result.success ? undefined : result.error

export const withoutKey = (
  source: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> => {
  const copy = { ...source }
  delete copy[key]
  return copy
}
