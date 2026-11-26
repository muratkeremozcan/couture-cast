// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): a saved look's own screen at 390 x 664. View from a Today save
// and from Style this piece opens /looks/saved/{id}; a cold deep link's back replaces to Saved;
// a removed id and another member's id read the same gone state; a visitor sends no read;
// Remove returns to the filter it came from with Undo, and adds no Looks entry
// (7.12-E2E-020..026). Reads come from looks-fixtures.ts; the saves a test drives are answered
// by `serveSavedLookWrites` below with schema-checked contracts.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import type { Page } from '@playwright/test'
import {
  createSavedLookInputSchema,
  savedLookListResponseSchema,
  savedLookResponseSchema,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'
import { getGuestPreviewStrings, sampleLookText } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { waitForShellSettled } from '../support/helpers/app-shell'
import { FOLD_VIEWPORT } from '../support/helpers/five-tab'
import {
  minutesAfter,
  openLooksFixture,
  type LookSeed,
} from '../support/helpers/looks-fixtures'

// The fixture shell seeds its own bearer; the stored auth session would sign in a real member.
test.use({ authSessionEnabled: false, viewport: FOLD_VIEWPORT })

const LOOKS: LookSeed[] = [
  { id: 'look-a', created: 10, title: 'Rainy commute' },
  { id: 'look-c', created: 30, title: 'Gallery Sunday', source: 'style_piece' },
]
const TODAY_LOOKS: LookSeed[] = [
  { id: 'home-1', created: 50, title: 'Today one' },
  { id: 'home-2', created: 30, title: 'Today two' },
  { id: 'piece-1', created: 40, title: 'Style piece', source: 'style_piece' },
]
const NOT_FOUND = { statusCode: 404, message: 'SAVED_LOOK_NOT_FOUND' }
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

/** Tile test ids in grid order. */
async function tileIds(page: Page): Promise<string[]> {
  return page
    .getByTestId('looks-saved-grid')
    .locator('[data-testid^="saved-look-card-"], [data-testid^="looks-capsule-card-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''))
}

/** The name the detail's top bar reads for `look` (looks-tile.tsx `useSavedLookName`, en-US). */
function lookName(look: SavedLookContract): string {
  return (
    look.title ||
    sampleLookText({ id: look.lookId }, getGuestPreviewStrings('en-US')).name ||
    look.lookId
  )
}

/**
 * Tests that expect a refusal opt out of the library monitor; this keeps every other 4xx or 5xx
 * failing the test. Entries read `METHOD STATUS /path`.
 */
function watchHttpErrors(page: Page, expected: RegExp[]) {
  const unexpected: string[] = []
  page.on('response', (response) => {
    if (response.status() < 400) return
    const entry = `${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`
    if (!expected.some((pattern) => pattern.test(entry))) unexpected.push(entry)
  })
  return () => [...unexpected]
}

/**
 * Answers the saves a test drives (Home sample and Style this piece) as the API does: the POST
 * body must parse as `createSavedLookInputSchema`, the 201 is a `savedLookResponseSchema`, and
 * the new look then answers its GET and joins the list reads. Registered after
 * `openLooksFixture`, so it answers first; every other saved look request falls through to the
 * fixture.
 */
async function serveSavedLookWrites(page: Page, memberId: string) {
  const created: SavedLookContract[] = []
  await page.route('**/api/v1/wardrobe/saved-looks**', async (route, request) => {
    const url = new URL(request.url())
    const match = /\/wardrobe\/saved-looks(?:\/([^/]+))?$/.exec(url.pathname)
    if (!match) return route.fallback()
    const [, id] = match
    const method = request.method()
    if (!id && method === 'POST') {
      const input = createSavedLookInputSchema.parse(request.postDataJSON())
      const at = minutesAfter(1_000 + created.length)
      const { data } = savedLookResponseSchema.parse({
        data: {
          id: `created-look-${created.length + 1}`,
          ownerUserId: memberId,
          source: input.source,
          lookId: input.lookId,
          weather: input.weather,
          title: input.title ?? null,
          anchorGarmentId: input.anchorGarmentId ?? null,
          anchorSnapshot: input.anchorSnapshot ?? null,
          composition: input.composition.map((slot) => ({
            ...slot,
            label: slot.label ?? null,
            missing: false,
            imageAccess: null,
          })),
          swaps: input.swaps,
          collection: input.collection ?? null,
          comfort: input.comfort ?? null,
          availabilityStatus: 'ready',
          missingGarmentIds: [],
          needsReviewReasons: [],
          revision: 0,
          createdAt: at,
          updatedAt: at,
        },
      })
      created.push(data)
      return route.fulfill({
        status: 201,
        json: { data },
        headers: { etag: `"saved-look:${data.id}:0"` },
      })
    }
    if (method !== 'GET' || created.length === 0) return route.fallback()
    if (id) {
      const look = created.find((entry) => entry.id === id)
      if (!look) return route.fallback()
      return route.fulfill({
        json: savedLookResponseSchema.parse({ data: look }),
        headers: {
          etag: `"saved-look:${look.id}:0"`,
          'cache-control': 'private, no-store',
        },
      })
    }
    const source = url.searchParams.get('source')
    const anchor = url.searchParams.get('anchorGarmentId')
    const rows = [...created]
      .reverse()
      .filter((look) => !source || look.source === source)
      .filter((look) => !anchor || look.anchorGarmentId === anchor)
    return route.fulfill({
      json: savedLookListResponseSchema.parse({
        data: rows,
        total: rows.length,
        limit: Number(url.searchParams.get('limit') ?? '50'),
        offset: 0,
      }),
      headers: { 'cache-control': 'private, no-store' },
    })
  })
  return { created: () => [...created] }
}

test.describe('CC-7.12 View opens the saved look @local-lane', () => {
  test('[P0] [7.12-E2E-020] save on Today, tap View: the look opens at its address and back lands on Saved', async ({
    page,
    interceptNetworkCall,
  }) => {
    // No city yet, so Home shows the member sample outfit with its Save (empty shell mode).
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      mode: 'empty',
      looks: [],
    })
    const writes = await serveSavedLookWrites(page, fixture.memberId)
    fixture.setScreen('home')
    await page.goto('/')
    await waitForShellSettled(page, fixture.router)

    const save = page.getByTestId('sample-save-look')
    await save.click()
    await expect(save).toHaveAttribute('data-save-state', 'saved')
    await expect.poll(() => writes.created().length).toBe(1)
    const look = writes.created()[0]!
    expect(look.source).toBe('home_sample')

    await page.getByTestId('status-bar-action-view').click()
    // D7: View passes no `from`; the detail is the look's own address.
    await expect(page).toHaveURL(new RegExp(`/looks/saved/${look.id}$`))
    await expect(page.getByTestId('saved-look-detail')).toHaveAttribute(
      'data-saved-look-id',
      look.id
    )
    await expect(page.getByTestId('app-top-bar-title')).toHaveText(lookName(look))
    await expect(page.getByTestId('bottom-nav-looks')).toHaveAttribute(
      'aria-current',
      'page'
    )

    fixture.setScreen('looks')
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved$/)
    await expect(page.getByTestId(`saved-look-card-${look.id}`)).toBeVisible()
  })

  test('[P1] [7.12-E2E-025] Style this piece save, tap View: opens the saved look like Today', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, { looks: [] })
    const writes = await serveSavedLookWrites(page, fixture.memberId)
    fixture.setScreen('closet')
    await page.goto('/wardrobe')
    await waitForShellSettled(page, fixture.router)

    await page
      .getByTestId('garment-card-shell-garment-1')
      .getByTestId('style-piece-open')
      .click()
    const panel = page.getByTestId('style-piece-panel')
    await expect(panel).toBeVisible()
    await panel.getByTestId('style-piece-save').first().click()
    await expect.poll(() => writes.created().length).toBe(1)
    const look = writes.created()[0]!
    expect(look.source).toBe('style_piece')
    expect(look.anchorGarmentId).toBe('shell-garment-1')

    await page.getByTestId('status-bar-action-view').click()
    await expect(page).toHaveURL(new RegExp(`/looks/saved/${look.id}$`))
    await expect(page.getByTestId('saved-look-detail')).toHaveAttribute(
      'data-saved-look-id',
      look.id
    )
    await expect(page.getByTestId('app-top-bar-title')).toHaveText(lookName(look))
    await expect(page.getByTestId('style-piece-panel')).toHaveCount(0)
  })
})

