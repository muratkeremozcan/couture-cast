// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
//
// WHAT THE FIXTURE SCREENER DOES AND DOES NOT BUY. It clears every image without
// looking at the bytes, and it is the only reason a published post is reachable
// here at all: the real ADR-013 model is not a dependency of this repository, so
// the default screener fails closed and every post terminates at `flagged`. A
// green run of this file is evidence about the publication pipeline, the feed,
// the cursor and the page. It is not evidence about image safety.
import { log } from '@seontechnologies/playwright-utils/log'
import { checkA11y } from '../support/helpers/accessibility'
import {
  communityTest as test,
  expect,
  COMMUNITY_FEED_URL,
  SEEDED_BAND,
  SEEDED_COMMUNITY_POSTS,
} from '../support/helpers/community-session'

/*
 * The community grid lives on the Lookbook Prism home page, inside its "Community
 * Section" region. `/community` is the mobile-destination stub
 * (`apps/web/src/app/components/mobile-destination-page.tsx`) and renders only an
 * `h1`, so a spec pointed there finds nothing and looks broken.
 */
const COMMUNITY_ROUTE = '/'

test.describe('6.1 community feed by climate band', () => {
  /*
   * The events poll answers 401 through the web origin and `networkErrorMonitor`
   * correctly fails a test on an unexpected failing request, so stubbing it keeps
   * the monitor armed for everything else. Same reason `lookbook-prism.spec.ts`
   * and `chip-navigation-bottom-nav.spec.ts` stub it.
   */
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('6.1-E2E-01 renders the signed-in community surface with one live region', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    /*
     * The grid container renders unconditionally for a signed-in reader, but with
     * zero items it has no layout box and `toBeVisible` fails on a zero-height
     * element. Attachment is the claim that holds today and keeps holding once the
     * feed has content.
     */
    await expect(page.getByTestId('community-card-grid')).toBeAttached()

    /*
     * Exactly one `role="status"`: several live regions announcing at once is a
     * real screen-reader defect, because the announcements race and the reader
     * hears whichever won. Scoped to the community surface, since the Story 3.6
     * chip-navigation bar has its own legitimate one and a page-wide count would
     * assert something this story never claimed.
     */
    const communitySection = page.getByRole('complementary', {
      name: /community lookbook/i,
    })
    await expect(communitySection.getByRole('status')).toHaveCount(1)
    await expect(page.getByTestId('community-live-region')).toBeAttached()
  })

  test('6.1-E2E-02 offers every defined filter and no undefined one', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    /*
     * KEYED ON THE TEST ID. The `auto` chip names the resolved band when there is
     * one ("Your climate: Temperate and wet"), so its accessible name is
     * data-dependent and a name selector would be flaky in exactly the situation
     * the chip matters.
     */
    const modes = [
      'auto',
      'all',
      'cold_wet',
      'cold_dry',
      'temperate_wet',
      'temperate_dry',
      'warm_wet',
      'warm_dry',
    ]
    for (const mode of modes) {
      await expect(page.getByTestId(`community-filter-${mode}`)).toBeVisible()
    }

    // Eight, and only eight. Story 6.1 deleted `New`, `Following`, `Near me` and
    // `Brands` because they had no server behavior, and the spec forbids an active
    // chip without one. A ninth chip reappearing is that regression.
    await expect(page.locator('[data-testid^="community-filter-"]')).toHaveCount(
      modes.length
    )

    await expect(
      page.getByRole('navigation', { name: 'Community filters' })
    ).toBeVisible()
  })

  test('6.1-E2E-03 restarts paging when the filter changes', async ({
    page,
    interceptNetworkCall,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)
    await expect(page.getByTestId('community-card-grid')).toBeAttached()

    const bandRequest = interceptNetworkCall({ method: 'GET', url: COMMUNITY_FEED_URL })
    await page.getByTestId(`community-filter-${SEEDED_BAND}`).click()
    const banded = await bandRequest

    /*
     * The cursor is bound to the mode it was minted under, so a filter change has
     * to restart paging. Asserting on the REQUEST the click produced is what proves
     * the client dropped the cursor: a client that kept it would send one here and
     * the server would answer 400.
     */
    expect(banded.request, 'the filter click issued a feed request').not.toBeNull()
    const requestedUrl = new URL(banded.request!.url())
    expect(requestedUrl.searchParams.get('mode')).toBe(SEEDED_BAND)
    expect(requestedUrl.searchParams.has('cursor')).toBe(false)
    expect(banded.status).toBe(200)

    const body = banded.responseJson as { data: { mode: string } } | null
    expect(body?.data.mode).toBe(SEEDED_BAND)
  })

  test('6.1-E2E-04 feed page passes axe', async ({ page, communitySession }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    /*
     * WAITING FOR A CARD, NOT FOR THE GRID. The grid container is attached even
     * with zero items — this file says so two tests up, which is why the other
     * assertions use `toBeAttached` — so an axe scan gated on attachment alone
     * runs against an empty tree and every card-level rule passes by having
     * nothing to examine. Image alt text, the accessible name of the report
     * control and the card's heading structure are exactly the rules this scan
     * exists for, and all of them live inside a card.
     */
    const firstCard = page.locator('[data-testid^="lookbook-card-"]').first()
    await expect(firstCard).toBeVisible()

    await checkA11y(page)
  })

  test('6.1-E2E-05 create-post modal passes axe and gates on confirmed alt text', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    const openControl = page.getByTestId('create-post-button')
    await expect(
      openControl,
      'create-post-button renders only with a web session; an empty locator here ' +
        'means the session fixture did not write couturecast.access-token, not ' +
        'that the control was removed.'
    ).toBeVisible()

    await log.step('Open the compose modal')
    await openControl.click()

    await expect(page.getByTestId('post-alt-text-input')).toBeVisible()
    const confirmAltText = page.getByTestId('confirm-alt-text-checkbox')
    await expect(confirmAltText).toBeVisible()

    /*
     * The contract types `altTextConfirmed` as the literal `true`, so an
     * unconfirmed publish cannot be expressed. The control starts unchecked: a
     * pre-checked confirmation confirms nothing.
     */
    await expect(confirmAltText).not.toBeChecked()

    await checkA11y(page)
  })

  test('6.1-E2E-06 renders the seeded feed and keeps the author pseudonymous', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    const firstSeeded = SEEDED_COMMUNITY_POSTS[0]
    const card = page.getByTestId(`lookbook-card-${firstSeeded.id}`)
    await expect(card).toBeVisible()
    await expect(page.getByTestId(`caption-${firstSeeded.id}`)).toHaveText(
      firstSeeded.caption
    )
    await expect(page.getByTestId(`climate-badge-${firstSeeded.id}`)).toBeVisible()

    // PSEUDONYMITY IS ASSERTED POSITIVELY, AS THE ALIAS FORMAT. This was
    // `not.toHaveText(/[0-9a-f]{8}-[0-9a-f]{4}/)`, which only excludes a lowercase
    // UUID prefix. A real profile name, an email local part and a seeded id like
    // `lookbook-1` all pass that, so the assertion could not fail for the
    // regression the test is named after: the projection handing back an author's
    // actual identity. `generateCommunityAuthorAlias` mints
    // `Style Explorer <8 uppercase hex>` and `CommunityAlias` stores it, so the
    // rendered name has exactly one legal shape and anything else is a leak.
    const authorName = page.getByTestId(`author-name-${firstSeeded.id}`)
    await expect(authorName).toBeVisible()
    await expect(authorName).toHaveText(/^Style Explorer [0-9A-F]{8}$/)

    await expect(page.getByTestId(`report-button-${firstSeeded.id}`)).toBeVisible()
    await expect(page.getByTestId(`withdraw-button-${firstSeeded.id}`)).toHaveCount(0)
  })

  test('6.1-E2E-07 report modal passes axe and records one report', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    await page.getByTestId(`report-button-${SEEDED_COMMUNITY_POSTS[0].id}`).click()
    await expect(page.getByTestId('report-reason-select')).toBeVisible()
    await checkA11y(page)

    await page.getByTestId('report-reason-select').selectOption('spam')
    await page.getByTestId('report-submit-button').click()
    await expect(page.getByTestId('community-action-notice')).toHaveAttribute(
      'data-tone',
      'success'
    )
  })

  test('6.1-E2E-08 resolves a deep link that lands outside the first page', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const target = SEEDED_COMMUNITY_POSTS[2]
    await page.goto(`/?source=notification&type=community&cardId=${target.id}`)

    // The contract inherited from `accessibility-hardening.spec.ts`, which could no
    // longer state it: a deep-link target receives programmatic focus and is
    // focusable only programmatically.
    const card = page.locator(`#lookbook-card-${target.id}`)
    await expect(card).toBeFocused()
    await expect(card).toHaveAttribute('tabindex', '-1')
    await checkA11y(page)
  })
})
