// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (TEA-18): the preview webhook leg. RevenueCat posts the Test Store project's
// events to this branch's preview API. Vercel Deployment Protection guards the preview, and
// RevenueCat's webhook settings hold one URL and one Authorization value, so:
//
// - the Vercel bypass rides in the URL as the `x-vercel-protection-bypass` query parameter, from
//   a Protection Bypass for Automation secret made only for this webhook, so it can be revoked
//   without touching the one Playwright and CI use;
// - the Authorization value stays REVENUECAT_WEBHOOK_AUTH, which the handler still requires.
//
// The probe proves both from outside without a real event: through the bypass, a POST with no
// Authorization and one with a wrong value must reach our handler and get its JSON 401. A
// Vercel login page or a 2xx fails it.

import { BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE } from '@couture/api-client/contracts/http/subscription'

export const WEBHOOK_ROUTE = '/api/v1/commerce/subscription/webhooks/revenuecat'
export const BYPASS_PARAM = 'x-vercel-protection-bypass'
/** The dedicated secret's variable name; its value lives in .env.preview only. */
export const WEBHOOK_BYPASS_ENV = 'REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET'
/** The bypass the journey proxy and the read checks send as a header (Playwright's). */
export const READ_BYPASS_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET'
/** The handler's own 401 message, from the API contract, so a reworded message still matches. */
export const UNAUTHORIZED_MESSAGE = BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE

/** The URL to paste into RevenueCat, with the secret shown only as its variable name. */
export function webhookUrlShape(apiOrigin) {
  const origin = new URL(apiOrigin).origin
  return `${origin}${WEBHOOK_ROUTE}?${BYPASS_PARAM}=<${WEBHOOK_BYPASS_ENV}>`
}

/** The real URL, for the probe's own request only. */
export function webhookUrl(apiOrigin, secret) {
  const url = new URL(WEBHOOK_ROUTE, new URL(apiOrigin).origin)
  url.searchParams.set(BYPASS_PARAM, secret)
  return url
}

/**
 * What one probe answer means. `handler-rejected` is the only pass: our handler answered 401
 * with its own JSON message.
 */
export function classifyProbe({ status, contentType = '', body = '' }) {
  if (status >= 200 && status < 300) return 'auth-not-enforced'
  const json = /application\/json/i.test(contentType)
  if (status === 401 && json && body.includes(UNAUTHORIZED_MESSAGE))
    return 'handler-rejected'
  if ((status === 401 || status === 403) && !json) return 'vercel-protection'
  if (status === 404) return 'route-missing'
  return 'unexpected'
}

/**
 * Sends the two unauthenticated probes and returns the record. Throws with the classification
 * when either answer is not our handler's 401.
 */
export async function probeWebhook({ apiOrigin, secret, fetchImpl = fetch }) {
  const results = []
  for (const authorization of [undefined, 'test-store-probe-wrong-value']) {
    const response = await fetchImpl(webhookUrl(apiOrigin, secret), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ event: { type: 'TEST', id: 'test-store-probe' } }),
      redirect: 'manual',
    })
    const verdict = classifyProbe({
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await response.text().catch(() => ''),
    })
    results.push({
      authorization: authorization ? 'wrong' : 'absent',
      status: response.status,
      verdict,
    })
    if (verdict !== 'handler-rejected')
      throw new Error(`test_store_webhook_probe_${verdict}: ${response.status}`)
  }
  return {
    urlShape: webhookUrlShape(apiOrigin),
    bypassSecret: WEBHOOK_BYPASS_ENV,
    bypassTransport: 'query parameter',
    authStillRequired: true,
    results,
  }
}

/** The operator's steps, in order, for this API origin. Contains no secret. */
export function operatorSteps(apiOrigin) {
  return [
    `1. Vercel, API project, Settings, Deployment Protection, Protection Bypass for Automation: add a secret noted "revenuecat-test-store-webhook". Store it as ${WEBHOOK_BYPASS_ENV} in .env.preview (and as a Sensitive note in the team vault); never reuse ${READ_BYPASS_ENV}.`,
    '2. Confirm the API preview environment names TEST_ENV=preview, REVENUECAT_WEBHOOK_AUTH and REVENUECAT_SECRET_API_KEY (names only; the values stay where they are).',
    `3. RevenueCat, the Test Store project (never production), Integrations, Webhooks, add one: URL ${webhookUrlShape(apiOrigin)} with the secret from step 1 in place of the placeholder; Authorization header value: the preview REVENUECAT_WEBHOOK_AUTH; environment: sandbox; events: all.`,
    `4. node scripts/test-store-preview-webhook.mjs probe --api-url ${new URL(apiOrigin).origin}  (both probes must reach the handler and get its 401)`,
    `5. node scripts/run-test-store-journey.mjs --server preview --api-url ${new URL(apiOrigin).origin} --platform <android|ios> --device <id> --build debug --out <dir>  (the proxy refuses every refresh, so the entitlement can arrive only by webhook)`,
  ]
}
