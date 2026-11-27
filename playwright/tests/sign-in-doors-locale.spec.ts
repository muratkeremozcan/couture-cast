// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// TEA sign-off N-1 (2026-11-16): a French browser got "Continue with Google" and "or" on /signup
// and /signin while <html lang> said fr-FR. The layout switched the language before the page
// had subscribed to the change, so anything that did not re-render for its own reasons kept
// the server's English. Signed out, no backend call is needed to see it.
import { expect, test } from '../support/fixtures/merged-fixtures'

test.describe('the sign-in doors in a French browser', () => {
  test.use({ locale: 'fr-FR' })

  test('/signup renders its copy, Google button and divider in French', async ({
    page,
  }) => {
    await page.goto('/signup')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR')
    await expect(page.getByTestId('google-sign-in')).toHaveText('Continuer avec Google')
    await expect(page.getByRole('separator')).toHaveAttribute('aria-label', 'ou')
    // CC-7.9 D6: the top bar owns the page's one h1; the page's own heading is an h2.
    await expect(
      page.getByTestId('app-header').getByRole('heading', { level: 1 })
    ).toHaveText('Créer le compte')
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'Saisis ta date de naissance',
      })
    ).toBeVisible()
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Créer le compte' })).toBeVisible()
  })

  test('/signin renders its heading, Google button and divider in French', async ({
    page,
  }) => {
    await page.goto('/signin')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR')
    await expect(page.getByTestId('google-sign-in')).toHaveText('Continuer avec Google')
    await expect(page.getByRole('separator')).toHaveAttribute('aria-label', 'ou')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Se connecter')
  })
})
