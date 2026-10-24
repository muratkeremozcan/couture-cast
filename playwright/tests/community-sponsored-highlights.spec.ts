// Story 6.7b: sponsored community highlights on web. The seeded sponsorship links
// the top seeded spotlight post to the sample partner's top offer, so every
// surface that renders that post opted in shows "Partnered" and a separate
// "Shop this look" CTA, and activating it records the click and opens the partner.
//
// Read-only on shared state: the seeded cohort and its sponsorship are never
// changed. The opt-out test changes only its own fresh account's preference and
// restores it. The Show new looks journey links a look it publishes itself, on
// the isolated local database, and removes the link and the look afterwards.
import type { BrowserContext, Page, Request } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  communityFeedResponseSchema,
  communityPostResponseSchema,
  communitySpotlightResponseSchema,
  communitySponsoredFeedResponseSchema,
  communitySponsoredPostResponseSchema,
  communitySponsoredSpotlightResponseSchema,
} from '@couture/api-client/contracts/http'
import { SEEDED_SPOTLIGHT_AREA } from '@couture/testing'
import { checkA11y } from '../support/helpers/accessibility'
import { authHeaders, buildUniqueId } from '../support/helpers/api-test'
import {
  AFFILIATE_CLICKS_PATH,
  COMMERCE_PREFERENCES_PATH,
} from '../support/helpers/commerce-session'
import {
  communityTest as test,
  deleteCommunityRowsForUser,
  expect,
  loadCommunityFixture,
  publishCommunityLook,
  signUpCommunityUser,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'
import {
  communityTestDatabase,
  test as engagementTest,
  observeCommunitySocket,
  openAll,
} from '../support/helpers/community-engagement'
import {
  SEEDED_SPONSOR,
  linkTestSponsorship,
  type TestSponsorship,
} from '../support/helpers/community-sponsorship'
import {
  SEEDED_SPOTLIGHT_POST_IDS,
  assertSeededSpotlight,
  placeViewerInArea,
} from '../support/helpers/community-spotlight'

/** Restated from `packages/db/prisma/seeds/commerce.ts`, and checked below. */
const SPONSORED_POST_ID = 'seed-spotlight-1'
const PARTNER = { id: 'sample-partner', name: 'Sample Partner' }
const OFFER_TITLE = 'Everyday Layering Tee'
const PARTNER_HOST = 'partner.couturecast.test'
const CTA_NAME = `Shop this look at ${PARTNER.name}`
const OPENS_COPY = 'Opens the partner site in a new tab'
const NARROW = { width: 390, height: 844 }

type ClickBody = {
  offerId: string
  recommendationId: string
  surface: string
  platform?: string
}

type ShownEvent = { event: string; properties: Record<string, unknown> }

/** The seeded link is open, on the top spotlight post, to the seeded top offer. */
async function assertSeededSponsorship(): Promise<string> {
  const db = communityTestDatabase()
  try {
    const link = await db.communityPostSponsorship.findFirst({
      where: { post_id: SPONSORED_POST_ID, ended_at: null },
      select: {
        offer: {
          select: { id: true, title: true, partner: { select: { slug: true } } },
        },
      },
    })
    expect(
      link,
      `No open sponsorship on ${SPONSORED_POST_ID}. Run \`npm run db:seed\` (seedCommunitySponsorship).`
    ).not.toBeNull()
    expect(link!.offer.title).toBe(OFFER_TITLE)
    expect(link!.offer.partner.slug).toBe(PARTNER.id)
    return link!.offer.id
  } finally {
    await db.$disconnect()
  }
}

/**
 * The partner host is a reserved `.test` name. Every navigation to it is answered
 * here, so the opened tab loads at once and its URL is the evidence. Each
 * request's Referer header is kept, so the no-referrer handoff is checked on the
 * wire.
 */
async function stubPartnerSite(context: BrowserContext) {
  const referers: (string | null)[] = []
  await context.route(`https://${PARTNER_HOST}/**`, (route) => {
    referers.push(route.request().headers()['referer'] ?? null)
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Partner</title><p>Partner</p>',
    })
  })
  return referers
}

function isClick(request: Request): boolean {
  return (
    request.method() === 'POST' &&
    new URL(request.url()).pathname.endsWith(AFFILIATE_CLICKS_PATH)
  )
}

