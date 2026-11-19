// Production follow-up after the project close (2026-11-19). Jade: "App needs access to location,
// set up Location permissions. User needs to manually enter their location or the app accesses it
// with user approval." Story 1.2b shipped manual city search only. Settings now carries the
// Profile name, and Locations offers "Use my location": the browser asks for permission only when
// the member taps it, the position is rounded to two decimals in the client, sent only in a POST
// body, resolved to a city by the API, and saved through the existing pick-and-save flow. Denial,
// an unsupported browser, no nearby city or a provider outage leave manual search working.
//
// Local lane only (@local-lane): the API reaches the weather provider double, whose reverse lookup
// answers the catalog place nearest a coordinate (scripts/lib/weather-provider-double-data.mjs).
import type { BrowserContext, Page, Request } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  DOUBLE_PLACES,
  REVERSE_DOWN_COORDINATE,
} from '../../scripts/lib/weather-provider-double-data.mjs'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import {
  expect,
  locationPrisma,
  locationTest as test,
} from '../support/helpers/location-session'

const FROM_COORDINATES = '/api/v1/locations/from-coordinates'
const USE_MY_LOCATION = 'Use my location'
const DENIED = 'Location access is off. Search for your city instead.'
const UNAVAILABLE =
  'Your location is not available right now. Search for your city instead.'
const NO_CITY = 'No city found near you. Search for your city instead.'
const SEARCH_UNAVAILABLE = 'City search is temporarily unavailable. Try again.'
const DOUBLE_ORIGIN = `http://127.0.0.1:${process.env.E2E_WEATHER_DOUBLE_PORT || '4010'}`

/**
 * The device position: more precise than the client may send. It rounds to 41.87, -87.64, which
 * differs on both axes from the provider's Chicago (41.8781, -87.6298, stored as 41.878, -87.63),
 * so the saved row can only match the provider place, never the device.
 */
const DEVICE = { latitude: 41.871234, longitude: -87.641234 }
const ROUNDED = { latitude: 41.87, longitude: -87.64 }
const CHICAGO = DOUBLE_PLACES.find((place) => place.name === 'Chicago')!
/** Saved coordinates keep three decimals (location-preferences.service.ts roundCoordinate). */
const stored = (value: number) => Math.round(value * 1000) / 1000

/** The 503 in UL-4 is its subject; the auto monitor fails any 4xx/5xx. */
const EXPECTED_OUTAGE = { annotation: [{ type: 'skipNetworkMonitoring' }] }

type GeocodingLogEntry = {
  seq: number
  query: string
  latitude?: number
  longitude?: number
}

/** Counts every position request the page makes, so a test can prove none ran before the tap. */
async function countPositionRequests(context: BrowserContext) {
  await context.addInitScript(() => {
    const target = window as unknown as { __positionRequests: number }
    target.__positionRequests = 0
    const geolocation = navigator.geolocation
    if (!geolocation) return
    const getCurrentPosition = geolocation.getCurrentPosition.bind(geolocation)
    const watchPosition = geolocation.watchPosition.bind(geolocation)
    geolocation.getCurrentPosition = (...args) => {
      target.__positionRequests += 1
      return getCurrentPosition(...args)
    }
    geolocation.watchPosition = (...args) => {
      target.__positionRequests += 1
      return watchPosition(...args)
    }
  })
}

const positionRequests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __positionRequests: number }).__positionRequests
  )

/** Every request the page sends to the from-coordinates endpoint. */
function recordFromCoordinates(page: Page): Request[] {
  const seen: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === FROM_COORDINATES) seen.push(request)
  })
  return seen
}

async function geocodingLog(): Promise<GeocodingLogEntry[]> {
  const response = await fetch(`${DOUBLE_ORIGIN}/__double/requests`)
  return ((await response.json()) as { geocoding: GeocodingLogEntry[] }).geocoding
}

async function memberEmail(userId: string): Promise<string> {
  const prisma = locationPrisma()
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    })
    return user.email
  } finally {
    await prisma.$disconnect()
  }
}

async function openLocations(page: Page) {
  await page.goto('/settings')
  await waitForAccessibilityReady(page)
  const section = page.getByTestId('locations-section')
  await expect(section).toHaveAttribute('data-state', 'ready')
  return section
}

