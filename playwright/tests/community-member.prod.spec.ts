// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade, 2026-11-19: "community is empty". Production read zero looks because the community flags
// were off, and the bottom-nav tab showed a placeholder. community-jade-signed-out.spec.ts proves
// the lookbook shell for a visitor; this file proves the member's side in production: the feed
// answers 200 with a list, and the signed-in /community page renders the real grid instead of the
// signed-out prompt. Read-only: nothing here posts, reacts or uploads (those run on the preview).
// The bearer reaches only the production origins pinned in the helper.
import { openCommunityClimate } from '../support/helpers/community-ui'
import type { Page } from '@playwright/test'
import { communityFeedResponseSchema } from '@couture/api-client/contracts/http'
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import { projectMetadata } from '../support/helpers/api-test'
import {
  assertTrustedProdOrigins,
  prodMemberApiGet,
  prodMemberStorageState,
} from '../support/helpers/prod-synthetic-member'
import { expect, test } from '../support/fixtures/prod-member-fixture'

const FEED_PATH = '/api/v1/community/feed'

function completedFeedRead(page: Page) {
  return page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'GET' &&
      new URL(candidate.url()).pathname === FEED_PATH
  )
}

test.describe('Community, as the production synthetic member', () => {
  test('[P0] JADE-COMMUNITY-004 the feed answers 200 with a list, so community is not switched off', async ({
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production project.')
    const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)

    const response = await prodMemberApiGet(
      prodMember!,
      apiBaseUrl!,
      `${FEED_PATH}?limit=3`
    )

    // 403 or 404 here is the flag-off state Jade met: the community was closed to members.
    expect(response.status).toBe(200)
    const feed = communityFeedResponseSchema.parse(response.body)
    expect(Array.isArray(feed.data.items)).toBe(true)
  })

  test('[P0] JADE-COMMUNITY-005 /community shows the member the real grid at phone width, not the signed-out prompt', async ({
    browser,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production project.')
    const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      viewport: { width: 412, height: 839 },
      isMobile: true,
      hasTouch: true,
      storageState: prodMemberStorageState(prodMember!, webBaseUrl!),
    })
    try {
      const page = await context.newPage()
      const feed = completedFeedRead(page)
      await page.goto('/community')
      expect((await feed).status()).toBe(200)

      const community = page.getByTestId('community-page')
      await expect(
        page.getByRole('heading', { name: 'Community', exact: true })
      ).toBeVisible()
      const filters = await openCommunityClimate(page)
      await expect(filters.getByTestId('community-filters-explainer')).toHaveText(
        enUS.community.filters.explainer
      )
      await page.keyboard.press('Escape')
      // The member's grid, which renders only for a signed-in reader. A signed-out visitor
      // gets the sign-in prompt instead.
      await expect(community.getByTestId('community-card-grid')).toBeAttached()
    } finally {
      await context.close()
    }
  })
})
