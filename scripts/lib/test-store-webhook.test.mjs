// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyProbe,
  operatorSteps,
  probeWebhook,
  READ_BYPASS_ENV,
  WEBHOOK_BYPASS_ENV,
  webhookUrl,
  webhookUrlShape,
} from './test-store-webhook.mjs'

const origin = 'https://couture-cast-api-git-feat-x-team.vercel.app'

test('the URL shape names the bypass secret by variable, and the real URL carries it as a query parameter', () => {
  assert.equal(
    webhookUrlShape(`${origin}/some/path`),
    `${origin}/api/v1/commerce/subscription/webhooks/revenuecat?x-vercel-protection-bypass=<${WEBHOOK_BYPASS_ENV}>`
  )
  const url = webhookUrl(origin, 'fixture-secret')
  assert.equal(url.pathname, '/api/v1/commerce/subscription/webhooks/revenuecat')
  assert.equal(url.searchParams.get('x-vercel-protection-bypass'), 'fixture-secret')
})

test('only the handler JSON 401 passes a probe', () => {
  const handler = {
    status: 401,
    contentType: 'application/json; charset=utf-8',
    body: '{"message":"Invalid webhook credentials.","error":"Unauthorized","statusCode":401}',
  }
  assert.equal(classifyProbe(handler), 'handler-rejected')
  assert.equal(
    classifyProbe({
      status: 401,
      contentType: 'text/html',
      body: '<title>Authentication Required</title>',
    }),
    'vercel-protection'
  )
  assert.equal(classifyProbe({ ...handler, status: 200 }), 'auth-not-enforced')
  assert.equal(
    classifyProbe({ status: 404, contentType: 'application/json' }),
    'route-missing'
  )
  assert.equal(classifyProbe({ ...handler, body: '{"message":"other"}' }), 'unexpected')
})

const answer = (status, contentType, body) => ({
  status,
  headers: { get: () => contentType },
  text: async () => body,
})

test('the probe sends no Authorization, then a wrong one, and records no secret', async () => {
  const sent = []
  const record = await probeWebhook({
    apiOrigin: origin,
    secret: 'fixture-secret',
    fetchImpl: async (url, init) => {
      sent.push({ url: String(url), authorization: init.headers.authorization })
      return answer(401, 'application/json', '{"message":"Invalid webhook credentials."}')
    },
  })
  assert.deepEqual(
    sent.map((entry) => entry.authorization),
    [undefined, 'test-store-probe-wrong-value']
  )
  assert.ok(
    sent.every((entry) => entry.url.includes('x-vercel-protection-bypass=fixture-secret'))
  )
  assert.equal(record.authStillRequired, true)
  assert.equal(record.bypassSecret, WEBHOOK_BYPASS_ENV)
  assert.doesNotMatch(JSON.stringify(record), /fixture-secret/)
})

test('a Vercel login page or an accepted unauthenticated POST fails the probe', async () => {
  await assert.rejects(
    probeWebhook({
      apiOrigin: origin,
      secret: 's',
      fetchImpl: async () => answer(401, 'text/html', 'Authentication Required'),
    }),
    /test_store_webhook_probe_vercel-protection/
  )
  await assert.rejects(
    probeWebhook({
      apiOrigin: origin,
      secret: 's',
      fetchImpl: async () => answer(200, 'application/json', '{"received":true}'),
    }),
    /test_store_webhook_probe_auth-not-enforced/
  )
})

test('the operator steps name a dedicated bypass secret and never the shared one as the webhook bypass', () => {
  const steps = operatorSteps(origin).join('\n')
  assert.match(steps, new RegExp(WEBHOOK_BYPASS_ENV))
  assert.match(steps, /never reuse VERCEL_AUTOMATION_BYPASS_SECRET/)
  assert.match(steps, /REVENUECAT_WEBHOOK_AUTH/)
  assert.ok(steps.includes(`<${WEBHOOK_BYPASS_ENV}>`))
  assert.notEqual(WEBHOOK_BYPASS_ENV, READ_BYPASS_ENV)
})
