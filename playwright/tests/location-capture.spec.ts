// Story 1.2b: client location capture on the local lane.
//
// The API on this lane reaches a deterministic weather provider double
// (`scripts/weather-provider-double.mjs`), never a live provider. Its forecast
// carries a sentinel temperature, and the ritual's synthetic test weather never
// applies to a location saved from search, so a ritual that reports the
// sentinel proves it consumed the forecast persisted at save. Tagged
// @local-lane so the preview and production runs never select it.
//
// Each management test seeds its own saved rows through the API (search, then
// save, as the web does), so every test starts on the state it is about and
// they run in parallel.
import type { Locator, Page } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  DOUBLE_DAILY_DAYS,
  DOUBLE_DAILY_MAX_C,
  DOUBLE_DAILY_MIN_C,
  fold,
  SENTINEL_CONDITION,
  SENTINEL_TEMPERATURE_C,
} from '../../scripts/lib/weather-provider-double-data.mjs'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { authHeaders } from '../support/helpers/api-test'
import {
  loadCommunityFixture,
  publishCommunityLook,
} from '../support/helpers/community-session'
import {
  expect,
  locationPrisma,
  locationTest as test,
  type ApiRequestFn,
  type LocationSession,
} from '../support/helpers/location-session'

const COMMUNITY_ROUTE = '/'
const FEED_URL = '**/api/v1/community/feed*'
const SEARCH_UNAVAILABLE = 'City search is temporarily unavailable. Try again.'
const SAVE_UNAVAILABLE = 'This city could not be saved right now. Try again.'

type FeedBody = {
  data: { bandResolved: boolean; bandUnresolvedReason: string | null; mode: string }
}
type RitualBody = {
  data: {
    weather: { locationKey: string; current: { temperature: number } }
    outfits: unknown[]
  }
}
type DailySummary = { temperatureMin: number; temperatureMax: number; condition: string }

/** The 503s these tests provoke are their subject; the auto monitor fails any 4xx/5xx. */
const EXPECTED_OUTAGE = { annotation: [{ type: 'skipNetworkMonitoring' }] }

function locationsSection(page: Page): Locator {
  return page.getByTestId('locations-section')
}

async function openLocations(page: Page): Promise<Locator> {
  await page.goto('/settings')
  await waitForAccessibilityReady(page)
  const section = locationsSection(page)
  await expect(section).toHaveAttribute('data-state', 'ready')
  return section
}

async function readRitual(
  apiRequest: ApiRequestFn,
  session: LocationSession
): Promise<RitualBody['data']> {
  const ritual = await apiRequest<RitualBody>({
    method: 'GET',
    path: '/api/v1/ritual',
    baseUrl: session.apiBaseUrl,
    headers: authHeaders(session.userId, 'guardian'),
    params: { locale: 'en-US' },
  })
  expect(ritual.status, JSON.stringify(ritual.body)).toBe(200)
  return ritual.body.data
}

