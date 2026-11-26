// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
//
// Jade's "Upload fail" investigation found a second, user-visible fault on production: opening
// /wardrobe in a fresh tab, or reloading it, painted "Your session expired. Sign in again before
// adding a garment." and left Silhouette disabled (Silhouette is its own route since CC-7.11), because a fresh document dropped the verified
// bearer until the profile check answered and the hub read the bearer once, at mount, inside that
// window. It was fixed in #260 (the stored principal and the retrying hub reads); only the owned
// real-session lane, which is not a production check, held it. This is the production check, as
// the one persistent synthetic member on a phone-sized viewport, and it reads only: the wardrobe
// hub's own closet and setup-progress reads, no upload and no write.
//
// The member's session is stored for the one trusted production web origin, in memory, and the
// context starts with empty session storage, like a new tab. The fixture keeps traces, video and
// screenshots off. See playwright/tests/prod-synthetic-member.prod.spec.ts for the canary.
import {
  assertTrustedProdOrigins,
  prodMemberStorageState,
} from '../support/helpers/prod-synthetic-member'
import { projectMetadata } from '../support/helpers/api-test'
import { expect, test } from '../support/fixtures/prod-member-fixture'

const CLOSET_READ = /\/api\/v1\/wardrobe\/garments(\?|$)/

test.describe('The wardrobe hub on production, signed in on a phone', () => {
  test('[P0] a fresh tab and a reload both open the hub with the account loaded, never "Your session expired"', async ({
    browser,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production project.')
    const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)
    // A phone-sized viewport with touch, as Jade's phone: a new context, so empty session storage.
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      storageState: prodMemberStorageState(prodMember!, webBaseUrl!),
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    })
    try {
      const page = await context.newPage()

      for (const [label, open] of [
        ['a fresh tab', () => page.goto('/wardrobe')],
        ['a reload', () => page.reload()],
      ] as const) {
        // The hub's own closet read answers 200 with the member's session.
        const closet = page.waitForResponse(
          (response) =>
            CLOSET_READ.test(response.url()) && response.request().method() === 'GET'
        )
        await open()
        expect((await closet).status(), `closet read on ${label}`).toBe(200)

        // Story CC-7.11 D1: the tab title reads Closet.
        await expect(
          page.getByRole('heading', { level: 1, name: 'Closet' }),
          label
        ).toBeVisible()
        // Story CC-7.11 D4, D6: the Silhouette button left the Closet for its own route, so it
        // can no longer prove the account loaded. The Closet gate opens only once the user id
        // the hub resolves from the session has answered (CC-7.7 D3), and with a member Add is
        // the capture button, not the visitor's sign-in link.
        await expect(
          page.locator('[data-testid="screen-gate"][data-ready="true"]'),
          `Closet gate on ${label}`
        ).toBeVisible()
        await expect(
          page.getByTestId('app-header').getByTestId('garment-capture-open'),
          `member Add on ${label}`
        ).toHaveJSProperty('tagName', 'BUTTON')
        await expect(page.getByText('Your session expired')).toHaveCount(0)
        await expect(page.getByText('Unable to load your account')).toHaveCount(0)
        await expect(
          page.getByText('Unable to check your closet setup progress.')
        ).toHaveCount(0)
      }
    } finally {
      await context.close()
    }
  })
})
