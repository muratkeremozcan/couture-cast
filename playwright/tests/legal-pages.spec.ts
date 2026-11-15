// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D12: the public Privacy Policy and Terms of Service that Google's consent screen
// links to. Signed out, with JavaScript off, each page server-renders one h1 and its contact
// address, and every public entry point (home, signup, sign-in) links to both.
import { expect, test } from '../support/fixtures/merged-fixtures'

const legalPages = [
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Service' },
] as const

test.describe('Story 6.17 legal pages', () => {
  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    for (const { path, heading } of legalPages) {
      test(`${path} server-renders for a signed-out visitor`, async ({ page }) => {
        const response = await page.goto(path)
        expect(response?.status()).toBe(200)
        // No session check and no redirect: the page answers at its own address.
        expect(new URL(page.url()).pathname).toBe(path)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
        await expect(
          page.getByRole('link', { name: 'muratkerem@gmail.com' }).first()
        ).toHaveAttribute('href', 'mailto:muratkerem@gmail.com')
        // Indexable: nothing tells a crawler to skip it.
        await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
      })
    }

    test('the Privacy Policy states the Google sign-in data rules', async ({ page }) => {
      await page.goto('/privacy')
      const google = page.getByRole('region', { name: 'Signing in with Google' })
      await expect(google).toContainText('never copies your Google name or photo')
      await expect(google).toContainText('under 13: we delete it right away')
      await expect(google).toContainText('our daily cleanup deletes it')
    })
  })

  for (const entry of ['/', '/signup', '/signin'] as const) {
    test(`${entry} links to both legal pages`, async ({ page }) => {
      await page.goto(entry)
      const legal = page.getByRole('navigation', { name: 'Legal' })
      await expect(legal.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
        'href',
        '/privacy'
      )
      await expect(legal.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
        'href',
        '/terms'
      )
    })
  }
})
