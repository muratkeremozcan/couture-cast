import type { BrowserContext } from '@playwright/test'

/** One HTTP error answer seen on the guarded URL. */
export type GuardedError = {
  method: string
  status: number
  code?: string
  url: string
  bodyUnreadable?: true
}

/** The error answer a test expects on the guarded URL; the caller says how many times. */
export type AllowedError = { method: string; status: number; code: string }

export const RITUAL_RESPONSE_URL = /^https?:\/\/[^/]+\/api\/v1\/ritual(?:\?|$)/

export function unexpectedRitualErrors(seen: readonly GuardedError[]): GuardedError[] {
  return seen.filter(
    ({ method, status, code, bodyUnreadable }) =>
      method !== 'GET' ||
      status !== 400 ||
      (code !== 'No location preferences found for user' && !bodyUnreadable)
  )
}

/**
 * Splits guarded errors into those the allowance covers and the rest. Pure, so it is unit-tested
 * directly; the caller decides how many allowed errors the test expects.
 */
export function classifyGuardedErrors(
  seen: readonly GuardedError[],
  allowed: AllowedError
): { allowedCount: number; unexpected: GuardedError[] } {
  const matches = (error: GuardedError) =>
    error.method === allowed.method &&
    error.status === allowed.status &&
    error.code === allowed.code
  return {
    allowedCount: seen.filter(matches).length,
    unexpected: seen.filter((error) => !matches(error)),
  }
}

/**
 * Watches every page of a context for 4xx/5xx answers on one URL, any method, for as long as the
 * caller keeps it. It is the companion of a network-error monitor that excludes that URL: the
 * monitor stands aside for the URL, and this guard still fails on every error there except the one
 * the test expects. `settle` waits for the bodies and returns what was seen.
 */
export function guardExpectedError(
  context: BrowserContext,
  urlPattern: RegExp
): { settle: () => Promise<GuardedError[]> } {
  const pending: Promise<GuardedError>[] = []
  context.on('response', (response) => {
    if (response.status() < 400 || !urlPattern.test(response.url())) return
    const metadata = {
      method: response.request().method(),
      status: response.status(),
      url: response.url(),
    }
    pending.push(
      response.body().then(
        (bytes) => {
          let body: { message?: unknown } | null
          try {
            body = JSON.parse(bytes.toString()) as typeof body
          } catch {
            return metadata
          }
          return typeof body?.message === 'string'
            ? { ...metadata, code: body.message }
            : metadata
        },
        () => ({ ...metadata, bodyUnreadable: true as const })
      )
    )
  })
  return { settle: () => Promise.all(pending) }
}
