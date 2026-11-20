import type { BrowserContext } from '@playwright/test'

/** One HTTP error answer seen on the guarded URL. */
export type GuardedError = { method: string; status: number; code?: string; url: string }

/** The error answer a test expects on the guarded URL; the caller says how many times. */
export type AllowedError = { method: string; status: number; code: string }

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
    const request = response.request()
    pending.push(
      response
        .json()
        .catch(() => null)
        .then((body: { message?: unknown } | null) => ({
          method: request.method(),
          status: response.status(),
          url: response.url(),
          ...(typeof body?.message === 'string' ? { code: body.message } : {}),
        }))
    )
  })
  return { settle: () => Promise.all(pending) }
}
