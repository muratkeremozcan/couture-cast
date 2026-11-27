// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade's three reports on 2026-11-19 (Profile missing, location permission, "City search
// unavailable") all lived where no production check was signed in: the production run had no
// member, so every member-only path was untested there. This is the canary for the member it now
// signs in as (scripts/ops/provision-prod-synthetic-member.mjs): if the password rotates, the
// account goes, or production stops accepting its session, the daily status run goes red here
// before any member-only check pretends to run. Read-only: it reads the member's own profile.
//
// The bearer reaches only the production origins pinned in the helper. A manual run with another
// base URL fails here instead of sending the token to it.
import {
  assertTrustedProdOrigins,
  prodMemberApiGet,
  prodMemberStorageState,
} from '../support/helpers/prod-synthetic-member'
import { projectMetadata } from '../support/helpers/api-test'
import { expect, test } from '../support/fixtures/prod-member-fixture'

test.describe('The production synthetic member', () => {
  test('[P0] production accepts its session and names the member', async ({
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production project.')
    const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)

    const response = await prodMemberApiGet(
      prodMember!,
      apiBaseUrl!,
      '/api/v1/user/profile'
    )

    expect(response.status).toBe(200)
    const { user } = response.body as { user: { email: string; role: string } }
    expect(user.email.toLowerCase()).toBe(prodMember!.email)
    expect(user.role).toBe('guardian')
  })

  test('[P0] the web app signs the member in from its stored session and shows the profile', async ({
    browser,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production project.')
    const { baseUrl: webBaseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(webBaseUrl!, apiBaseUrl!)
    // The session is stored for the one production web origin, in memory.
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      storageState: prodMemberStorageState(prodMember!, webBaseUrl!),
    })
    try {
      const page = await context.newPage()
      await page.goto('/settings')

      // The account and places destinations restore the same verified session.
      await page.getByTestId('profile-account-row').click()
      await expect(page.getByTestId('profile-account')).toContainText(prodMember!.email)
      await page.getByTestId('app-top-bar-back').click()
      await page.getByTestId('profile-places-row').click()
      await expect(page.getByTestId('locations-section')).toHaveAttribute(
        'data-state',
        'ready'
      )
    } finally {
      await context.close()
    }
  })
})
