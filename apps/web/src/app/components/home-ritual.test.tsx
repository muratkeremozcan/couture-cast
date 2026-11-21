import type { RitualResponse, SavedLocation } from '@couture/api-client/contracts/http'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import { HomeRitual } from './home-ritual'

const session = vi.hoisted(() => ({
  owner: null as string | null,
  stored: false,
  verify: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: session.verify,
}))

function publishMember(owner: string | null) {
  act(() => {
    session.owner = owner
    session.stored = owner !== null
    if (owner)
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `bearer-${owner}`)
    else window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    window.dispatchEvent(new Event('couture:session'))
  })
}

const date = '2026-11-20T12:00:00.000Z'
const scenarios = ['morning', 'midday', 'evening'] as const
const homeCity: SavedLocation = {
  id: 'saved-home',
  label: 'Chicago home',
  locationKey: 'chicago',
  latitude: 41.88,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  isPrimary: true,
  sortOrder: 0,
  createdAt: date,
  updatedAt: date,
}

function ritual(starter = false): RitualResponse {
  return {
    data: {
      weather: {
        locationKey: homeCity.locationKey,
        latitude: homeCity.latitude,
        longitude: homeCity.longitude,
        timezone: homeCity.timezone,
        provider: 'openweather',
        providerUpdatedAt: date,
        fetchedAt: date,
        current: { temperature: 21, condition: 'clear' },
        hourly: Array.from({ length: 48 }, (_, hour) => ({
          forecastAt: new Date(Date.parse(date) + hour * 3_600_000).toISOString(),
          temperature: 21,
          feelsLike: 20,
          precipitationProbability: 0,
          precipitationAmount: 0,
          windSpeed: 4,
          windGust: null,
          condition: 'clear',
          providerWeatherCode: '800',
        })),
        alerts: starter
          ? []
          : [
              {
                event: 'Wind advisory',
                description: 'Secure loose layers.',
                start: date,
                end: date,
              },
            ],
      },
      outfits: scenarios.map((scenario) => ({
        id: `${scenario}-recommendation`,
        scenario,
        garmentIds: starter
          ? ['default-top']
          : scenario === 'morning'
            ? []
            : ['jacket-id', 'uncategorized-id'],
        ...(!starter && {
          displayGarments: [{ id: 'jacket-id', category: 'outerwear' }],
        }),
        reasoningBadges: [],
        comfortNotes: `${scenario} comfort note`,
        shopThisLook: null,
      })),
      badges: [],
    },
  }
}

const missingCity = () =>
  HttpResponse.json(
    { message: 'No location preferences found for user' },
    { status: 400 }
  )
const serviceUnavailable = () =>
  HttpResponse.json({ message: 'Unavailable' }, { status: 503 })

function renderHome() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <HomeRitual demo={<p>Visitor outfit demo</p>} />
    </I18nextProvider>
  )
}

beforeEach(async () => {
  session.owner = null
  session.stored = false
  session.verify.mockReset()
  await getI18n().changeLanguage('en-US')
})

afterEach(() => window.sessionStorage.clear())

it('shows the city and garment entry links beside an editable sample when the member has no city', async () => {
  const user = userEvent.setup()
  const reads = vi.fn()
  useMswHandlers(
    http.get('/api/v1/ritual', ({ request }) => {
      reads(request.headers.get('authorization'))
      return missingCity()
    })
  )
  publishMember('sample-member')
  const view = renderHome()

  expect(await screen.findByRole('link', { name: 'Set your city' })).toHaveAttribute(
    'href',
    '/settings?addLocation=1&returnTo=%2F#locations'
  )
  expect(screen.getByRole('link', { name: 'Add one garment' })).toHaveAttribute(
    'href',
    '/wardrobe?entry=add'
  )
  expect(screen.getByText(/^Sample wardrobe\./)).toBeVisible()
  expect(screen.queryByTestId('share-card-open')).toBeNull()
  expect(reads).toHaveBeenCalledExactlyOnceWith('Bearer bearer-sample-member')

  const look = () => screen.getByTestId('guest-preview-look-name').textContent
  const initial = look()
  await user.click(screen.getByRole('button', { name: 'Try another look' }))
  const rotated = look()
  expect(rotated).not.toBe(initial)

  const swap = screen.getByRole('button', { name: /^Swap top:/i })
  const originalName = swap.getAttribute('aria-label')
  await user.click(swap)
  expect(screen.getByRole('dialog', { name: /swap the top/i })).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(swap).toHaveFocus()
  await user.click(swap)
  const [option] = within(screen.getByRole('dialog')).getAllByRole('radio', {
    checked: false,
  })
  await user.click(option!)
  expect(screen.getByRole('button', { name: /^Swap top:/i })).not.toHaveAttribute(
    'aria-label',
    originalName
  )
  await user.click(screen.getByRole('button', { name: 'Undo swaps' }))
  expect(screen.getByRole('button', { name: /^Swap top:/i })).toHaveAttribute(
    'aria-label',
    originalName
  )

  view.unmount()
  renderHome()
  expect(await screen.findByRole('heading', { name: rotated })).toBeVisible()
  publishMember('other-sample-member')
  expect(await screen.findByRole('heading', { name: initial })).toBeVisible()
  expect(screen.queryByRole('heading', { name: rotated })).toBeNull()
})

