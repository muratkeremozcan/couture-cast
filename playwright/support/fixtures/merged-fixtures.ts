import { expect, mergeTests, test as base } from '@playwright/test'
import { test as apiRequest } from '@seontechnologies/playwright-utils/api-request/fixtures'
import { test as validateSchema } from '@seontechnologies/playwright-utils/api-request/schema-validation'
import { test as fileUtils } from '@seontechnologies/playwright-utils/file-utils/fixtures'
import { test as interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call/fixtures'
import { captureTestContext } from '@seontechnologies/playwright-utils/log'
import { test as log } from '@seontechnologies/playwright-utils/log/fixtures'
import { test as networkRecorder } from '@seontechnologies/playwright-utils/network-recorder/fixtures'
import { test as networkErrorMonitor } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
import { test as recurse } from '@seontechnologies/playwright-utils/recurse/fixtures'

// Capture Playwright test context for playwright-utils logging before every test.
base.beforeEach(({}, testInfo) => {
  captureTestContext(testInfo)
})

// Compose base Playwright test with playwright-utils fixtures and local fixtures.
export const test = mergeTests(
  base,
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