/**
 * Activates a CTA and returns the click body and the opened tab's URL. The tab,
 * the click request and the click response are all registered before the press.
 * The tab is claimed inside the press and navigated after the mint; the partner
 * page must hold no `opener` back into this tab. A completed handoff leaves
 * focus on the CTA and shows no status.
 */
async function activate(page: Page, ctaTestId: string) {
  const cta = page.getByTestId(ctaTestId)
  const opened = page.context().waitForEvent('page')
  const click = page.waitForRequest(isClick)
  const minted = page.waitForResponse((response) => isClick(response.request()))
  await cta.click()
  const [request, response, partner] = await Promise.all([click, minted, opened])
  expect([200, 201]).toContain(response.status())
  await partner.waitForURL(`https://${PARTNER_HOST}/**`)
  const url = new URL(partner.url())
  expect(await partner.evaluate(() => window.opener === null)).toBe(true)
  await partner.close()
  await expect(cta).toBeFocused()
  await expect(cta).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId(`${ctaTestId}-status`)).toHaveCount(0)
  return { body: request.postDataJSON() as ClickBody, url }
}

function expectPartnerUrl(url: URL) {
  expect(url.host).toBe(PARTNER_HOST)
  expect(url.pathname).toBe('/shop/top')
  expect(url.searchParams.get('cc')).toMatch(/\S+/)
}

/** Records every `affiliate_cta_shown` the page captures, through its test hook. */
async function recordShownEvents(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { __enableAnalyticsTestHook: true })
  })
  return async (): Promise<ShownEvent[]> =>
    page.evaluate(() =>
      (
        (window as unknown as { __capturedAnalyticsEvents?: ShownEvent[] })
          .__capturedAnalyticsEvents ?? []
      ).filter((event) => event.event === 'affiliate_cta_shown')
    )
}

async function settledSpotlight(page: Page) {
  const module = page.getByTestId('community-spotlight')
  await expect(module).toHaveAttribute('aria-busy', 'false')
  await expect(module).toHaveAttribute('data-level', 'city')
}

