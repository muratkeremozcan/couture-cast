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
import { test as recurse } from '@seontechnologies/playwright-utils/recurse/fixtures'
import { resolveEnvironmentConfig } from '../../config/environments'
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
const networkErrorMonitor = base.extend(createNetworkErrorMonitorFixture())

// Compose base Playwright test with playwright-utils fixtures and local fixtures.
export const test = mergeTests(
  base,
  authSession,
  interceptNetworkCall,
  apiRequest,
  validateSchema,
  fileUtils,
  log,
  networkRecorder,
  networkErrorMonitor,
  recurse
)

// Capture Playwright test context and mock PostHog ingest endpoints before every test.
test.beforeEach(async ({ page }, testInfo) => {
  captureTestContext(testInfo)

  // Mock PostHog ingest endpoints to return 200 OK
  await page.route('**/ingest/static/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* mocked posthog asset */',
    })
  })

  await page.route('**/ingest/**', async (route) => {
    const request = route.request()
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
  })
})

export { expect }