test.describe('CC-7.12 deep link and back @local-lane', () => {
  test('[P0] [7.12-E2E-021] cold deep link: the detail renders; back replaces to Saved with history unchanged', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, { looks: LOOKS })
    await page.goto('/looks/saved/look-a')
    await expect(page.getByTestId('saved-look-detail')).toHaveAttribute(
      'data-saved-look-id',
      'look-a'
    )
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Rainy commute')
    await expect(page.getByTestId('bottom-nav-looks')).toHaveAttribute(
      'aria-current',
      'page'
    )
    // Control for E2E-023: a signed-in deep link reads the one look, once.
    expect(fixture.detailReads()).toEqual(['look-a'])
    const entries = await page.evaluate(() => history.length)

    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved$/)
    await waitForShellSettled(page, fixture.router)
    await expect(page.getByTestId('looks-segment-saved')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(await page.evaluate(() => history.length), 'back replaced the entry').toBe(
      entries
    )
  })

  test('[P0] [7.12-E2E-026] in-app entry from the Today filter: back returns to Today', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: TODAY_LOOKS,
    })
    await page.goto('/looks?segment=saved&filter=today')
    await waitForShellSettled(page, fixture.router)
    await expect
      .poll(() => tileIds(page))
      .toEqual(['saved-look-card-home-1', 'saved-look-card-home-2'])

    await page.getByTestId('saved-look-card-home-1').click()
    await expect(page).toHaveURL(/\/looks\/saved\/home-1\?from=today$/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Today one')
    const entries = await page.evaluate(() => history.length)

    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved&filter=today$/)
    await expect(page.getByTestId('looks-filter-today')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect
      .poll(() => tileIds(page))
      .toEqual(['saved-look-card-home-1', 'saved-look-card-home-2'])
    // History back, not a new Saved entry on top of the detail.
    expect(await page.evaluate(() => history.length)).toBe(entries)
  })
})

