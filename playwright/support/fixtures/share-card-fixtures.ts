import fs from 'node:fs'
import path from 'node:path'
import { expect, mergeTests, test as base, type Page } from '@playwright/test'
import pg from 'pg'
import { test as apiRequest } from '@seontechnologies/playwright-utils/api-request/fixtures'
import { test as interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call/fixtures'
import { attachGotoTimingOnFailure } from '../helpers/goto-timing'
import {
  ownedDatabaseTurn,
  type OwnedDatabaseTurn,
} from '../../../scripts/lib/owned-database-turn.mjs'

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

// The workers share one owned database, and the P-WATERMARK barrier needs it to itself:
// each test holds this turn shared, and the barrier takes it exclusive
// (scripts/lib/owned-database-turn.mjs). One connection per worker holds it.
const databaseTurn = base.extend<
  { ownedDatabaseTurn: OwnedDatabaseTurn },
  { ownedDatabaseTurnClient: pg.Client }
>({
  ownedDatabaseTurnClient: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const directory = path.resolve(
        process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
      )
      const { DATABASE_URL: url } = JSON.parse(
        fs.readFileSync(path.join(directory, 'owned-env.json'), 'utf8')
      ) as { DATABASE_URL: string }
      if (!/^\/tea_community_[a-f0-9]{32}$/.test(new URL(url).pathname))
        throw new Error('owned_uuid_required')
      const client = new pg.Client({ connectionString: url })
      await client.connect()
      await use(client)
      await client.end()
    },
    { scope: 'worker' },
  ],
  ownedDatabaseTurn: [
    async ({ ownedDatabaseTurnClient }, use) => {
      const turn = ownedDatabaseTurn(ownedDatabaseTurnClient)
      await turn.share()
      await use(turn)
      await turn.release()
    },
    { auto: true },
  ],
})

export const test = mergeTests(
  base,
  interceptNetworkCall,
  apiRequest,
  pageErrors,
  gotoTiming,
  databaseTurn
)

export { expect }
