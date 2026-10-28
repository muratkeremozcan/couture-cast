import { expect, mergeTests, test as base, type Page } from '@playwright/test'
import { test as apiRequest } from '@seontechnologies/playwright-utils/api-request/fixtures'
import { test as interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call/fixtures'
import { attachGotoTimingOnFailure } from '../helpers/goto-timing'

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

// A failed navigation reports how far it got (request start, first byte, load) on every
// page of the test, including pages a test opens itself.
const gotoTiming = base.extend({
  context: async ({ context }, use, info) => {
    const opened = (page: Page) => attachGotoTimingOnFailure(page, info)
    context.on('page', opened)
    await use(context)
    context.off('page', opened)
  },
  page: async ({ page }, use, info) => {
    attachGotoTimingOnFailure(page, info)
    await use(page)
  },
})

export const test = mergeTests(
  base,
  interceptNetworkCall,
  apiRequest,
  pageErrors,
  gotoTiming
)

export { expect }