test.describe('CC-7.12 gone, foreign and signed-out deep links @local-lane', () => {
  test(
    '[P0] [7.12-E2E-022] a removed id and another member id read the same gone state, with no title and no image request',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall, baseURL }) => {
      const unexpectedErrors = watchHttpErrors(page, [
        /^GET 404 \/api\/v1\/wardrobe\/saved-looks\/(look-removed|foreign-look)$/,
      ])
      const fixture = await openLooksFixture(page, interceptNetworkCall, { looks: LOOKS })
      const imageUrl = new URL('/__fixture-images/look-photo.png', baseURL).toString()
      const imageHits: string[] = []
      // Garment photos are not API traffic: a stub here only counts what the page asks for.
      await page.route('**/__fixture-images/**', (route) => {
        imageHits.push(route.request().url())
        return route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG })
      })
      // 7.12-INT-010: the API answers another member's id exactly like a removed one.
      await page.route('**/api/v1/wardrobe/saved-looks/foreign-look', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 404, json: NOT_FOUND })
          : route.fallback()
      )
      // The control look: one garment slot with a photo, so a rendered look requests it.
      await page.route('**/api/v1/wardrobe/saved-looks/look-photo', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              json: savedLookResponseSchema.parse({
                data: {
                  id: 'look-photo',
                  ownerUserId: fixture.memberId,
                  source: 'home_sample',
                  lookId: 'sample:l:look-photo',
                  weather: 'mild-dry',
                  title: 'Photo look',
                  anchorGarmentId: null,
                  anchorSnapshot: null,
                  composition: [
                    {
                      slotIndex: 0,
                      category: 'top',
                      kind: 'garment',
                      itemId: 'photo-garment',
                      label: null,
                      missing: false,
                      imageAccess: {
                        url: imageUrl,
                        expiresAt: '2099-12-31T00:00:00.000Z',
                      },
                    },
                  ],
                  swaps: {},
                  collection: 'all',
                  comfort: null,
                  availabilityStatus: 'ready',
                  missingGarmentIds: [],
                  needsReviewReasons: [],
                  revision: 0,
                  createdAt: minutesAfter(5),
                  updatedAt: minutesAfter(5),
                },
              }),
            })
          : route.fallback()
      )

      const goneText: string[] = []
      for (const id of ['look-removed', 'foreign-look']) {
        await page.goto(`/looks/saved/${id}`)
        await expect(page.getByTestId('saved-look-detail-gone'), id).toHaveText(
          'This look is no longer saved'
        )
        await expect(page.getByTestId('saved-look-detail')).toHaveCount(0)
        // No look name in the top bar: the tab's own label.
        await expect(page.getByTestId('app-top-bar-title')).toHaveText('Saved')
        goneText.push(await page.locator('main').innerText())

        const entries = await page.evaluate(() => history.length)
        await page.getByTestId('app-top-bar-back').click()
        await expect(page).toHaveURL(/\/looks\?segment=saved$/)
        expect(await page.evaluate(() => history.length)).toBe(entries)
      }
      expect(goneText[1], 'another member id reads exactly like a removed one').toBe(
        goneText[0]
      )
      expect(fixture.detailReads()).toEqual(['look-removed'])
      expect(imageHits, 'a gone look requests no garment photo').toEqual([])

      // Control: a look that is there shows its name and requests its photo.
      await page.goto('/looks/saved/look-photo')
      await expect(page.getByTestId('app-top-bar-title')).toHaveText('Photo look')
      await expect(page.getByTestId('saved-look-slot-0').locator('img')).toHaveJSProperty(
        'naturalWidth',
        1
      )
      expect(imageHits).toEqual([imageUrl])
      expect(unexpectedErrors()).toEqual([])
    }
  )

  test(
    '[P1] [7.12-E2E-022] an id with a literal percent sign reads as gone, never a crash (Codex #10)',
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, interceptNetworkCall }) => {
      const unexpectedErrors = watchHttpErrors(page, [
        /^GET 404 \/api\/v1\/wardrobe\/saved-looks\/[^/]+$/,
      ])
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await openLooksFixture(page, interceptNetworkCall, { looks: LOOKS })

      // Next hands the route an already decoded id; a second decode of "%" or "100%" throws.
      for (const raw of ['%25', '100%25', '%25E0%25A4%25A']) {
        await page.goto(`/looks/saved/${raw}`)
        await expect(page.getByTestId('saved-look-detail-gone'), raw).toHaveText(
          'This look is no longer saved'
        )
        await page.getByTestId('app-top-bar-back').click()
        await expect(page).toHaveURL(/\/looks\?segment=saved$/)
      }
      expect(pageErrors).toEqual([])
      expect(unexpectedErrors()).toEqual([])
    }
  )

  test('[P0] [7.12-E2E-023] signed out: the deep link asks to sign in and sends no saved look read', async ({
    page,
  }) => {
    const reads: string[] = []
    page.on('request', (request) => {
      if (/\/api\/v1\/wardrobe\/saved-looks/.test(request.url()))
        reads.push(request.url())
    })
    await page.goto('/looks/saved/look-a')
    const signedOut = page.getByTestId('saved-look-detail-signed-out')
    await expect(signedOut).toContainText('Sign in to see your saved looks')
    await expect(signedOut.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/signin'
    )
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Saved')
    await expect(page.getByTestId('saved-look-detail')).toHaveCount(0)
    expect(reads).toEqual([])
  })
})

