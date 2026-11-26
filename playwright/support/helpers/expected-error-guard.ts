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

/**
 * Story CC-7.12 D10: a free member's Plan reads the planner and gets the Premium-required 403,
 * which the page turns into the free preview. Like the ritual's no-city 400, that one answer is
 * expected anywhere Plan opens for a free member; every other planner error still fails.
 */
export const PLANNER_RESPONSE_URL =
  /^https?:\/\/[^/]+\/api\/v1\/commerce\/premium\/planner(?:\?|$)/

export function unexpectedPlannerErrors(
  seen: readonly GuardedError[],
  premiumRequiredMessage: string | null
): GuardedError[] {
  // Codex round 2 #2: only a test that expects the free preview passes the message, and only the
  // exact Premium-required body counts; an unreadable 403 could be an aborted auth refusal.
  return seen.filter(
    ({ method, status, code }) =>
      premiumRequiredMessage === null ||
      method !== 'GET' ||
      status !== 403 ||
      code !== premiumRequiredMessage
  )
}

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
 * the test expects. A navigation can leave Playwright's body read pending after
 * the response status arrives. `settle` bounds that wait and reports the status
 * with an unavailable body when the read cannot finish.
 */
export function guardExpectedError(
  context: BrowserContext,
  urlPattern: RegExp,
  bodySettleMs = 2_000
): { settle: () => Promise<GuardedError[]> } {
  const seen: GuardedError[] = []
  const pending: Promise<void>[] = []
  context.on('response', (response) => {
    if (response.status() < 400 || !urlPattern.test(response.url())) return
    const metadata = {
      method: response.request().method(),
      status: response.status(),
      url: response.url(),
    }
    const index = seen.push({ ...metadata, bodyUnreadable: true }) - 1
    pending.push(
      response.body().then(
        (bytes) => {
          let body: { message?: unknown } | null
          try {
            body = JSON.parse(bytes.toString()) as typeof body
          } catch {
            seen[index] = metadata
            return
          }
          seen[index] =
            typeof body?.message === 'string'
              ? { ...metadata, code: body.message }
              : metadata
        },
        () => undefined
      )
    )
  })
  return {
    async settle() {
      const count = pending.length
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all(pending),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, bodySettleMs)
          }),
        ])
        return seen.slice(0, count)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
