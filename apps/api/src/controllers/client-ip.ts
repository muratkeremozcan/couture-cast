import type { Request } from 'express'

/**
 * The caller's IP as recorded on consent and commercial-consent audit rows.
 *
 * `x-forwarded-for` is read first because the API runs behind Vercel's proxy,
 * where `request.ip` is the proxy. Only the leftmost entry is taken: the rest of
 * the list is appended by intermediaries and the leftmost is the closest thing
 * to the originating client this deployment can see.
 *
 * Extracted from `guardian.controller.ts`, which had the only copy, when Story
 * 5.1 needed the same value for the `commerce_affiliate_opt_out_changed` audit
 * row. Two independently drifting copies of an audit-trail field is exactly the
 * kind of divergence an audit trail exists to prevent.
 */
export function getClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers['x-forwarded-for']
  const rawForwardedFor = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  const clientIp = rawForwardedFor?.split(',')[0]?.trim()

  return clientIp || request.ip
}