test.describe('CC-7.12 Remove from the detail @local-lane', () => {
  test('[P0] [7.12-E2E-024] Remove from an in-app Today entry returns to Today, Undo restores in place, one back leaves Looks', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: TODAY_LOOKS,
    })
    fixture.setScreen('closet')
    await page.goto('/wardrobe')
    await waitForShellSettled(page, fixture.router)
    fixture.setScreen('looks')
    await page.getByTestId('bottom-nav-looks').click()
    await expect(page).toHaveURL(/\/looks(\?|$)/)
    await waitForShellSettled(page, fixture.router)
    await page.getByTestId('looks-filter-today').click()
    await expect(page).toHaveURL(/filter=today/)
    await expect
      .poll(() => tileIds(page))
      .toEqual(['saved-look-card-home-1', 'saved-look-card-home-2'])

    await page.getByTestId('saved-look-card-home-1').click()
    await expect(page).toHaveURL(/\/looks\/saved\/home-1\?from=today$/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Today one')

    await page.getByTestId('saved-look-detail-remove').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved&filter=today$/)
    await expect(page.getByTestId('looks-filter-today')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect.poll(() => tileIds(page)).toEqual(['saved-look-card-home-2'])
    expect(fixture.savedIds()).not.toContain('home-1')

    await page.getByTestId('status-bar-action-undo').click()
    // In place: first again, where its created time puts it.
    await expect
      .poll(() => tileIds(page))
      .toEqual(['saved-look-card-home-1', 'saved-look-card-home-2'])
    expect(fixture.savedIds()).toContain('home-1')

    // T2: Remove stepped back onto the Today entry; no second Looks entry sits above Closet.
    await page.goBack()
    await expect(page).toHaveURL(/\/wardrobe$/)
  })

  test('[P1] [7.12-E2E-024] Remove from a cold entry with from=today replaces to Today, history unchanged', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      looks: TODAY_LOOKS,
    })
    await page.goto('/looks/saved/home-2?from=today')
    await expect(page.getByTestId('app-top-bar-title')).toHaveText('Today two')
    const entries = await page.evaluate(() => history.length)

    await page.getByTestId('saved-look-detail-remove').click()
    await expect(page).toHaveURL(/\/looks\?segment=saved&filter=today$/)
    await waitForShellSettled(page, fixture.router)
    await expect.poll(() => tileIds(page)).toEqual(['saved-look-card-home-1'])
    expect(await page.evaluate(() => history.length), 'Remove replaced the entry').toBe(
      entries
    )

    await page.getByTestId('status-bar-action-undo').click()
    await expect
      .poll(() => tileIds(page))
      .toEqual(['saved-look-card-home-1', 'saved-look-card-home-2'])
  })
})
