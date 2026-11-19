// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
//
// Production feedback 2026-11-19: the lookbook on /community stayed white under a dark system
// setting while Wardrobe and Moderation follow it, the "Community inspirations" label repeated
// the "Latest looks" heading, and the notifications link floated alone between the chips and the
// feed. The lookbook now reads surface tokens with dark values for the Default system, and the
// feed's actions (New post and a bell for members, Sign in for guests) sit in the heading row.
import { type Locator, type Page } from '@playwright/test'
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import { checkA11y, contrastRatio } from '../support/helpers/accessibility'
import {
  communityTest as test,
  completedCommunityFeed,
  expect,
  expectCommunityFeedLoaded,
} from '../support/helpers/community-session'

const DARK_SURFACE = 'rgb(18, 18, 20)'
const LIGHT_SURFACE = 'rgb(255, 255, 255)'

const filtersOf = (page: Page) =>
  page
    .getByTestId('community-page')
    .getByRole('navigation', { name: 'Community filters' })

const heading = (page: Page) =>
  filtersOf(page).getByRole('heading', { name: enUS.community.heading, exact: true })

/** The lookbook surface the community page paints, and the color its heading is drawn in. */
async function surfaceAndInk(page: Page) {
  return page.getByTestId('community-page').evaluate((section) => {
    const surface = section.querySelector('.lookbook-body') ?? section
    const title = section.querySelector('nav h2')
    return {
      surface: getComputedStyle(surface).backgroundColor,
      ink: title ? getComputedStyle(title).color : '',
      scheme: window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
    }
  })
}

/** An action sits in the heading row: its vertical middle falls inside the heading's box. */
async function expectInHeadingRow(page: Page, action: Locator) {
  const title = (await heading(page).boundingBox())!
  const box = (await action.boundingBox())!
  const middle = box.y + box.height / 2
  expect(middle).toBeGreaterThanOrEqual(title.y)
  expect(middle).toBeLessThanOrEqual(title.y + title.height)
  expect(box.x).toBeGreaterThan(title.x + title.width)
}

test.describe('Community lookbook under the system color scheme (production follow-up)', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('3.6-E2E-009: a signed-out reader under a dark system setting gets a dark lookbook with Sign in in the heading row', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/community')
    await expect(heading(page)).toBeVisible()

    const { surface, ink, scheme } = await surfaceAndInk(page)
    expect(scheme).toBe('dark')
    expect(surface).toBe(DARK_SURFACE)
    expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5)

    const signIn = filtersOf(page).getByRole('link', {
      name: enUS.community.notifications.signin,
      exact: true,
    })
    await expect(signIn).toBeVisible()
    await expect(signIn).toHaveAttribute('href', '/signin')
    await expectInHeadingRow(page, signIn)
    await expect(page.getByTestId('create-post-button')).toHaveCount(0)
    // The label that repeated the heading is gone from the page.
    await expect(page.getByText('Community inspirations')).toHaveCount(0)

    await checkA11y(page)
  })

  test('3.6-E2E-010: a member under a dark system setting gets New post and a named bell in the heading row', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 1280, height: 900 })
    const feed = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await feed).status).toBe(200)
    await expectCommunityFeedLoaded(page)

    const { surface, ink } = await surfaceAndInk(page)
    expect(surface).toBe(DARK_SURFACE)
    expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5)

    const bell = filtersOf(page).getByRole('link', {
      name: enUS.community.notifications.title,
      exact: true,
    })
    await expect(bell).toBeVisible()
    await expect(bell).toHaveAttribute('href', '/notification-settings')
    // The bell is an icon: its glyph is the only thing that tells a sighted member what it is, so
    // it meets the 3:1 non-text contrast on the surface it sits on.
    const glyph = await bell.evaluate((link) => getComputedStyle(link).color)
    expect(contrastRatio(glyph, surface)).toBeGreaterThanOrEqual(3)
    await expectInHeadingRow(page, bell)

    const newPost = filtersOf(page).getByRole('button', {
      name: enUS.community.newPost,
      exact: true,
    })
    await expect(newPost).toBeVisible()
    await expectInHeadingRow(page, newPost)
    // One of each: the actions are not rendered a second time outside the heading row.
    await expect(
      page.getByRole('link', { name: enUS.community.notifications.title })
    ).toHaveCount(1)
    await expect(page.getByTestId('create-post-button')).toHaveCount(1)
    await expect(page.getByText('Community inspirations')).toHaveCount(0)

    await checkA11y(page)
  })

  test('3.6-E2E-011: a light system setting keeps the light lookbook, and a premium palette stays light under a dark one', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/community')
    await expect(heading(page)).toBeVisible()
    const light = await surfaceAndInk(page)
    expect(light.scheme).toBe('light')
    expect(light.surface).toBe(LIGHT_SURFACE)
    expect(contrastRatio(light.ink, light.surface)).toBeGreaterThanOrEqual(4.5)
    await checkA11y(page)

    // A premium palette is a light design its member chose. Its `data-theme` on the root keeps
    // the light surface whatever the system setting says; the Default system turns dark.
    await page.emulateMedia({ colorScheme: 'dark' })
    expect((await surfaceAndInk(page)).surface).toBe(DARK_SURFACE)
    for (const palette of ['jewel_radiance', 'autumn_umber', 'winter_metallic']) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        palette
      )
      expect((await surfaceAndInk(page)).surface, palette).toBe(LIGHT_SURFACE)
    }
  })
})
