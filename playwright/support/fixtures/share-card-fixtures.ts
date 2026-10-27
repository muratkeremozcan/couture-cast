import { expect, mergeTests, test as base } from '@playwright/test'
import { test as apiRequest } from '@seontechnologies/playwright-utils/api-request/fixtures'
import { test as interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call/fixtures'

// The share-card lane runs only against scripts/e2e-share-card's owned UUID runtime.
// merged-fixtures.ts loads .env files, signs in a shared auth-session user and sends
// service-role headers from `request`, all of which reach the shared local stack, so
// this lane composes the same playwright-utils fixtures without those pieces.
const pageErrors = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await use(errors)
      expect(errors, 'uncaught page errors').toEqual([])
    },
    { auto: true },
  ],
})

export const test = mergeTests(base, interceptNetworkCall, apiRequest, pageErrors)

export { expect }
