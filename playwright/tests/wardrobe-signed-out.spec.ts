// Learning path Step 66: One app shell and visual system (coordinator add-on to PR 7.9).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-E2E-012, the signed-out Closet bug.
//
// Study build 2026-11-25 (7.7), reproduced by TEA on production (main, 812cadce) at 390 x 844 in a
// fresh browser that never signed in: /wardrobe showed three alerts to the visitor, with no API
// call made at all: "Your session expired. Sign in again before adding a garment.", "Unable to
// load your account, so Silhouette settings are unavailable right now. Reload the page to try
// again." and "Unable to check your closet setup progress." A visitor has no session to expire
// and no account that failed to load. Decision (safest for a first visit, recorded in spec-7-9):
// the signed-out Closet shows no error, offers sign-in, and its add action leads to sign-in.
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import { expect, test } from '../support/fixtures/merged-fixtures'

const MEMBER_ERRORS = [
  enUS.wardrobe.capture.errors.signedOut,
  enUS.wardrobe.capture.errors.sessionExpired,
  enUS.wardrobe.hub.accountFailed,
  enUS.wardrobe.hub.setupFailed,
]

test.describe('Closet for a visitor who never signed in', () => {
  test.use({
    authSessionEnabled: false,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test('[P0] [7.9-E2E-012] /wardrobe shows no error to a visitor and offers sign-in', async ({
    page,
  }) => {
    await page.goto('/wardrobe')
    await expect(page.locator('html')).toHaveAttribute('data-session', 'none')
    await expect(
      page.locator('[data-testid="screen-gate"][data-screen="closet"][data-ready="true"]')
    ).toBeVisible()

    // The sign-in offer renders once the page knows there is no member: the same pass that
    // raised the three errors. From then on no error is on screen.
    const signIn = page
      .getByRole('main')
      .getByRole('link', { name: enUS.community.notifications.signin })
    await expect(signIn).toBeVisible()
    await expect(signIn).toHaveAttribute('href', /^\/signin/)
    // In main: a production build also renders Next's route announcer (role alert, outside main),
    // which is no error (Vercel Preview e2e on 3d7af2a2).
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    for (const message of MEMBER_ERRORS)
      await expect(page.getByText(message, { exact: false }), message).toHaveCount(0)

    // Adding a garment is a member action: the visitor is taken to sign in, not told a session
    // expired. Story CC-7.11 D4: Add, the Closet's one gold primary, sits in the top bar.
    const add = page.getByTestId('app-header').getByTestId('garment-capture-open')
    await expect(add).toHaveAttribute('data-gold', 'primary')
    await add.click()
    await expect(page).toHaveURL(/\/signin/)
  })
})
