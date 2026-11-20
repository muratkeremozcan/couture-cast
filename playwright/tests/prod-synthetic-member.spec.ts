// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade's three reports on 2026-11-19 (Profile missing, location permission, "City search
// unavailable") all lived where no production check was signed in: the production run had no
// member, so every member-only path was untested there. This is the canary for the member it now
// signs in as (scripts/ops/provision-prod-synthetic-member.mjs): if the password rotates, the
// account goes, or production stops accepting its session, the daily status run goes red here
// before any member-only check pretends to run. Read-only: it reads the member's own profile.
import { projectMetadata, resolveApiBaseUrl } from '../support/helpers/api-test'
import {
  seedProdMemberBrowserSession,
  prodMemberHeaders,
} from '../support/helpers/prod-synthetic-member'
import { expect, test } from '../support/fixtures/prod-member-fixture'

// A trace records the member's bearer, and the artifacts of a public repository are public.
test.use({ trace: 'off' })

test.describe('The production synthetic member', () => {
  test('[P0] production accepts its session and names the member', async ({
    apiRequest,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production run.')
    const baseUrl = resolveApiBaseUrl(testInfo)

    const response = await apiRequest<{ user: { email: string; role: string } }>({
      method: 'GET',
      path: '/api/v1/user/profile',
      baseUrl,
      headers: prodMemberHeaders(prodMember!),
    })

    expect(response.status).toBe(200)
    expect(response.body.user.email.toLowerCase()).toBe(prodMember!.email)
    expect(response.body.user.role).toBe('guardian')
  })

  test('[P0] the web app signs the member in from its stored session and shows the profile', async ({
    context,
    page,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, 'The synthetic member exists only in the production run.')
    expect(projectMetadata(testInfo).environment).toBe('prod')
    await seedProdMemberBrowserSession(context, prodMember!)

    await page.goto('/settings')

    // The page verifies the stored session against production, then names the member.
    await expect(page.getByTestId('profile-account')).toContainText(prodMember!.email)
    await expect(page.getByTestId('locations-section')).toHaveAttribute(
      'data-state',
      'ready'
    )
  })
})