test.describe('Story 6.7b sponsored community highlights', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('[P1] 6.7b-E2E-01 the spotlight card discloses the partner beside unchanged ranked cards and reports one strict shown event', async ({
    page,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const offerId = await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const shownEvents = await recordShownEvents(page)
      await page.goto('/')
      await settledSpotlight(page)

      await log.step('The sponsored spotlight card carries the disclosure and the CTA')
      const card = page.getByTestId(`spotlight-lookbook-card-${SPONSORED_POST_ID}`)
      await expect(
        page.getByTestId(`spotlight-sponsored-badge-${SPONSORED_POST_ID}`)
      ).toHaveText(/^Partnered/)
      await expect(card).toHaveAccessibleName(
        new RegExp(`Partnered with ${PARTNER.name}$`)
      )
      const cta = page.getByTestId(`spotlight-sponsored-cta-${SPONSORED_POST_ID}`)
      await expect(cta).toBeVisible()
      await expect(cta).toHaveAccessibleName(CTA_NAME)
      await expect(cta).toHaveAccessibleDescription(OPENS_COPY)
      // A separate control, outside the card's open action and any link.
      expect(
        await cta.evaluate((element) =>
          Boolean(element.parentElement?.closest('a, button, [role="button"]'))
        )
      ).toBe(false)
      const box = await cta.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

      await log.step('Every other ranked card is unchanged')
      for (const postId of SEEDED_SPOTLIGHT_POST_IDS.slice(1, 6)) {
        await expect(page.getByTestId(`spotlight-lookbook-card-${postId}`)).toBeVisible()
        await expect(page.getByTestId(`spotlight-sponsored-badge-${postId}`)).toHaveCount(
          0
        )
        await expect(page.getByTestId(`spotlight-sponsored-cta-${postId}`)).toHaveCount(0)
      }
      await checkA11y(page)

      await log.step('The shown event is the strict community payload')
      await expect
        .poll(async () =>
          (await shownEvents()).filter(
            (event) => event.properties.surface === 'community_spotlight'
          )
        )
        .toEqual([
          {
            event: 'affiliate_cta_shown',
            properties: {
              partner_id: PARTNER.id,
              offer_id: offerId,
              surface: 'community_spotlight',
              locale_region: 'US',
            },
          },
        ])
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-08 activating the spotlight CTA mints a community_spotlight click and opens the partner with no referrer', async ({
    page,
    context,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const offerId = await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const referers = await stubPartnerSite(context)
      await page.goto('/')
      await settledSpotlight(page)

      await log.step('Activation records the click and opens the partner')
      const { body, url } = await activate(
        page,
        `spotlight-sponsored-cta-${SPONSORED_POST_ID}`
      )
      expect(body).toEqual({
        offerId,
        recommendationId: SPONSORED_POST_ID,
        surface: 'community_spotlight',
        platform: 'web',
      })
      expectPartnerUrl(url)
      // noreferrer on the wire: the partner request carries no Referer.
      expect(referers).toEqual([null])
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-02 the feed card and its detail dialog disclose the partner and mint community_feed', async ({
    page,
    context,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const offerId = await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const referers = await stubPartnerSite(context)
      // A deep link puts the sponsored post at the head of the feed, wherever its
      // page would be: the single-post read is opted in like the feed.
      await page.goto(`/?source=notification&type=community&cardId=${SPONSORED_POST_ID}`)

      const card = page.getByTestId(`lookbook-card-${SPONSORED_POST_ID}`)
      await expect(card).toBeFocused()
      await expect(page.getByTestId(`sponsored-badge-${SPONSORED_POST_ID}`)).toHaveText(
        /^Partnered/
      )
      await expect(card).toHaveAccessibleName(
        new RegExp(`Partnered with ${PARTNER.name}$`)
      )
      const cta = page.getByTestId(`sponsored-cta-${SPONSORED_POST_ID}`)
      await expect(cta).toHaveAccessibleName(CTA_NAME)
      // A separate control, outside the card's open action and any link.
      await expect(
        page
          .getByTestId(`lookbook-open-${SPONSORED_POST_ID}`)
          .getByTestId(`sponsored-cta-${SPONSORED_POST_ID}`)
      ).toHaveCount(0)
      expect(
        await cta.evaluate((element) =>
          Boolean(element.parentElement?.closest('a, button, [role="button"]'))
        )
      ).toBe(false)

      await log.step('Feed card activation mints community_feed')
      const fromCard = await activate(page, `sponsored-cta-${SPONSORED_POST_ID}`)
      expect(fromCard.body).toEqual({
        offerId,
        recommendationId: SPONSORED_POST_ID,
        surface: 'community_feed',
        platform: 'web',
      })
      expectPartnerUrl(fromCard.url)

      await log.step('The detail dialog opened from the feed carries its own CTA')
      await page.getByTestId(`lookbook-open-${SPONSORED_POST_ID}`).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByTestId(`community-detail-sponsored-${SPONSORED_POST_ID}`)
      ).toContainText('Partnered')
      const dialogCta = dialog.getByTestId(
        `community-detail-sponsored-cta-${SPONSORED_POST_ID}`
      )
      await expect(dialogCta).toHaveAccessibleName(CTA_NAME)
      await checkA11y(page)
      const fromDialog = await activate(
        page,
        `community-detail-sponsored-cta-${SPONSORED_POST_ID}`
      )
      expect(fromDialog.body).toEqual({
        offerId,
        recommendationId: SPONSORED_POST_ID,
        surface: 'community_feed',
        platform: 'web',
      })
      expectPartnerUrl(fromDialog.url)
      expect(referers).toEqual([null, null])
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-03 the narrow-layout Home teaser discloses the partner and renders the CTA beside its link', async ({
    page,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const offerId = await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const shownEvents = await recordShownEvents(page)
      await page.setViewportSize(NARROW)
      await page.goto('/')
      await settledSpotlight(page)

      await log.step('The teaser link carries the disclosure')
      const link = page.getByTestId('home-spotlight-teaser-link')
      await expect(link).toBeVisible()
      await expect(page.getByTestId('home-spotlight-teaser-sponsored')).toHaveText(
        'Partnered'
      )
      await expect(link).toHaveAccessibleName(
        new RegExp(`Partnered with ${PARTNER.name}$`)
      )

      await log.step('The CTA is a sibling of the link inside the teaser root')
      const ctaId = `home-spotlight-teaser-sponsored-cta-${SPONSORED_POST_ID}`
      const cta = page.getByTestId(ctaId)
      await expect(cta).toHaveAccessibleName(CTA_NAME)
      await expect(cta).toHaveAccessibleDescription(OPENS_COPY)
      await expect(
        page.getByTestId('home-spotlight-teaser').getByTestId(ctaId)
      ).toHaveCount(1)
      await expect(link.getByTestId(ctaId)).toHaveCount(0)
      expect(await cta.evaluate((element) => element.closest('a') === null)).toBe(true)
      await checkA11y(page)

      await log.step('The shown event is the strict community payload')
      await expect
        .poll(async () =>
          (await shownEvents())
            .filter((event) => event.properties.surface === 'home_teaser')
            .map((event) => event.properties)
        )
        .toEqual([
          {
            partner_id: PARTNER.id,
            offer_id: offerId,
            surface: 'home_teaser',
            locale_region: 'US',
          },
        ])
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-09 activating the Home teaser CTA mints home_teaser, opens the partner and records no spotlight open', async ({
    page,
    context,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const offerId = await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const referers = await stubPartnerSite(context)
      const opens: unknown[] = []
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          /\/community\/posts\/[^/]+\/opened$/.test(request.url())
        )
          opens.push(request.postDataJSON())
      })
      await page.setViewportSize(NARROW)
      await page.goto('/')
      await settledSpotlight(page)

      await log.step('Activation records the click and opens the partner')
      const ctaId = `home-spotlight-teaser-sponsored-cta-${SPONSORED_POST_ID}`
      const { body, url } = await activate(page, ctaId)
      expect(body).toEqual({
        offerId,
        recommendationId: SPONSORED_POST_ID,
        surface: 'home_teaser',
        platform: 'web',
      })
      expectPartnerUrl(url)
      expect(referers).toEqual([null])
      // The CTA is not the teaser's open action: no spotlight open was recorded.
      expect(opens).toEqual([])
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-06 a blocked popup shows the localized error on the spotlight CTA, keeps focus and records no click', async ({
    page,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      // A popup blocker answers `window.open` with null.
      await page.addInitScript(() => {
        window.open = () => null
      })
      const clicks: string[] = []
      page.on('request', (request) => {
        if (isClick(request)) clicks.push(request.url())
      })
      const pages: string[] = []
      page.context().on('page', (opened) => pages.push(opened.url()))
      await page.goto('/')
      await settledSpotlight(page)

      const ctaId = `spotlight-sponsored-cta-${SPONSORED_POST_ID}`
      const cta = page.getByTestId(ctaId)
      await cta.click()

      const status = page.getByTestId(`${ctaId}-status`)
      await expect(status).toHaveText(
        'Unable to open the partner site. Please try again.'
      )
      await expect(status).toHaveAttribute('data-state', 'error')
      await expect(cta).toBeFocused()
      await expect(cta).toHaveAccessibleDescription(
        `${OPENS_COPY} Unable to open the partner site. Please try again.`
      )
      await expect(page.getByTestId('community-live-region')).toHaveText(
        'Unable to open the partner site. Please try again.'
      )
      // A blocked tab mints nothing and opens nothing.
      expect(clicks).toEqual([])
      expect(pages).toEqual([])
      await checkA11y(page)
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-04 turning the affiliate opt-out off hides the label and CTA on the next read', async ({
    page,
    request,
    communitySession,
    interceptNetworkCall,
  }) => {
    await assertSeededSpotlight()
    await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    const preferencesUrl = `${communitySession.apiBaseUrl}${COMMERCE_PREFERENCES_PATH}`
    try {
      await page.goto('/')
      await settledSpotlight(page)
      await expect(
        page.getByTestId(`spotlight-sponsored-cta-${SPONSORED_POST_ID}`)
      ).toBeVisible()

      await log.step('Turn the opt-out off in settings')
      const loaded = interceptNetworkCall({
        method: 'GET',
        url: `**${COMMERCE_PREFERENCES_PATH}`,
      })
      await page.goto('/settings')
      await loaded
      const saved = interceptNetworkCall({
        method: 'PUT',
        url: `**${COMMERCE_PREFERENCES_PATH}`,
      })
      await page
        .getByRole('checkbox', { name: 'Show "Shop this look" suggestions' })
        .uncheck()
      expect((await saved).status).toBe(200)

      await log.step('The next community read carries no block and renders no CTA')
      const spotlightRead = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          url.pathname.endsWith('/api/v1/community/spotlight') &&
          !url.searchParams.has('surface')
        )
      })
      await page.goto('/')
      const read = (await (await spotlightRead).json()) as {
        data: { items: Record<string, unknown>[] }
      }
      expect(read.data.items.map((item) => item.id)).toContain(SPONSORED_POST_ID)
      expect(read.data.items.filter((item) => 'sponsorship' in item)).toEqual([])
      await settledSpotlight(page)
      await expect(
        page.getByTestId(`spotlight-lookbook-card-${SPONSORED_POST_ID}`)
      ).toBeVisible()
      await expect(page.locator('[data-testid*="sponsored-badge-"]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Shop this look/ })).toHaveCount(0)
    } finally {
      await page.goto('about:blank')
      // Restore the account's default even though it is throwaway.
      const restored = await request.put(preferencesUrl, {
        headers: authHeaders(communitySession.userId, 'guardian'),
        data: { affiliateCtasEnabled: true },
      })
      expect(restored.status()).toBe(200)
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-05 a read without the opt-in header parses with today’s strict schemas; with it the block is served', async ({
    request,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const offerId = await assertSeededSponsorship()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    const base = communitySession.apiBaseUrl
    const legacyHeaders = {
      ...authHeaders(communitySession.userId, 'guardian'),
      'x-couture-platform': 'web',
    }
    const optedHeaders = { ...legacyHeaders, 'x-couture-sponsorship': '1' }
    const block = {
      partnerId: PARTNER.id,
      partnerDisplayName: PARTNER.name,
      offerId,
      offerTitle: OFFER_TITLE,
    }
    // playwright-utils deviation: the opted-in reads assert the Vary response
    // header, which apiRequest does not return; both halves share this call.
    const read = async (path: string, headers: Record<string, string>) => {
      const response = await request.get(`${base}${path}`, { headers })
      expect(response.status(), path).toBe(200)
      return {
        body: (await response.json()) as unknown,
        vary: response.headers()['vary'],
      }
    }
    /**
     * Walks the every-climate feed, parsing every page, until one carries the
     * sponsored post: its place in the feed moves as other tests publish.
     */
    const findInFeed = async <Item extends { id: string }>(
      headers: Record<string, string>,
      parse: (body: unknown) => { data: { items: Item[]; nextCursor: string | null } }
    ) => {
      let cursor: string | null = null
      do {
        const query = new URLSearchParams({ mode: 'all', limit: '30' })
        if (cursor) query.set('cursor', cursor)
        const { body, vary } = await read(`/api/v1/community/feed?${query}`, headers)
        const page = parse(body)
        const item = page.data.items.find((entry) => entry.id === SPONSORED_POST_ID)
        if (item) return { item, vary }
        cursor = page.data.nextCursor
      } while (cursor)
      throw new Error(`${SPONSORED_POST_ID} is on no every-climate feed page`)
    }
    try {
      for (const route of [
        '/api/v1/community/spotlight',
        '/api/v1/community/spotlight?surface=home_teaser&limit=1',
      ]) {
        await log.step(`Spotlight ${route}`)
        // The pre-6.7b schema is strict, so any field added to a legacy read fails.
        const legacy = communitySpotlightResponseSchema.parse(
          (await read(route, legacyHeaders)).body
        )
        expect(legacy.data.items[0]?.id).toBe(SPONSORED_POST_ID)

        const opted = await read(route, optedHeaders)
        expect(opted.vary ?? '').toMatch(/x-couture-sponsorship/i)
        const optedItems = communitySponsoredSpotlightResponseSchema.parse(opted.body)
          .data.items
        expect(optedItems[0]?.sponsorship).toEqual(block)
        for (const item of optedItems.slice(1))
          expect(item).not.toHaveProperty('sponsorship')
      }

      await log.step('Feed')
      await findInFeed(legacyHeaders, (body) => communityFeedResponseSchema.parse(body))
      const optedFeed = await findInFeed(optedHeaders, (body) =>
        communitySponsoredFeedResponseSchema.parse(body)
      )
      expect(optedFeed.vary ?? '').toMatch(/x-couture-sponsorship/i)
      expect(optedFeed.item.sponsorship).toEqual(block)

      await log.step('Single post')
      const post = `/api/v1/community/posts/${SPONSORED_POST_ID}`
      communityPostResponseSchema.parse((await read(post, legacyHeaders)).body)
      expect(
        communitySponsoredPostResponseSchema.parse((await read(post, optedHeaders)).body)
          .data.sponsorship
      ).toEqual(block)
    } finally {
      await removeLocation()
    }
  })
})

