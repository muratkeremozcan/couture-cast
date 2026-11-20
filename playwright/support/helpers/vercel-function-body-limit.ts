import type { Page, Request, Route } from '@playwright/test'

/**
 * The largest request body a production Vercel Function accepted on 2026-11-19, in bytes.
 * Vercel documents a 4.5 MB cap on a function's request body; bisecting PUTs against the
 * production API (couture-cast-api.vercel.app) found that 4,492,812 bytes reached the app and
 * 4,494,359 bytes got 413 FUNCTION_PAYLOAD_TOO_LARGE, on the API host and on the web host's
 * /api/v1 rewrite alike. The local API has no such cap, so a local run passes uploads that
 * production refuses before the app sees them.
 */
export const VERCEL_FUNCTION_MAX_BODY_BYTES = 4_492_812

/** The plain-text body Vercel's edge returns, as the production probe received it. */
const PAYLOAD_TOO_LARGE_BODY = 'Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE\n'

/**
 * A route handler for PUTs on the API's /api/v1 paths, on either host, that answers the way
 * production does: a body over the cap gets Vercel's 413 before the app sees it, and any other
 * request goes on to the local API. Register it for every /api/v1 PUT, so a relay under any
 * name meets the same cap.
 */
export function vercelFunctionBodyLimit() {
  return async (route: Route, request: Request) => {
    const bytes = request.postDataBuffer()?.byteLength ?? 0
    if (bytes > VERCEL_FUNCTION_MAX_BODY_BYTES) {
      await route.fulfill({
        status: 413,
        contentType: 'text/plain; charset=utf-8',
        body: PAYLOAD_TOO_LARGE_BODY,
      })
      return
    }
    await route.fallback()
  }
}

/**
 * Every PUT the page sends, to any host, in order. An upload test compares it with the signed
 * storage URL the allocation handed out, so bytes sent anywhere else, a renamed relay included,
 * fail the test.
 */
export function watchPuts(page: Page): string[] {
  const puts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT') puts.push(request.url())
  })
  return puts
}
