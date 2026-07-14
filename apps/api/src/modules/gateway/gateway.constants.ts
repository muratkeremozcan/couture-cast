export const GATEWAY_LOGGER = Symbol('GATEWAY_LOGGER')

export function readVerifiedSocketUserId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('userId' in data)) {
    return undefined
  }

  const userId = (data as { userId?: unknown }).userId
  return typeof userId === 'string' && userId.length > 0 ? userId : undefined
}

export function writeVerifiedSocketUserId(
  data: unknown,
  userId: string
): Record<string, unknown> {
  const currentData =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}

  return { ...currentData, userId }
}
