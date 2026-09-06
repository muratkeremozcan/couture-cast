// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
// Story 6.1 Task 6: the web community feed against the real running stack.
//
// TWO BLOCKERS STOP A POST FROM REACHING THIS PAGE TODAY, and every `fixme` below
// names them rather than asserting around them. Both were established against a
// live local API, not inferred:
//
//  1. THE SEED WRITES `image_object_path` BUT NEVER UPLOADS THE OBJECT.
//     `packages/db/prisma/seeds/rituals.ts` publishes five `LookbookPost` rows
//     with paths like `community/lookbook-1/<hash>.jpg`, but nothing ever puts
//     bytes at those paths. `CommunityService.buildFeedItems` drops any post whose
//     image cannot be signed — it logs "Community post omitted from feed because
//     its image could not be signed" and `continue`s — so all five are silently
//     omitted and `GET /feed?mode=all` answers 200 with `items: []`. Measured with
//     `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` correctly set, so this is not
//     a missing-credentials artefact: five omission warnings per request, five
//     matching rows returned by the identical Prisma query run directly.
//     This defeats the story's own acceptance criterion that seeded data makes
//     both positive paths reachable.
//
//  2. THE LOCAL E2E STACK NEVER SCREENS A POST.
//     `scripts/start-api-e2e-with-workers.mjs` spawns only
//     `apps/api/dist/src/workers/wardrobe.bootstrap.js`. The community moderation
//     worker, its outbox dispatcher and its maintenance schedulers are wired into
//     `apps/api/src/workers/bootstrap.ts`, which that script never starts. A post
//     published through the API therefore sits at `pending_review` indefinitely —
//     confirmed by polling one for forty seconds — and never enters the public
//     feed. This is the same stack `playwright/config/local.config.ts` boots for
//     its `webServer`, so it applies to every spec in this directory.
//
// A third, smaller finding sits behind the same wall: `GET /posts/{postId}` for a
// PUBLISHED seeded post answers 404, while reporting that same post answers 200.
// The single-post read resolves through the same signing step the feed does, so a
// storage gap presents to a client as "not found" rather than as an outage.
//
// WHAT THIS FILE DOES ASSERT is everything the page genuinely does today: the
// signed-in shell, the eight filter chips and their cursor-resetting behaviour, the
// single live region, the empty state, and axe over the feed page and the
// create-post modal. That is real coverage, and it is written so that the moment
// either blocker is fixed the `fixme`s become the interesting half of the file.
//
// THE SESSION IS NOT OPTIONAL. `apps/web/src/lib/community.ts` reads
// `sessionStorage[couturecast.access-token]` as its sole credential, so a spec on
// the default fixture renders the signed-out panel and finds nothing. See
// `support/helpers/community-session.ts`.
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
 * The community grid lives on the Lookbook Prism home page, inside its
 * "Community Section" region. `/community` is the mobile-destination stub
 * (`apps/web/src/app/components/mobile-destination-page.tsx`) and renders only an
 * `h1` — a spec pointed there finds nothing and looks broken.
 */
const COMMUNITY_ROUTE = '/'

test.describe('6.1 community feed by climate band', () => {
  /*
   * Every test below destructures `communitySession`, including the ones that
   * never reference it. Playwright fixtures are LAZY: a test that omits it does
   * not get the session, renders the signed-out panel, and fails on a missing
   * grid for a reason that has nothing to do with what it was asserting.
   *
   * The events poll is stubbed for the same reason `lookbook-prism.spec.ts` and
   * `chip-navigation-bottom-nav.spec.ts` stub it: it answers 401 through the web
   * origin, and `networkErrorMonitor` — correctly — fails a test on an unexpected
   * failing request. Stubbing it keeps the monitor armed for everything else.
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
     * `toBeAttached`, not `toBeVisible`. The grid container is rendered
     * unconditionally for a signed-in reader, but with zero items it has no
     * layout box, and `toBeVisible` fails on a zero-height element. Asserting
     * attachment is the claim that actually holds today and keeps holding once
     * the feed has content.
     */
    await expect(page.getByTestId('community-card-grid')).toBeAttached()

    /*
     * EXACTLY ONE `role="status"` on the page. Before Story 6.1 there were four —
     * the loading skeleton carried one, the filter nav carried its own sr-only
     * region, and `getByRole('status')` threw on the ambiguity. More than that,
     * several regions announcing at once is a real screen-reader defect rather
     * than a test inconvenience: the announcements race and the reader hears
     * whichever won.
     */
    const communitySection = page.getByRole('complementary', {
      name: /community lookbook/i,
    })
    await expect(communitySection.getByRole('status')).toHaveCount(1)
    await expect(page.getByTestId('community-live-region')).toBeAttached()

    /*
     * Scoped to the community surface on purpose. The Story 3.6 chip-navigation
     * bar has its own `role="status"` ("Showing Personal recommendations") and
     * that one is legitimate, so a page-wide count would be asserting something
     * this story never claimed. What Story 6.1 fixed is the community component
     * announcing from four places at once.
     */
  })

  test('6.1-E2E-02 offers every defined filter and no undefined one', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    /*
     * KEYED ON THE TEST ID, never on the accessible name. The `auto` chip names
     * the resolved band when there is one ("Your climate: Temperate and wet"), so
     * its name is data-dependent and a name selector would be flaky in exactly
     * the situation the chip matters.
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
    // `Brands` because they had no server behavior, and the spec forbids an
    // active chip without one; a ninth chip reappearing is that regression.
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
     * to restart paging rather than carry the previous filter's cursor across.
     * Asserting on the REQUEST the click produced is what proves the client
     * dropped the cursor: a client that kept it would send one here, and the
     * server would answer 400.
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
    await expect(page.getByTestId('community-card-grid')).toBeAttached()
    await checkA11y(page)
  })

  test('6.1-E2E-05 create-post modal passes axe and gates on confirmed alt text', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto(COMMUNITY_ROUTE)

    /*
     * `create-post-button` renders ONLY when there is a web session. A signed-out
     * run finds nothing here, and that absence looks identical to a broken render,
     * so this says so rather than letting a future reader guess: if this locator
     * is empty, check the session before you check the component.
     */
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
     * Alt text must be CONFIRMED before publishing: the contract types
     * `altTextConfirmed` as the literal `true`, so an unconfirmed publish cannot
     * even be expressed. The control starts unchecked, which is the accessible
     * default — a pre-checked confirmation is not a confirmation.
     */
    await expect(confirmAltText).not.toBeChecked()

    await checkA11y(page)
  })

  /*
   * These three were `fixme` while the seed wrote `image_object_path` without
   * uploading an object and the local stack ran no community moderation worker.
   * Both are fixed — the seed uploads before it writes rows, and
   * `scripts/start-api-e2e-with-workers.mjs` starts the worker with
   * `COMMUNITY_NSFW_SCREENER=fixture` — so they assert for real now.
   */
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

    // Pseudonymous: an author name renders, and it is not a user id.
    const authorName = page.getByTestId(`author-name-${firstSeeded.id}`)
    await expect(authorName).toBeVisible()
    await expect(authorName).not.toHaveText(/[0-9a-f]{8}-[0-9a-f]{4}/)

    // Reporting is offered on another member's post; withdrawing is not.
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

    // The contract this inherits from `accessibility-hardening.spec.ts`, which
    // could no longer state it: a deep-link target receives programmatic focus
    // and is focusable only programmatically.
    const card = page.locator(`#lookbook-card-${target.id}`)
    await expect(card).toBeFocused()
    await expect(card).toHaveAttribute('tabindex', '-1')
    await checkA11y(page)
  })
})
