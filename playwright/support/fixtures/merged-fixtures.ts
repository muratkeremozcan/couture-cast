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
import { test as networkErrorMonitor } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
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

// Capture Playwright test context for playwright-utils logging before every test.
base.beforeEach(({}, testInfo) => {
  captureTestContext(testInfo)
})

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

export { expect }