test.describe('1.2b client location capture @local-lane', () => {
  test.beforeEach(async ({ page }) => {
    // playwright-utils deviation: a persistent stub that must be in place before
    // the first navigation. `interceptNetworkCall` registers its route inside a
    // step that resolves only on the first matching call, so it can be neither
    // awaited here nor trusted to have registered when left unawaited.
    await page.route('**/api/v1/events/poll**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], nextSince: new Date(0).toISOString() }),
      })
    )
  })

  test('[P0] 1.2b-E2E-01 guided save from Community yields a ritual, a resolved band and a stamped spotlight area', async ({
    page,
    request,
    apiRequest,
    interceptNetworkCall,
    locationSession,
  }) => {
    expect(locationSession.userId).toBeTruthy()
    const place = locationSession.sentinelPlace
    const prisma = locationPrisma()
    try {
      await log.step('the member starts with no location and no snapshot for the target')
      expect(
        await prisma.savedLocation.count({ where: { user_id: locationSession.userId } })
      ).toBe(0)
      expect(
        await prisma.weatherSnapshot.count({
          where: { location_key: { endsWith: locationSession.sentinelKeySuffix } },
        })
      ).toBe(0)

      await log.step(
        'Community explains the missing location and offers the guided action'
      )
      const firstFeed = interceptNetworkCall({ method: 'GET', url: FEED_URL })
      await page.goto(COMMUNITY_ROUTE)
      const firstBody = (await firstFeed).responseJson as FeedBody
      expect(firstBody.data.bandUnresolvedReason).toBe('no_location')
      const notice = page.getByTestId('community-band-unresolved')
      await expect(notice).toBeVisible()
      const action = notice.getByTestId('community-add-location')
      await expect(action).toHaveText('Add a location')
      await checkA11y(page)

      await log.step('the guided action opens Locations with search focused')
      await action.click()
      await expect(page).toHaveURL(/\/settings\?addLocation=1/)
      const section = locationsSection(page)
      const search = section.getByRole('combobox', { name: 'Search for a city' })
      await expect(search).toBeFocused()

      await log.step('search, pick by keyboard, name and save with Enter')
      await search.fill(locationSession.sentinelQuery)
      await expect(section.getByRole('option')).toHaveCount(1)
      await expect(section.getByRole('status')).toHaveText('Results: 1')
      await search.press('ArrowDown')
      await search.press('Enter')
      const label = section.getByLabel('Name this place')
      await expect(label).toBeFocused()
      await label.fill('Home')
      const returnedFeed = interceptNetworkCall({ method: 'GET', url: FEED_URL })
      await label.press('Enter')

      await log.step('the save returns to Community, which reloads with a resolved band')
      await expect(page).toHaveURL(/\/$/)
      const returnedBody = (await returnedFeed).responseJson as FeedBody
      expect(returnedBody.data.bandResolved).toBe(true)
      await expect(page.getByTestId('community-band-unresolved')).toHaveCount(0)
      await expect(page.getByTestId('community-filter-auto')).toContainText(
        'Your climate:'
      )

      await log.step('the saved location is canonical and weather-ready')
      const saved = await prisma.savedLocation.findFirstOrThrow({
        where: { user_id: locationSession.userId },
      })
      expect(saved).toMatchObject({
        label: 'Home',
        city: place.name,
        region: place.state,
        country: place.country,
        timezone: place.timezone,
        is_primary: true,
      })
      expect(saved.location_key.endsWith(locationSession.sentinelKeySuffix)).toBe(true)
      const snapshot = await prisma.weatherSnapshot.findFirstOrThrow({
        where: { location_key: saved.location_key },
      })
      expect(snapshot.temperature).toBe(SENTINEL_TEMPERATURE_C)
      const daily = snapshot.daily_summaries as DailySummary[]
      expect(daily).toHaveLength(DOUBLE_DAILY_DAYS)
      expect(daily[0]).toMatchObject({
        temperatureMin: DOUBLE_DAILY_MIN_C,
        temperatureMax: DOUBLE_DAILY_MAX_C,
        condition: SENTINEL_CONDITION,
      })

      await log.step('the next ritual read uses that snapshot, not synthetic weather')
      const ritual = await readRitual(apiRequest, locationSession)
      expect(ritual.weather.locationKey).toBe(saved.location_key)
      expect(ritual.weather.current.temperature).toBe(SENTINEL_TEMPERATURE_C)
      expect(ritual.outfits.length).toBeGreaterThan(0)

      await log.step('a post submitted now carries the canonical spotlight area')
      const { postId } = await publishCommunityLook(request, {
        apiBaseUrl: locationSession.apiBaseUrl,
        userId: locationSession.userId,
        fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
        altText: 'A plum satin wrap dress.',
        locale: 'en-US',
      })
      const post = await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: postId },
        select: { area_country: true, area_region: true, area_city: true },
      })
      expect(post).toEqual({
        area_country: place.country,
        area_region: fold(place.state ?? ''),
        area_city: fold(place.name),
      })

      // Server analytics privacy is covered by 1.2b-INT-15, which observes the
      // real telemetry transport and correlates events to this member's HMAC.
    } finally {
      await prisma.$disconnect()
    }
  })

  test('[P1] 1.2b-E2E-02a two same-name cities save as distinct places, the second picked by keyboard', async ({
    page,
    locationSession,
  }) => {
    await locationSession.seedLocation('Springfield', 'Illinois', 'Capital')
    const section = await openLocations(page)
    await expect(section.getByTestId('location-item')).toHaveCount(1)

    await log.step('a two-result search starts on the first option')
    const search = section.getByRole('combobox', { name: 'Search for a city' })
    await search.fill('Springfield')
    const options = section.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(section.getByRole('status')).toHaveText('Results: 2')
    await expect(options.nth(0)).toContainText('Illinois')
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')

    await log.step('ArrowDown moves the active option, and Enter picks it')
    await search.press('ArrowDown')
    const missouri = options.nth(1)
    await expect(missouri).toContainText('Missouri')
    await expect(missouri).toHaveAttribute('aria-selected', 'true')
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false')
    const missouriId = await missouri.getAttribute('id')
    expect(missouriId).toBeTruthy()
    await expect(search).toHaveAttribute('aria-activedescendant', missouriId!)
    await search.press('Enter')
    await expect(section.getByTestId('location-selected')).toContainText('Missouri')

    await log.step('Enter in the name field saves, and focus lands on the new item')
    const label = section.getByLabel('Name this place')
    await expect(label).toBeFocused()
    await label.fill('Ozarks')
    await label.press('Enter')
    await expect(section.getByRole('status')).toHaveText('Ozarks saved.')
    await expect(section.getByTestId('location-item-place')).toHaveText([
      'Springfield, Illinois, United States',
      'Springfield, Missouri, United States',
    ])
    await expect(section.getByTestId('location-item').first()).toHaveAttribute(
      'data-primary',
      'true'
    )
    await expect(
      section.getByTestId('location-item-label').filter({ hasText: 'Ozarks' })
    ).toBeFocused()
  })

  test('[P1] 1.2b-E2E-02b a city state is named once and the third save reaches the limit', async ({
    page,
    locationSession,
  }) => {
    await locationSession.seedLocation('Springfield', 'Illinois', 'Capital')
    await locationSession.seedLocation('Springfield', 'Missouri', 'Ozarks')
    const section = await openLocations(page)

    const search = section.getByRole('combobox', { name: 'Search for a city' })
    await search.fill('Monaco')
    await section.getByRole('option', { name: /Monaco/ }).click()
    await section.getByLabel('Name this place').fill('Coast')
    await section.getByRole('button', { name: 'Save location' }).click()
    await expect(section.getByRole('status')).toHaveText('Coast saved.')

    await expect(section.getByTestId('location-item-place').nth(2)).toHaveText('Monaco')
    await expect(section.getByTestId('locations-limit')).toHaveText(
      'You have saved three locations. Delete one to add another.'
    )
    await expect(search).toHaveCount(0)
  })

  test('[P1] 1.2b-E2E-02c one key press switches primary, focus follows, and the ritual reads the new primary', async ({
    page,
    apiRequest,
    locationSession,
  }) => {
    await locationSession.seedLocation('Springfield', 'Illinois', 'Capital')
    await locationSession.seedLocation('Springfield', 'Missouri', 'Ozarks')
    const section = await openLocations(page)

    const makePrimary = section.getByRole('button', { name: 'Make primary, Ozarks' })
    await makePrimary.focus()
    await makePrimary.press('Enter')
    await expect(section.getByRole('status')).toHaveText(
      'Ozarks is now your primary location.'
    )
    await expect(section.getByTestId('location-item').nth(1)).toHaveAttribute(
      'data-primary',
      'true'
    )
    await expect(section.getByTestId('location-primary-badge')).toHaveCount(1)
    await expect(
      section.getByTestId('location-item-label').filter({ hasText: 'Ozarks' })
    ).toBeFocused()

    await log.step('the ritual follows, on the forecast the double served at save')
    const ritual = await readRitual(apiRequest, locationSession)
    expect(ritual.weather.locationKey).toMatch(/^springfield-missouri-us-/)
    expect(ritual.weather.current.temperature).toBe(SENTINEL_TEMPERATURE_C)
  })

  test('[P1] 1.2b-E2E-02d renames by keyboard, and the new name survives a reload', async ({
    page,
    locationSession,
  }) => {
    await locationSession.seedLocation('Monaco', null, 'Coast')
    const section = await openLocations(page)

    const rename = section.getByRole('button', { name: 'Rename, Coast' })
    await rename.focus()
    await rename.press('Enter')
    const input = section.getByLabel('New name')
    await expect(input).toBeFocused()
    await checkA11y(page)

    await input.fill('Riviera')
    await input.press('Enter')
    await expect(section.getByRole('status')).toHaveText('Renamed to Riviera.')
    const itemLabel = section.getByTestId('location-item-label')
    await expect(itemLabel).toHaveText('Riviera')
    await expect(itemLabel).toBeFocused()

    await log.step('the server, not the client, holds the new name')
    await page.reload()
    await expect(locationsSection(page)).toHaveAttribute('data-state', 'ready')
    await expect(itemLabel).toHaveText('Riviera')
  })

  test('[P1] 1.2b-E2E-02e deleting the primary by keyboard promotes exactly one location', async ({
    page,
    locationSession,
  }) => {
    await locationSession.seedLocation('Springfield', 'Illinois', 'Capital')
    await locationSession.seedLocation('Springfield', 'Missouri', 'Ozarks')
    await locationSession.seedLocation('Monaco', null, 'Coast')
    const section = await openLocations(page)
    const search = section.getByRole('combobox', { name: 'Search for a city' })
    await expect(search).toHaveCount(0)

    const remove = section.getByRole('button', { name: 'Delete, Capital' })
    await remove.focus()
    await remove.press('Space')
    const confirm = section.getByRole('button', { name: 'Yes, delete' })
    await expect(confirm).toBeVisible()
    // The key that opened the confirmation lands the user on it, so the next
    // Enter deletes; it must not leave focus on Cancel.
    await expect(confirm).toBeFocused()
    await checkA11y(page)

    await page.keyboard.press('Enter')
    await expect(section.getByRole('status')).toHaveText('Capital deleted.')
    await expect(section.getByTestId('location-item-label')).toHaveText([
      'Ozarks',
      'Coast',
    ])
    await expect(section.getByTestId('location-item').first()).toHaveAttribute(
      'data-primary',
      'true'
    )
    await expect(section.getByTestId('location-primary-badge')).toHaveCount(1)
    await expect(
      section.getByRole('heading', { name: 'Locations', level: 2 })
    ).toBeFocused()
    await expect(search).toBeVisible()
  })

  test('[P1] 1.2b-E2E-02f the section passes axe with results open', async ({
    page,
    locationSession,
  }) => {
    expect(locationSession.userId).toBeTruthy()
    const section = await openLocations(page)
    await section.getByRole('combobox', { name: 'Search for a city' }).fill('Chicago')
    await expect(section.getByRole('option')).toHaveCount(1)
    await checkA11y(page)
  })

  test(
    '[P1] 1.2b-E2E-03a a failed search is announced as an alert, and retry recovers',
    EXPECTED_OUTAGE,
    async ({ page, locationSession }) => {
      const section = await openLocations(page)
      await section
        .getByRole('combobox', { name: 'Search for a city' })
        .fill(locationSession.flakySearchQuery)

      await expect(section.getByRole('alert')).toHaveText(SEARCH_UNAVAILABLE)
      const retry = section.getByRole('button', { name: 'Try again' })
      await expect(retry).toBeVisible()
      await checkA11y(page)

      await log.step('the provider recovers, and one retry press finds the city')
      await retry.press('Enter')
      await expect(section.getByRole('option')).toHaveText([
        new RegExp(locationSession.sentinelPlace.name),
      ])
      await expect(section.getByRole('status')).toHaveText('Results: 1')
      await expect(section.getByRole('alert')).toHaveCount(0)
    }
  )

  test(
    '[P1] 1.2b-E2E-03b a failed save keeps the chosen city and saves nothing',
    EXPECTED_OUTAGE,
    async ({ page, locationSession }) => {
      const section = await openLocations(page)
      await section.getByRole('combobox', { name: 'Search for a city' }).fill('Failtown')
      await section.getByRole('option', { name: /Failtown/ }).click()
      await section.getByRole('button', { name: 'Save location' }).click()

      await expect(section.getByRole('alert')).toHaveText(SAVE_UNAVAILABLE)
      await expect(section.getByTestId('location-selected')).toBeVisible()
      await expect(section.getByRole('button', { name: 'Try again' })).toBeVisible()

      await log.step('the server saved nothing, whatever the list shows')
      const prisma = locationPrisma()
      try {
        expect(
          await prisma.savedLocation.count({ where: { user_id: locationSession.userId } })
        ).toBe(0)
      } finally {
        await prisma.$disconnect()
      }
    }
  )

  test(
    '[P1] 1.2b-E2E-03c a save in flight is busy until the outage answers',
    EXPECTED_OUTAGE,
    async ({ page, locationSession }) => {
      expect(locationSession.userId).toBeTruthy()
      const section = await openLocations(page)
      await section.getByRole('combobox', { name: 'Search for a city' }).fill('Slowtown')
      await section.getByRole('option', { name: /Slowtown/ }).click()
      await section.getByRole('button', { name: 'Save location' }).click()

      // The double answers Slowtown's forecast after 4 s; the API gives up at 3 s.
      await expect(section.getByRole('button', { name: 'Saving...' })).toHaveAttribute(
        'aria-busy',
        'true'
      )
      await expect(section.getByRole('alert')).toHaveText(SAVE_UNAVAILABLE)
      await expect(
        section.getByRole('button', { name: 'Save location' })
      ).toHaveAttribute('aria-busy', 'false')
    }
  )

  test(
    '[P1] 1.2b-E2E-03d retrying a failed save saves the city',
    EXPECTED_OUTAGE,
    async ({ page, locationSession }) => {
      const section = await openLocations(page)
      const place = locationSession.flakySavePlace
      await section
        .getByRole('combobox', { name: 'Search for a city' })
        .fill(locationSession.flakySaveQuery)
      await section.getByRole('option', { name: new RegExp(place.name) }).click()
      await section.getByRole('button', { name: 'Save location' }).click()
      await expect(section.getByRole('alert')).toHaveText(SAVE_UNAVAILABLE)

      await log.step('the forecast recovers, and one retry press saves the city')
      await section.getByRole('button', { name: 'Try again' }).press('Enter')
      await expect(section.getByRole('status')).toHaveText(`${place.name} saved.`)
      await expect(section.getByTestId('location-item-label')).toHaveText([place.name])
      await expect(section.getByRole('alert')).toHaveCount(0)
    }
  )
})