/*
 * The realtime journey runs on the engagement fixtures: their socket observer,
 * and the lock that keeps one "all"-feed journey at a time, so another
 * engagement test's looks and cleanup cannot displace this one's.
 */
engagementTest.describe('Story 6.7b sponsored look through Show new looks', () => {
  engagementTest.setTimeout(120_000)

  engagementTest(
    '[P1] 6.7b-E2E-07 a sponsored look another member publishes is revealed from Show new looks with Partnered and its CTA',
    async (
      { page, communitySession, communityApi, request, apiRequest, recurse },
      testInfo
    ) => {
      expect(communitySession.userId).not.toBe(communityApi.userId)
      const transport = await observeCommunitySocket(page)
      await openAll(page)
      await recurse(
        () => Promise.resolve(transport.handshakes),
        (count) => count > 0,
        { timeout: 10_000 }
      )

      const ownerId = await signUpCommunityUser(
        request,
        communityApi.apiBaseUrl,
        buildUniqueId('sponsored-new-look-owner', testInfo)
      )
      communityApi.trackUser(ownerId)
      let sponsorship: TestSponsorship | undefined
      try {
        await log.step(
          'A second member publishes a look that is sponsored before it goes public'
        )
        const published = await publishCommunityLook(request, {
          apiBaseUrl: communityApi.apiBaseUrl,
          userId: ownerId,
          fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
          altText: 'Synthetic plum satin fabric',
          caption: `Sponsored new look ${testInfo.testId.slice(0, 8)}`,
          // Linked while still a draft, so the opted-in rebuild that buffers it
          // already finds the live block.
          beforePublish: async (postId) => {
            sponsorship = await linkTestSponsorship(postId)
          },
        })
        expect(
          (
            await waitForTerminalAuthorState(
              { apiRequest, recurse },
              {
                apiBaseUrl: communityApi.apiBaseUrl,
                userId: ownerId,
                postId: published.postId,
              }
            )
          ).status
        ).toBe('published')

        await log.step('The reader reveals it from Show new looks')
        const insert = page.getByRole('button', { name: /Show \d+ new look/ })
        await expect(insert).toBeVisible({ timeout: 10_000 })
        const card = page.getByTestId(`lookbook-card-${published.postId}`)
        await expect(card).toHaveCount(0)
        await insert.focus()
        await page.keyboard.press('Enter')
        // Other specs publish in parallel, so the first banner can announce their
        // look before this one is buffered; insert again until this one is in.
        await expect(async () => {
          if ((await card.count()) === 0 && (await insert.isVisible())) {
            await insert.focus()
            await page.keyboard.press('Enter')
          }
          await expect(card).toBeVisible({ timeout: 1_000 })
        }).toPass({ timeout: 20_000 })

        await log.step('The revealed card discloses the partner and offers the CTA')
        await expect(page.getByTestId(`sponsored-badge-${published.postId}`)).toHaveText(
          /^Partnered/
        )
        await expect(card).toHaveAccessibleName(
          new RegExp(`Partnered with ${SEEDED_SPONSOR.partnerName}$`)
        )
        const cta = page.getByTestId(`sponsored-cta-${published.postId}`)
        await expect(cta).toBeVisible()
        await expect(cta).toHaveAccessibleName(
          `Shop this look at ${SEEDED_SPONSOR.partnerName}`
        )
        await expect(cta).toHaveAccessibleDescription(OPENS_COPY)
        await checkA11y(page)
      } finally {
        await page.goto('about:blank')
        // The link first, then the look; the fixture's own teardown repeats the
        // row cleanup harmlessly.
        await sponsorship?.remove()
        await deleteCommunityRowsForUser(ownerId)
      }
    }
  )
})