/** A failure leaves manual search working: the field is focused and still finds a city. */
async function expectManualSearchStillWorks(section: ReturnType<Page['getByTestId']>) {
  const search = section.getByRole('combobox', { name: 'Search for a city' })
  await expect(search).toBeFocused()
  await search.fill('Chicago')
  await expect(section.getByRole('option', { name: /Chicago, Illinois/ })).toBeVisible()
}

test.describe('Use my location and the Profile page @local-lane', () => {
  test('[P0] UL-1 a member who allows location saves the city near them; only rounded coordinates leave the browser and none are stored', async ({
    page,
    context,
    locationSession,
  }) => {
    await countPositionRequests(context)
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation(DEVICE)
    const sent = recordFromCoordinates(page)
    const section = await openLocations(page)

    await log.step('nothing asks for the position until the member taps the action')
    expect(await positionRequests(page)).toBe(0)
    const before = (await geocodingLog()).at(-1)?.seq ?? 0
    await section.getByRole('button', { name: USE_MY_LOCATION }).click()

    await log.step('the city near the member is offered through the usual pick list')
    const option = section.getByRole('option', { name: /Chicago, Illinois/ })
    await expect(option).toBeVisible()
    expect(await positionRequests(page)).toBe(1)

    await log.step(
      'one POST carried the rounded position in its body and nothing in its URL'
    )
    expect(sent).toHaveLength(1)
    const request = sent[0]!
    expect(request.method()).toBe('POST')
    expect(new URL(request.url()).search).toBe('')
    expect(request.postDataJSON()).toEqual({ ...ROUNDED, locale: 'en-US' })

    await log.step(
      'the provider was asked about the rounded position, never the precise one'
    )
    const lookups = (await geocodingLog()).filter((entry) => entry.seq > before)
    expect(
      lookups.filter(
        (entry) =>
          entry.latitude === ROUNDED.latitude && entry.longitude === ROUNDED.longitude
      )
    ).toHaveLength(1)
    expect(JSON.stringify(lookups)).not.toContain(String(DEVICE.latitude))
    expect(JSON.stringify(lookups)).not.toContain(String(DEVICE.longitude))

    await log.step('pick, name and save it like a searched city')
    await option.click()
    const label = section.getByLabel('Name this place')
    await expect(label).toBeFocused()
    await label.fill('Home')
    await label.press('Enter')
    await expect(section.getByTestId('location-item')).toHaveCount(1)
    await expect(section.getByTestId('location-item-label')).toHaveText('Home')
    await expect(section.getByTestId('location-primary-badge')).toBeVisible()
    await checkA11y(page)

    await log.step('the saved row holds the provider place, not the device position')
    const prisma = locationPrisma()
    try {
      const rows = await prisma.savedLocation.findMany({
        where: { user_id: locationSession.userId },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        label: 'Home',
        city: 'Chicago',
        latitude: stored(CHICAGO.lat),
        longitude: stored(CHICAGO.lon),
      })
      expect(rows[0]!.latitude).not.toBe(ROUNDED.latitude)
      expect(rows[0]!.longitude).not.toBe(ROUNDED.longitude)
    } finally {
      await prisma.$disconnect()
    }
  })

  test('[P1] UL-2 a member who denies location gets the reason and a working city search, and nothing is sent', async ({
    page,
    context,
    locationSession,
  }) => {
    expect(locationSession.userId).toBeTruthy()
    await context.clearPermissions()
    const sent = recordFromCoordinates(page)
    const section = await openLocations(page)
    await section.getByRole('button', { name: USE_MY_LOCATION }).click()

    await expect(section.getByRole('alert')).toHaveText(DENIED)
    expect(sent).toHaveLength(0)
    await expectManualSearchStillWorks(section)
  })

  test('[P1] UL-3 a browser without geolocation says so, sends nothing, and search still works', async ({
    page,
    context,
    locationSession,
  }) => {
    expect(locationSession.userId).toBeTruthy()
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'geolocation', {
        configurable: true,
        get: () => undefined,
      })
    })
    const sent = recordFromCoordinates(page)
    const section = await openLocations(page)
    await section.getByRole('button', { name: USE_MY_LOCATION }).click()

    await expect(section.getByRole('alert')).toHaveText(UNAVAILABLE)
    expect(sent).toHaveLength(0)
    await expectManualSearchStillWorks(section)
  })

  test('[P1] UL-4 no city near the member: a clear message, nothing saved, search still works', async ({
    page,
    context,
    locationSession,
  }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 0, longitude: 0 })
    const section = await openLocations(page)
    await section.getByRole('button', { name: USE_MY_LOCATION }).click()

    await expect(section.getByRole('alert')).toHaveText(NO_CITY)
    await expect(section.getByRole('option')).toHaveCount(0)
    await expectManualSearchStillWorks(section)
    const prisma = locationPrisma()
    try {
      expect(
        await prisma.savedLocation.count({ where: { user_id: locationSession.userId } })
      ).toBe(0)
    } finally {
      await prisma.$disconnect()
    }
  })

  test(
    '[P1] UL-5 a provider outage reads as the city search outage, and search still works',
    EXPECTED_OUTAGE,
    async ({ page, context, locationSession }) => {
      expect(locationSession.userId).toBeTruthy()
      await context.grantPermissions(['geolocation'])
      await context.setGeolocation({
        latitude: REVERSE_DOWN_COORDINATE.lat,
        longitude: REVERSE_DOWN_COORDINATE.lon,
      })
      const section = await openLocations(page)
      await section.getByRole('button', { name: USE_MY_LOCATION }).click()

      await expect(section.getByRole('alert')).toHaveText(SEARCH_UNAVAILABLE)
      await expectManualSearchStillWorks(section)
    }
  )

  // The bottom nav shows below 768px and the header nav at every width, so a phone sees both
  // Profile links and a desktop only the header one. Each viewport is checked on its own nav.
  for (const viewport of [
    {
      name: 'desktop',
      size: { width: 1280, height: 800 },
      link: 'nav-profile',
      nav: 'primary-nav',
    },
    {
      name: 'phone',
      size: { width: 390, height: 844 },
      link: 'bottom-nav-settings',
      nav: 'sticky-bottom-nav',
    },
  ] as const) {
    test(`[P1] UL-6 ${viewport.name}: Settings is the Profile; the visible nav says Profile, the page says Profile and shows the account`, async ({
      page,
      locationSession,
    }) => {
      const email = await memberEmail(locationSession.userId)
      await page.setViewportSize(viewport.size)
      await page.goto('/')

      const nav = page.getByTestId(viewport.nav)
      await expect(nav).toBeVisible()
      const profileLink = nav.getByTestId(viewport.link)
      await expect(profileLink).toBeVisible()
      await expect(profileLink).toHaveAccessibleName('Profile')
      await expect(profileLink).toHaveAttribute('href', '/settings')
      if (viewport.name === 'desktop')
        await expect(page.getByTestId('sticky-bottom-nav')).toBeHidden()
      await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(
        0
      )

      await profileLink.click()
      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profile')
      await expect(page.getByTestId('profile-account')).toContainText(email)
      // Everything Settings held is still here.
      await expect(page.getByTestId('locations-section')).toHaveAttribute(
        'data-state',
        'ready'
      )
      await expect(
        page.getByRole('heading', { name: 'Shopping and partners' })
      ).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible()
      await expect(
        page.getByRole('heading', { name: 'Interface palettes' })
      ).toBeVisible()
      await checkA11y(page)
    })
  }
})

// Codex review 1 finding 7: desktop hides the translated bottom nav, so the header link is the
// only way in there, and it must speak the member's language like the page it opens.
test.describe('the Profile entry in German @local-lane', () => {
  test.use({ locale: 'de-DE' })

  test('[P1] UL-7 desktop de-DE: the header link reads Profil and opens the Profil page', async ({
    page,
    locationSession,
  }) => {
    const email = await memberEmail(locationSession.userId)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE')

    const profileLink = page.getByTestId('primary-nav').getByTestId('nav-profile')
    await expect(profileLink).toBeVisible()
    await expect(profileLink).toHaveAccessibleName('Profil')
    await expect(profileLink).toHaveAttribute('href', '/settings')
    // The analytics label stays stable across locales.
    await expect(profileLink).toHaveAttribute('data-ph-label', 'Profile')

    await profileLink.click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profil')
    await expect(page.getByTestId('profile-account')).toContainText(email)
    await expect(
      page.getByTestId('locations-section').getByRole('button', {
        name: 'Meinen Standort verwenden',
      })
    ).toBeVisible()
  })
})