it('retries a failed recommendation, shows the verified city, and keeps the chosen live outfit during a failed refresh', async () => {
  const user = userEvent.setup()
  let available = false
  const reads = vi.fn()
  useMswHandlers(
    http.get('/api/v1/ritual', ({ request }) => {
      reads(new URL(request.url).searchParams.get('locale'))
      return available ? HttpResponse.json(ritual()) : serviceUnavailable()
    }),
    http.get('/api/v1/locations', () => HttpResponse.json({ data: [homeCity] }))
  )
  publishMember('live-member')
  renderHome()

  expect(await screen.findByText("Unable to load today's outfit.")).toBeVisible()
  expect(screen.getByTestId('member-sample-outfit')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Set your city' })).toBeNull()
  available = true
  await user.click(screen.getByRole('button', { name: 'Try again' }))

  const live = await screen.findByTestId('home-live-outfit')
  expect(await within(live).findByText(homeCity.label)).toBeVisible()
  expect(within(live).getByText('70°F')).toBeVisible()
  expect(within(live).queryByRole('button', { name: 'Morning' })).toBeNull()
  expect(within(live).getByRole('button', { name: 'Midday' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(within(live).getByText('Outerwear')).toBeVisible()
  expect(within(live).getByText('Outfit')).toBeVisible()
  expect(within(live).queryByText('uncategorized-id')).toBeNull()
  expect(within(live).getByText('Wind advisory')).toBeVisible()
  await user.click(within(live).getByRole('button', { name: 'Evening' }))
  expect(within(live).getByText('evening comfort note')).toBeVisible()
  expect(within(live).getByTestId('share-card-open')).toBeVisible()

  available = false
  await act(() => getI18n().changeLanguage('en-CA'))
  expect(await screen.findByText('May be out of date')).toBeVisible()
  expect(within(live).getByText('evening comfort note')).toBeVisible()
  expect(within(live).queryByTestId('share-card-open')).toBeNull()
  expect(screen.queryByTestId('member-sample-outfit')).toBeNull()

  available = true
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await within(live).findByTestId('share-card-open')).toBeVisible()
  expect(screen.queryByText('May be out of date')).toBeNull()
  expect(reads.mock.calls).toEqual([['en-US'], ['en-US'], ['en-CA'], ['en-CA']])
})

it('shows the starter wardrobe entry even when saved-city lookup fails', async () => {
  const reads = vi.fn()
  useMswHandlers(
    http.get('/api/v1/ritual', () => HttpResponse.json(ritual(true))),
    http.get('/api/v1/locations', ({ request }) => {
      reads(request.headers.get('authorization'))
      return serviceUnavailable()
    })
  )
  publishMember('starter-member')
  renderHome()

  expect(await screen.findByText('Starter wardrobe pick')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Add one garment' })).toHaveAttribute(
    'href',
    '/wardrobe?entry=add'
  )
  expect(screen.getByText('Top')).toBeVisible()
  expect(screen.queryByTestId('home-outfit-retry')).toBeNull()
  await waitFor(() =>
    expect(reads).toHaveBeenCalledExactlyOnceWith('Bearer bearer-starter-member')
  )
})

it('keeps a pending session out of the visitor demo until verification settles', async () => {
  const user = userEvent.setup()
  const verification = Promise.withResolvers<string | undefined>()
  session.stored = true
  session.verify
    .mockReturnValueOnce(verification.promise)
    .mockResolvedValueOnce(undefined)
  renderHome()

  expect(screen.getByText('Checking your session…')).toBeVisible()
  expect(screen.queryByText('Visitor outfit demo')).toBeNull()
  await act(async () => {
    verification.reject(new Error('Profile check unavailable'))
    await verification.promise.catch(() => undefined)
  })
  expect(await screen.findByText(/^We couldn't confirm your session/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Visitor outfit demo')).toBeVisible()
  expect(session.verify).toHaveBeenCalledTimes(2)
})

it('discards a delayed city lookup when another member takes over Home', async () => {
  const city = Promise.withResolvers<void>()
  let formerRequest: Request | undefined
  useMswHandlers(
    http.get('/api/v1/ritual', ({ request }) =>
      request.headers.get('authorization') === 'Bearer bearer-former'
        ? HttpResponse.json(ritual())
        : missingCity()
    ),
    http.get('/api/v1/locations', async ({ request }) => {
      formerRequest = request
      await city.promise
      return HttpResponse.json({ data: [homeCity] })
    })
  )
  publishMember('former')
  renderHome()

  try {
    expect(await screen.findByTestId('home-live-outfit')).toBeVisible()
    await waitFor(() => expect(formerRequest).toBeDefined())
    publishMember('current')
    expect(await screen.findByRole('link', { name: 'Set your city' })).toBeVisible()
    expect(formerRequest?.signal.aborted).toBe(true)
    city.resolve()
    await settle()
    expect(screen.queryByText(homeCity.label)).toBeNull()
    expect(screen.queryByTestId('home-live-outfit')).toBeNull()
  } finally {
    city.resolve()
  }
})
