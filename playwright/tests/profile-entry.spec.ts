// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade, 2026-11-19: "Profile is missing." Settings had no entry on a desktop (the bottom nav hides
// at 768 px and the header nav had no link), and the page was not called Profile. Anyone, signed
// in or not, must find the Profile from the first page at both widths and land on a page that
// says Profile. UL-6 and UL-7 (location-use-my-location.spec.ts) prove the signed-in page on the
// local lane; this spec has no tag and no member, so it also runs against a preview and in the
// daily production run, where a missing link or a broken route turns the status red.
import { expect, test } from '../support/fixtures/merged-fixtures'

// Signed out on every environment: the entry is the same for a visitor and a member.
test.use({ authSessionEnabled: false })

for (const viewport of [
  {
    name: 'desktop',
    size: { width: 1280, height: 800 },
    nav: 'primary-nav',
    link: 'nav-profile',
  },
  {
    name: 'phone',
    size: { width: 390, height: 844 },
    nav: 'sticky-bottom-nav',
    link: 'bottom-nav-settings',
  },
] as const) {
  test(`[P0] ${viewport.name}: the first page has a Profile link, and it opens the Profile page`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport.size)
    await page.goto('/')

    const nav = page.getByTestId(viewport.nav)
    await expect(nav).toBeVisible()
    const profileLink = nav.getByTestId(viewport.link)
    await expect(profileLink).toBeVisible()
    await expect(profileLink).toHaveAccessibleName('Profile')
    await expect(profileLink).toHaveAttribute('href', '/settings')
    // The old name never returns as a visible link.
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)

    await profileLink.click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profile')
    // Everything the page held is still there: Locations, and the member sections.
    await expect(page.getByTestId('locations-section')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible()
  })
}
