import { expect, mergeTests, test as base } from '@playwright/test'
import { test as apiRequest } from '@seontechnologies/playwright-utils/api-request/fixtures'
import { test as validateSchema } from '@seontechnologies/playwright-utils/api-request/schema-validation'
import {
  createAuthFixtures,
  setAuthProvider,
  type AuthFixtures,
  type AuthOptions,
} from '@seontechnologies/playwright-utils/auth-session'
import { test as fileUtils } from '@seontechnologies/playwright-utils/file-utils/fixtures'
import { test as interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call/fixtures'
import { captureTestContext } from '@seontechnologies/playwright-utils/log'
import { test as log } from '@seontechnologies/playwright-utils/log/fixtures'
import { test as networkRecorder } from '@seontechnologies/playwright-utils/network-recorder/fixtures'
import { createNetworkErrorMonitorFixture } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
import { WireMockWebhookProvider } from '@seontechnologies/playwright-utils/webhook'
import { test as webhookFixture } from '@seontechnologies/playwright-utils/webhook/fixtures'
import { test as recurse } from '@seontechnologies/playwright-utils/recurse/fixtures'
import { resolveEnvironmentConfig } from '../../config/environments'
import { drainApiProxy } from '../helpers/browser-api-proxy'
import {
  guardExpectedError,
  RITUAL_RESPONSE_URL,
  unexpectedRitualErrors,
} from '../helpers/expected-error-guard'
import {
  createImmutableAssetCache,
  type ImmutableAssetCache,
} from '../helpers/immutable-asset-cache'
import coutureCastAuthProvider from '../auth-session/custom-auth-provider'

// Register the provider in the fixture module, not only global setup, so UI mode,
// --list, and direct spec execution all resolve auth-session the same way.
setAuthProvider(coutureCastAuthProvider)

const environment = resolveEnvironmentConfig()
const authFixtures = createAuthFixtures()
const defaultAuthOptions: AuthOptions = {
  authBaseUrl: environment.apiBaseUrl,
  baseUrl: environment.webBaseUrl,
  environment: environment.name,
  userIdentifier: process.env.AUTH_SESSION_USER_IDENTIFIER?.trim() || 'guardian',
}

// Auth-session is part of the standard fixture path for local. For non-local
// environments (preview, prod) the provider is not yet wired up, so auth-session
// is disabled by default — tests that explicitly set authSessionEnabled:true and
// supply a compatible authOptions.environment can still opt in.
// Only tests proving signed-out behavior should opt out in local with authSessionEnabled: false.
const authSession = base.extend<AuthFixtures>({
  authOptions: [defaultAuthOptions, { option: true }],
  authSessionEnabled: [environment.name === 'local', { option: true }],
  authToken: authFixtures.authToken,
  context: authFixtures.context,
  page: authFixtures.page,
})

// Story 4.4 Task 8 owner: `wardrobe-onboarding.controller.ts` and
// `wardrobe-silhouette.controller.ts` (Task 3/4) merged to `main` well before
// this task, so the exclusion previously here (dated from a stacked-branch
// window where those routes genuinely 404'd) is stale and has been removed;
// both routes are real and should be held to the same network-error bar as
// every other endpoint.
//
// Story 6.13: the moderation console probes evidence export, which answers 503 by contract while
// moderation history is off, as it is on deployed environments. Whether a test sees that answer
// depends on whether the probe lands before the test ends (P-Q-MEDIA on preview, 1 run in 25), so
// deployed runs exclude it. Locally the feature is on and any 5xx from it still fails the test.
export { RITUAL_RESPONSE_URL }
const networkErrorMonitor = base
  .extend(
    createNetworkErrorMonitorFixture({
      excludePatterns: [
        RITUAL_RESPONSE_URL,
        ...(environment.name === 'local'
          ? []
          : [/\/api\/v1\/moderation\/evidence-exports\/availability(\?|$)/]),
      ],
    })
  )
  .extend<{ ritualErrorGuard: void }>({
    ritualErrorGuard: [
      async ({ context }, use, testInfo) => {
        // The monitor filters by URL. Preserve monitoring of every ritual failure
        // except the exact no-city response that Home converts into city setup.
        const guard = guardExpectedError(context, RITUAL_RESPONSE_URL)
        await use()
        if (testInfo.annotations.some(({ type }) => type === 'skipNetworkMonitoring'))
          return
        // Navigation can abort the JSON body after the HTTP status arrives.
        const unexpected = unexpectedRitualErrors(await guard.settle())
        expect(unexpected, 'unexpected ritual HTTP errors').toEqual([])
      },
      { auto: true },
    ],
  })

// Story 6.13: before the context closes, so a proxied call still in flight cannot leave a report secret.
const drainedProxyPage = base.extend({
  page: async ({ page }, use) => {
    await use(page)
    await drainApiProxy(page)
  },
})

// One asset cache per worker: each test's page loads the web app's hashed build output from it
// after the worker's first request for each file (helpers/immutable-asset-cache.ts).
const immutableAssetPage = base.extend<
  Record<never, never>,
  { immutableAssetCache: ImmutableAssetCache }
>({
  immutableAssetCache: [
    async ({}, use) => {
      await use(createImmutableAssetCache())
    },
    { scope: 'worker' },
  ],
  page: async ({ page, immutableAssetCache }, use) => {
    await immutableAssetCache.attach(page.context())
    await use(page)
    // Before the context closes, so no asset fetch is disposed into the report.
    await immutableAssetCache.detach(page.context())
  },
})

// Service-role headers belong to API seeding only. Browser contexts carry none, so
// every page proves the app sends its own bearer (see environments.ts apiHeaders).
const serviceRequest = base.extend({
  request: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: environment.apiHeaders,
    })
    await use(request)
    await request.dispose()
  },
})

// Story 6.12: the capture server the local stack's SLA sweep posts to. Lazy: only a test that asks
// for `webhookRegistry` pays for it, and matched-only cleanup keeps parallel workers apart.
const webhookProvider = base.extend<{ webhookProvider: WireMockWebhookProvider }>({
  webhookProvider: async ({ request }, use) => {
    const port = process.env.MODERATION_OPS_CAPTURE_PORT || '4319'
    await use(new WireMockWebhookProvider(`http://127.0.0.1:${port}`, request))
  },
})

// Compose base Playwright test with playwright-utils fixtures and local fixtures.
export const test = mergeTests(
  base,
  webhookFixture,
  webhookProvider,
  serviceRequest,
  authSession,
  interceptNetworkCall,
  apiRequest,
  validateSchema,
  fileUtils,
  log,
  networkRecorder,
  networkErrorMonitor,
  recurse,
  drainedProxyPage,
  immutableAssetPage
)

// Capture Playwright test context and mock PostHog ingest endpoints before every test.
// Note: Use `void` (not `await`) on `interceptNetworkCall` here because these are passive
// background stubs. Invoking `interceptNetworkCall` registers `page.route` synchronously,
// whereas awaiting the returned promise would block `beforeEach` until network traffic occurs
// (which only happens after subsequent page navigation).
test.beforeEach(({ interceptNetworkCall }, testInfo) => {
  captureTestContext(testInfo)

  // Mock PostHog ingest endpoints to return 200 OK
  void interceptNetworkCall({
    url: '**/ingest/static/**',
    fulfillResponse: {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
      body: '/* mocked posthog asset */',
    },
  })

  void interceptNetworkCall({
    url: '**/ingest/**',
    handler: async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'mocked',
        })
      }
    },
  })
})

export { expect }
