// Story 1.2b: client location capture on the local lane.
//
// The API on this lane reaches a deterministic weather provider double
// (`scripts/weather-provider-double.mjs`), never a live provider. Its forecast
// carries a sentinel temperature, and the ritual's synthetic test weather never
// applies to a location saved from search, so a ritual that reports the
// sentinel proves it consumed the forecast persisted at save. Tagged
// @local-lane so the preview and production runs never select it.
import { log } from '@seontechnologies/playwright-utils/log'
import { SENTINEL_TEMPERATURE_C } from '../../scripts/lib/weather-provider-double-data.mjs'
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
} from '../support/helpers/location-session'

const COMMUNITY_ROUTE = '/'
const FEED_URL = '**/api/v1/community/feed*'

type FeedBody = {
  data: { bandResolved: boolean; bandUnresolvedReason: string | null; mode: string }
}
type RitualBody = {
  data: {
    weather: { locationKey: string; current: { temperature: number } }
    outfits: unknown[]
  }
}

test.describe('1.2b client location capture @local-lane', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('1.2b-E2E-01 guided save from Community yields a ritual, a resolved band and a stamped spotlight area', async ({
    page,
    request,
    interceptNetworkCall,
    locationSession,
  }) => {
    expect(locationSession.userId).toBeTruthy()
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

      await log.step('the guided action opens Locations with search focused')
      await action.click()
      await expect(page).toHaveURL(/\/settings\?addLocation=1/)
      const search = page.getByRole('combobox', { name: 'Search for a city' })
      await expect(search).toBeFocused()

      await log.step('search, pick by keyboard, name and save')
      await search.fill(locationSession.sentinelQuery)
      await expect(page.getByRole('option')).toHaveCount(1)
      await expect(page.getByTestId('locations-status-region')).toHaveText('Results: 1')
      await search.press('ArrowDown')
      await search.press('Enter')
      const label = page.getByLabel('Name this place')
      await expect(label).toBeFocused()
      await label.fill('Home')
      const returnedFeed = interceptNetworkCall({ method: 'GET', url: FEED_URL })
      await page.getByRole('button', { name: 'Save location' }).click()

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
        city: 'Sentinelville',
        region: 'Sentinel County',
        country: 'US',
        timezone: 'America/Denver',
        is_primary: true,
      })
      expect(saved.location_key.endsWith(locationSession.sentinelKeySuffix)).toBe(true)
      const snapshot = await prisma.weatherSnapshot.findFirstOrThrow({
        where: { location_key: saved.location_key },
      })
      expect(snapshot.temperature).toBe(SENTINEL_TEMPERATURE_C)
      expect(Array.isArray(snapshot.daily_summaries)).toBe(true)

      await log.step('the next ritual read uses that snapshot, not synthetic weather')
      const ritual = await request.get(
        `${locationSession.apiBaseUrl}/api/v1/ritual?locale=en-US`,
        { headers: authHeaders(locationSession.userId, 'guardian') }
      )
      expect(ritual.status(), await ritual.text()).toBe(200)
      const ritualBody = (await ritual.json()) as RitualBody
      expect(ritualBody.data.weather.locationKey).toBe(saved.location_key)
      expect(ritualBody.data.weather.current.temperature).toBe(SENTINEL_TEMPERATURE_C)
      expect(ritualBody.data.outfits.length).toBeGreaterThan(0)

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
        area_country: 'US',
        area_region: 'sentinel county',
        area_city: 'sentinelville',
      })

      // Server analytics privacy is covered by 1.2b-INT-15, which observes the
      // real telemetry transport and correlates events to this member's HMAC.
    } finally {
      await prisma.$disconnect()
    }
  })

  test('1.2b-E2E-02 manages locations: second save, one-press primary switch, rename, delete, limit', async ({
    page,
    request,
    locationSession,
  }) => {
    expect(locationSession.userId).toBeTruthy()
    await page.goto('/settings')
    await waitForAccessibilityReady(page)
    const section = page.getByTestId('locations-section')
    await expect(section.getByTestId('locations-empty')).toBeVisible()
    const search = section.getByRole('combobox', { name: 'Search for a city' })

    async function add(query: string, optionName: RegExp, name: string) {
      await search.fill(query)
      await section.getByRole('option', { name: optionName }).click()
      await section.getByLabel('Name this place').fill(name)
      await section.getByRole('button', { name: 'Save location' }).click()
      await expect(section.getByTestId('locations-status-region')).toHaveText(
        `${name} saved.`
      )
    }

    await log.step('two same-name cities in different regions save as distinct places')
    await add('Springfield', /Illinois/, 'Capital')
    await add('Springfield', /Missouri/, 'Ozarks')
    await expect(section.getByTestId('location-item')).toHaveCount(2)
    await expect(section.getByTestId('location-item').first()).toHaveAttribute(
      'data-primary',
      'true'
    )

    await log.step('a city state has no region and is named once')
    await add('Monaco', /Monaco/, 'Coast')
    await expect(section.getByTestId('location-item-place').nth(2)).toHaveText('Monaco')
    await expect(section.getByTestId('locations-limit')).toHaveText(
      'You have saved three locations. Delete one to add another.'
    )
    await expect(search).toHaveCount(0)

    await log.step('switching primary is one press and the ritual follows')
    await section.getByRole('button', { name: 'Make primary, Ozarks' }).click()
    await expect(section.getByTestId('locations-status-region')).toHaveText(
      'Ozarks is now your primary location.'
    )
    await expect(section.getByTestId('location-item').nth(1)).toHaveAttribute(
      'data-primary',
      'true'
    )
    const ritual = await request.get(
      `${locationSession.apiBaseUrl}/api/v1/ritual?locale=en-US`,
      { headers: authHeaders(locationSession.userId, 'guardian') }
    )
    expect(ritual.status()).toBe(200)
    expect(((await ritual.json()) as RitualBody).data.weather.locationKey).toMatch(
      /^springfield-missouri-us-/
    )

    await log.step('rename in place')
    await section.getByRole('button', { name: 'Rename, Coast' }).click()
    await section.getByLabel('New name').fill('Riviera')
    await section.getByRole('button', { name: 'Save name' }).click()
    await expect(section.getByTestId('locations-status-region')).toHaveText(
      'Renamed to Riviera.'
    )

    await log.step('deleting the primary promotes the next location')
    await section.getByRole('button', { name: 'Delete, Ozarks' }).click()
    await section.getByTestId('location-delete-confirm').click()
    await expect(section.getByTestId('locations-status-region')).toHaveText(
      'Ozarks deleted.'
    )
    await expect(section.getByTestId('location-item')).toHaveCount(2)
    await expect(section.getByTestId('location-item').first()).toHaveAttribute(
      'data-primary',
      'true'
    )
    await expect(search).toBeVisible()

    await log.step('the section passes axe with results open')
    await search.fill('Chicago')
    await expect(section.getByRole('option')).toHaveCount(1)
    await checkA11y(page)
  })

  test(
    '1.2b-E2E-03 a provider outage keeps the chosen city and offers retry',
    // The 503s are the subject of this test; the auto network monitor fails any
    // test that sees a response of 400 or worse.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ page, locationSession }) => {
      expect(locationSession.userId).toBeTruthy()
      await page.goto('/settings')
      const section = page.getByTestId('locations-section')
      const search = section.getByRole('combobox', { name: 'Search for a city' })

      await log.step('a failing search answers the localized retryable message')
      await search.fill('Provider down')
      await expect(section.getByTestId('location-error')).toHaveText(
        'City search is temporarily unavailable. Try again.'
      )
      await expect(section.getByTestId('location-retry-button')).toBeVisible()

      await log.step('a failing save forecast keeps the candidate and saves nothing')
      await search.fill('Failtown')
      await section.getByRole('option', { name: /Failtown/ }).click()
      await section.getByRole('button', { name: 'Save location' }).click()
      await expect(section.getByTestId('location-error')).toHaveText(
        'This city could not be saved right now. Try again.'
      )
      await expect(section.getByTestId('location-selected')).toBeVisible()
      await expect(section.getByTestId('location-retry-button')).toBeVisible()
      await expect(section.getByTestId('location-item')).toHaveCount(0)
    }
  )
})
