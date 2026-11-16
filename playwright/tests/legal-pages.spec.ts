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

    // Each sentence below was corrected in TEA's text review against the code; the pins keep
    // the page from drifting back to a claim the code does not back.
    test('the Privacy Policy states the Google sign-in data rules', async ({ page }) => {
      await page.goto('/privacy')
      const google = page.getByRole('region', { name: 'Signing in with Google' })
      await expect(google).toContainText('never copies your Google name or photo')
      // withoutProviderTokens strips Google's tokens before either client stores the session.
      await expect(google).toContainText(
        'No Google token is kept on our servers or in the sign-in session stored on your device.'
      )
      // A failed Auth Admin delete falls to the orphan sweep (TEA-4).
      await expect(google).toContainText(
        'under 13: we delete it right away, or, if that attempt fails, our daily cleanup deletes it once it is more than a day old.'
      )
      await expect(google).toContainText(
        'You leave without finishing: once it is more than a day old, our daily cleanup deletes it.'
      )
      // Antigravity P2-2: a failed DELETE on Cancel falls to the sweep too.
      await expect(google).toContainText(
        'Cancel on the birthdate step: we delete it right away, or, if that attempt fails, our daily cleanup deletes it once it is more than a day old.'
      )
    })

    test('the Privacy Policy describes analytics as each client sends it', async ({
      page,
    }) => {
      await page.goto('/privacy')
      const analytics = page.getByRole('region', { name: 'Analytics' })
      await expect(analytics).toContainText(
        'The website sends them through our own servers; the mobile app sends them to PostHog directly.'
      )
      // profile_completed carries age and guardian_consent_required (telemetry.service).
      await expect(analytics).toContainText(
        'also carries your age at signup and whether guardian consent is required'
      )
      // Antigravity P2-2: some server events send the account id itself, so nothing here may
      // call every event pseudonymous.
      await expect(analytics).toContainText(
        'Events our servers send identify your account by its internal account id (a random id, not your name or email address) or by a keyed hash of that id.'
      )
      await expect(analytics).not.toContainText('pseudonymous')
    })

    test('the Privacy Policy states that guardian consent ended and what OpenWeather receives', async ({
      page,
    }) => {
      await page.goto('/privacy')
      // GUARDIAN_CONSENT_POLICY is off (2026-11-16): no page may still promise a guardian lock.
      await expect(
        page.getByRole('region', { name: 'Who can use CoutureCast' })
      ).toHaveText(
        /CoutureCast is for people aged 13 and older\. Every signup, with email or with Google, asks for a birthdate\. Nobody under 13 can create an account\.$/
      )
      await expect(
        page.getByRole('region', { name: 'Earlier guardian consent records' })
      ).toContainText(
        "Until 16 November 2026, accounts for ages 13 to 15 needed a guardian's approval. CoutureCast no longer asks for it, and those accounts now work like any other."
      )
      for (const path of ['/privacy', '/terms']) {
        await page.goto(path)
        await expect(page.locator('main')).not.toContainText('until a guardian approves')
        await expect(page.locator('main')).not.toContainText('stay locked')
      }
      await page.goto('/privacy')
      await expect(
        page.getByRole('region', { name: 'Who processes your information' })
      ).toContainText(
        'It receives the place or city you enter and the coordinates of the places you get forecasts for.'
      )
    })

    test('the Privacy Policy lists every processor the code calls', async ({ page }) => {
      await page.goto('/privacy')
      const processors = page.getByRole('region', {
        name: 'Who processes your information',
      })
      for (const name of [
        'Supabase',
        'Vercel',
        'Northflank and Upstash',
        'PostHog',
        'Grafana Cloud',
        'OpenWeather',
        'Expo, with Apple and Google delivery',
        'Stripe',
        'Google',
      ])
        await expect(
          processors.getByRole('listitem').filter({ hasText: name })
        ).not.toHaveCount(0)
      // Mobile purchases run only against the RevenueCat Test Store, so it processes nothing yet.
      await expect(processors).not.toContainText('RevenueCat')
    })

    test('the Terms say the mobile apps sell no subscription yet', async ({ page }) => {
      await page.goto('/terms')
      const subscriptions = page.getByRole('region', { name: 'Subscriptions' })
      await expect(subscriptions).toContainText(
        'The mobile apps do not offer in-app subscriptions yet'
      )
      await expect(subscriptions).toContainText('billed through Stripe')
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
