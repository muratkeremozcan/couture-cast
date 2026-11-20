// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade, 2026-11-19: "Profile is missing", "App needs access to location ... or the app accesses it
// with user approval", "City search unavailable". Her city search failed because the deployed
// API had no weather provider keys; no check was signed in on production, so none could see it.
// These run in the daily production run as the synthetic member (prod-member-fixture.ts) and are
// read-only: they search and read, and save nothing. A deployment whose provider is unconfigured
// or down turns the status red at the search, and the Profile and the denied-location path are
// proved signed in.
//
// Production only (`*.prod.spec.ts`): the fixture-bearer versions run on the local lane
// (location-use-my-location.spec.ts UL-2, UL-6) and preview (api/location-search.api.spec.ts).
import { locationSearchResponseSchema } from '@couture/api-client/contracts/http'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { projectMetadata } from '../support/helpers/api-test'
import {
  assertTrustedProdOrigins,
  prodMemberApiGet,
  prodMemberStorageState,
  type ProdSyntheticMember,
} from '../support/helpers/prod-synthetic-member'
import { expect, test } from '../support/fixtures/prod-member-fixture'

const FROM_COORDINATES = '/api/v1/locations/from-coordinates'
const DENIED = 'Location access is off. Search for your city instead.'
const NO_PROD = 'The synthetic member exists only in the production project.'

/** A context that holds the synthetic member, in memory, for the one production web origin. */
async function memberContext(
  browser: Browser,
  member: ProdSyntheticMember,
  baseURL: string,
  viewport: { width: number; height: number }
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    viewport,
    storageState: prodMemberStorageState(member, baseURL),
  })
}

/** Opens Settings as the member and waits for Locations to finish loading. */
async function openLocations(page: Page) {
  await page.goto('/settings')
  const section = page.getByTestId('locations-section')
  await expect(section).toHaveAttribute('data-state', 'ready')
  return section
}

const SEARCH_LABEL = 'Search for a city'

test.describe('Profile and location in production, as the synthetic member', () => {
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
    test(`[P0] ${viewport.name}: the Profile link opens the member's Profile with their account`, async ({
      browser,
      prodMember,
    }, testInfo) => {
      test.skip(!prodMember, NO_PROD)
      const { baseUrl, apiBaseUrl } = projectMetadata(testInfo)
      assertTrustedProdOrigins(baseUrl!, apiBaseUrl!)
      const context = await memberContext(browser, prodMember!, baseUrl!, viewport.size)
      try {
        const page = await context.newPage()
        await page.goto('/')
        await page.getByTestId(viewport.nav).getByTestId(viewport.link).click()

        await expect(page).toHaveURL(/\/settings$/)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profile')
        await expect(page.getByTestId('profile-account')).toContainText(prodMember!.email)
      } finally {
        await context.close()
      }
    })
  }

  test('[P0] city search answers with Chicago, Illinois and a save token', async ({
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, NO_PROD)
    const { baseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(baseUrl!, apiBaseUrl!)

    // A search reads the provider and saves nothing: a deployment whose weather provider has no
    // key answers 503 provider_unavailable here, as it did for Jade.
    const response = await prodMemberApiGet(
      prodMember!,
      apiBaseUrl!,
      '/api/v1/locations/search?q=Chicago&locale=en-US'
    )

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const { data } = locationSearchResponseSchema.parse(response.body)
    const chicago = data.find(
      (candidate) =>
        candidate.city === 'Chicago' &&
        candidate.country === 'US' &&
        candidate.region === 'Illinois'
    )
    expect(chicago, JSON.stringify(data.map((c) => c.displayLabel))).toBeDefined()
    expect(chicago!.candidateToken.length).toBeGreaterThan(0)
  })

  test('[P0] the Locations search box lists Chicago, Illinois for the member', async ({
    browser,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, NO_PROD)
    const { baseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(baseUrl!, apiBaseUrl!)
    const context = await memberContext(browser, prodMember!, baseUrl!, {
      width: 390,
      height: 844,
    })
    try {
      const page = await context.newPage()
      const section = await openLocations(page)

      await section.getByRole('combobox', { name: SEARCH_LABEL }).fill('Chicago')

      // The option is read, never picked: nothing is saved.
      await expect(
        section.getByRole('option', { name: /Chicago, Illinois/ })
      ).toBeVisible()
      await expect(
        section.getByText('City search is temporarily unavailable')
      ).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('[P1] a member who denies location gets the reason and a working city search, and nothing is sent', async ({
    browser,
    prodMember,
  }, testInfo) => {
    test.skip(!prodMember, NO_PROD)
    const { baseUrl, apiBaseUrl } = projectMetadata(testInfo)
    assertTrustedProdOrigins(baseUrl!, apiBaseUrl!)
    // No permission is granted: the browser's answer to the prompt is a refusal.
    const context = await memberContext(browser, prodMember!, baseUrl!, {
      width: 390,
      height: 844,
    })
    try {
      await context.clearPermissions()
      const page = await context.newPage()
      const sent: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === FROM_COORDINATES) sent.push(request.url())
      })
      const section = await openLocations(page)

      await section.getByRole('button', { name: 'Use my location' }).click()

      await expect(section.getByRole('alert')).toHaveText(DENIED)
      expect(sent).toHaveLength(0)
      const search = section.getByRole('combobox', { name: SEARCH_LABEL })
      await expect(search).toBeFocused()
      await search.fill('Chicago')
      await expect(
        section.getByRole('option', { name: /Chicago, Illinois/ })
      ).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
