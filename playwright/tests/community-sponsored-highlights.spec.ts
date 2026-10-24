// Story 6.7b: sponsored community highlights on web. The seeded sponsorship links
// the top seeded spotlight post to the sample partner's top offer, so every
// surface that renders that post opted in shows "Partnered" and a separate
// "Shop this look" CTA, and activating it records the click and opens the partner.
//
// Read-only on shared state: the seeded cohort and its sponsorship are never
// changed. The opt-out test changes only its own fresh account's preference and
// restores it.
import type { BrowserContext, Page, Request } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import { SEEDED_SPOTLIGHT_AREA } from '@couture/testing'
import { checkA11y } from '../support/helpers/accessibility'
import { authHeaders } from '../support/helpers/api-test'
import {
  AFFILIATE_CLICKS_PATH,
  COMMERCE_PREFERENCES_PATH,
} from '../support/helpers/commerce-session'
import { communityTest as test, expect } from '../support/helpers/community-session'
import { communityTestDatabase } from '../support/helpers/community-engagement'
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
 * here, so the opened tab loads at once and its URL is the evidence.
 */
async function stubPartnerSite(context: BrowserContext) {
  await context.route(`https://${PARTNER_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Partner</title><p>Partner</p>',
    })
  )
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
 * A completed handoff leaves focus on the CTA and shows no status: a browser
 * returns null from a `noopener` open, which once read as a failure.
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

  test('[P1] 6.7b-E2E-01 the spotlight card discloses the partner, mints a community_spotlight click and opens the partner', async ({
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
      await stubPartnerSite(context)
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
      await stubPartnerSite(context)
      // A deep link puts the sponsored post at the head of the feed, wherever its
      // page would be: the single-post read is opted in like the feed.
      await page.goto(`/?source=notification&type=community&cardId=${SPONSORED_POST_ID}`)

      const card = page.locator(`#lookbook-card-${SPONSORED_POST_ID}`)
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
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] 6.7b-E2E-03 the narrow-layout Home teaser renders the CTA beside its link and mints home_teaser', async ({
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
      await stubPartnerSite(context)
      const opens: unknown[] = []
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          /\/community\/posts\/[^/]+\/opened$/.test(request.url())
        )
          opens.push(request.postDataJSON())
      })
      const shownEvents = await recordShownEvents(page)
      await page.setViewportSize(NARROW)
      await page.goto('/')
      await settledSpotlight(page)

      const link = page.getByTestId('home-spotlight-teaser-link')
      await expect(link).toBeVisible()
      await expect(page.getByTestId('home-spotlight-teaser-sponsored')).toHaveText(
        'Partnered'
      )
      await expect(link).toHaveAccessibleName(
        new RegExp(`Partnered with ${PARTNER.name}$`)
      )
      const cta = page.getByTestId(
        `home-spotlight-teaser-sponsored-cta-${SPONSORED_POST_ID}`
      )
      await expect(cta).toHaveAccessibleName(CTA_NAME)
      await expect(cta).toHaveAccessibleDescription(OPENS_COPY)
      // A sibling of the teaser link, inside the teaser root.
      const ctaId = `home-spotlight-teaser-sponsored-cta-${SPONSORED_POST_ID}`
      await expect(
        page.getByTestId('home-spotlight-teaser').getByTestId(ctaId)
      ).toHaveCount(1)
      await expect(link.getByTestId(ctaId)).toHaveCount(0)
      expect(await cta.evaluate((element) => element.closest('a') === null)).toBe(true)
      await checkA11y(page)

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

      const { body, url } = await activate(page, ctaId)
      expect(body).toEqual({
        offerId,
        recommendationId: SPONSORED_POST_ID,
        surface: 'home_teaser',
        platform: 'web',
      })
      expectPartnerUrl(url)
      // The CTA is not the teaser's open action: no spotlight open was recorded.
      expect(opens).toEqual([])
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

  test('[P1] 6.7b-E2E-05 a read without the opt-in header keeps today’s shape; with it the block is served', async ({
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
    const headers = {
      ...authHeaders(communitySession.userId, 'guardian'),
      'x-couture-platform': 'web',
    }
    const block = {
      partnerId: PARTNER.id,
      partnerDisplayName: PARTNER.name,
      offerId,
      offerTitle: OFFER_TITLE,
    }
    try {
      for (const route of [
        '/api/v1/community/spotlight',
        '/api/v1/community/spotlight?surface=home_teaser&limit=1',
      ]) {
        const legacy = await request.get(`${base}${route}`, { headers })
        expect(legacy.status()).toBe(200)
        const legacyBody = (await legacy.json()) as {
          data: { items: Record<string, unknown>[] }
        }
        expect(legacyBody.data.items[0]?.id).toBe(SPONSORED_POST_ID)
        for (const item of legacyBody.data.items)
          expect(item).not.toHaveProperty('sponsorship')

        const opted = await request.get(`${base}${route}`, {
          headers: { ...headers, 'x-couture-sponsorship': '1' },
        })
        expect(opted.status()).toBe(200)
        expect(opted.headers()['vary'] ?? '').toMatch(/x-couture-sponsorship/i)
        const optedBody = (await opted.json()) as {
          data: { items: Record<string, unknown>[] }
        }
        expect(optedBody.data.items[0]?.sponsorship).toEqual(block)
        for (const item of optedBody.data.items.slice(1))
          expect(item).not.toHaveProperty('sponsorship')
      }

      const post = `${base}/api/v1/community/posts/${SPONSORED_POST_ID}`
      const legacyPost = await request.get(post, { headers })
      expect(legacyPost.status()).toBe(200)
      expect(((await legacyPost.json()) as { data: object }).data).not.toHaveProperty(
        'sponsorship'
      )
      const optedPost = await request.get(post, {
        headers: { ...headers, 'x-couture-sponsorship': '1' },
      })
      expect(
        ((await optedPost.json()) as { data: { sponsorship?: unknown } }).data.sponsorship
      ).toEqual(block)
    } finally {
      await removeLocation()
    }
  })
})
