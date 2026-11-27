// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): D7, View on the Home sample save confirmation opens the saved
// look's detail, for a new save and for a save that confirmed an existing look (Codex 7.12 #1).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
import type { RitualResponse, SavedLocation } from '@couture/api-client/contracts/http'
import { createMemberSampleOutfit, rotateMemberSampleOutfit } from '@couture/utils'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { createSavedLooksMswHandlers } from '../../test-utils/saved-looks-msw'
import { settle } from '../../test-utils/request-barrier'
import { HomeRitual } from './home-ritual'

// Story CC-7.12 D7: View pushes the saved look's address through the router.
const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  forward: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

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

async function openSampleEditor() {
  const edit = await screen.findByText('Edit sample', { exact: true })
  if (!edit.closest('details')?.open) await userEvent.setup().click(edit)
}

beforeEach(async () => {
  router.push.mockReset()
  session.owner = null
  session.stored = false
  session.verify.mockReset()
  await getI18n().changeLanguage('en-US')
})

afterEach(() => window.sessionStorage.clear())

it('persists Home sample saves and removals to the account API across remounts', async () => {
  const owner = 'shared-bookmark-member'
  const first = createMemberSampleOutfit()
  const second = rotateMemberSampleOutfit(first)
  const { store, handlers } = createSavedLooksMswHandlers()
  const user = userEvent.setup()
  useMswHandlers(http.get('/api/v1/ritual', missingCity), ...handlers)
  publishMember(owner)
  const view = renderHome()
  try {
    await openSampleEditor()
    await user.click(await screen.findByRole('button', { name: 'Save example look' }))
    await waitFor(() =>
      expect(store.items.map(({ lookId }) => lookId)).toEqual([first.look?.id])
    )
    await user.click(screen.getByRole('button', { name: 'Try another look' }))
    await user.click(screen.getByRole('button', { name: 'Save example look' }))
    await waitFor(() =>
      expect(store.items.map(({ lookId }) => lookId)).toEqual([
        second.look?.id,
        first.look?.id,
      ])
    )

    await user.click(screen.getByRole('button', { name: 'Remove Silk midi' }))
    await waitFor(() =>
      expect(store.items.map(({ lookId }) => lookId)).toEqual([first.look?.id])
    )

    // Remounting reads the saved look from the account API without localStorage.
    view.unmount()
    const remounted = renderHome()
    try {
      await openSampleEditor()
      const saved = await screen.findByRole('region', { name: 'Saved on this device' })
      expect(within(saved).getByRole('button', { name: 'Office oxford' })).toBeVisible()
    } finally {
      remounted.unmount()
    }
  } finally {
    view.unmount()
  }
})

it('scopes account saved looks by member and drops late responses after switching members', async () => {
  const owner = 'locked-bookmark-member'
  const nextOwner = 'next-bookmark-member'
  const postStarted = Promise.withResolvers<void>()
  const delayedPost = Promise.withResolvers<void>()
  const { store, handlers } = createSavedLooksMswHandlers()
  store.onPost = async () => {
    postStarted.resolve()
    await delayedPost.promise
  }
  const user = userEvent.setup()
  useMswHandlers(http.get('/api/v1/ritual', missingCity), ...handlers)
  publishMember(owner)
  const view = renderHome()
  try {
    await openSampleEditor()
    await user.click(await screen.findByRole('button', { name: 'Save example look' }))
    await postStarted.promise
    publishMember(nextOwner)
    await openSampleEditor()
    expect(await screen.findByRole('button', { name: 'Save example look' })).toBeVisible()
    await act(async () => {
      delayedPost.resolve()
      await delayedPost.promise
    })
    await waitFor(() => expect(store.items).toHaveLength(1))
    expect(screen.queryByRole('region', { name: 'Saved on this device' })).toBeNull()
    expect(store.items[0]?.ownerUserId).toBe(`bearer-${owner}`)
  } finally {
    view.unmount()
  }
})

it('blocks signed-in Home Save while offline and prevents a stale GET from overwriting a completed save', async () => {
  const owner = 'stale-get-member'
  const delayedGet = Promise.withResolvers<void>()
  let getCount = 0
  let postCount = 0
  const { store, handlers } = createSavedLooksMswHandlers()
  store.onGet = async () => {
    getCount += 1
    if (getCount === 1) await delayedGet.promise
  }
  store.onPost = () => {
    postCount += 1
  }
  const user = userEvent.setup()
  useMswHandlers(http.get('/api/v1/ritual', missingCity), ...handlers)
  publishMember(owner)
  const view = renderHome()
  try {
    // Offline Home Save sends zero POSTs and preserves the outfit.
    const onlineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    window.dispatchEvent(new Event('offline'))
    try {
      await openSampleEditor()
      await user.click(await screen.findByRole('button', { name: 'Save example look' }))
      expect(postCount).toBe(0)
    } finally {
      if (onlineDescriptor) {
        Object.defineProperty(window.navigator, 'onLine', onlineDescriptor)
      } else {
        Object.defineProperty(window.navigator, 'onLine', {
          configurable: true,
          value: true,
        })
      }
      window.dispatchEvent(new Event('online'))
    }

    // Reconnect: Save completes before slow initial GET resolves; stale GET must not wipe saved item.
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(1))
    expect(await screen.findByTestId('sample-saved-looks')).toBeVisible()

    await act(async () => {
      delayedGet.resolve()
      await delayedGet.promise
    })
    expect(screen.getByTestId('sample-saved-looks')).toBeVisible()
  } finally {
    view.unmount()
  }
})

it('saves and reopens Home sample looks even when browser localStorage is blocked', async () => {
  const owner = 'no-bookmark-storage-member'
  const blockedStorage = vi
    .spyOn(window, 'localStorage', 'get')
    .mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
  const { store, handlers } = createSavedLooksMswHandlers()
  const user = userEvent.setup()
  useMswHandlers(http.get('/api/v1/ritual', missingCity), ...handlers)
  publishMember(owner)
  try {
    renderHome()
    await openSampleEditor()
    await user.click(await screen.findByRole('button', { name: 'Save example look' }))
    const saved = await screen.findByRole('region', { name: 'Saved on this device' })
    expect(store.items).toHaveLength(1)

    const weather = screen.getByRole('combobox', { name: 'Sample weather' })
    await user.selectOptions(weather, 'cool-windy')
    await user.click(screen.getByText('Style preferences (optional)'))
    await user.selectOptions(screen.getByRole('combobox', { name: /^Style$/ }), 'cozy')
    await user.click(screen.getByRole('button', { name: 'Try another look' }))
    await user.click(screen.getByRole('button', { name: 'Save example look' }))
    await waitFor(() => expect(within(saved).getAllByRole('button')).toHaveLength(4))

    await user.click(within(saved).getByRole('button', { name: 'Office oxford' }))
    expect(screen.getByTestId('guest-preview-look-name')).toHaveTextContent(
      'Office oxford'
    )
    expect(weather).toHaveValue('mild-dry')
    await user.click(within(saved).getByRole('button', { name: 'Remove Office oxford' }))
    await waitFor(() => expect(within(saved).getAllByRole('button')).toHaveLength(2))
  } finally {
    blockedStorage.mockRestore()
  }
})

it('reuses the same Idempotency-Key when retrying a failed Home sample save', async () => {
  const owner = 'recovering-bookmark-member'
  const seenKeys: string[] = []
  let failOnce = true
  const { store, handlers } = createSavedLooksMswHandlers()
  store.onPost = (request) => {
    const key = request.headers.get('Idempotency-Key')
    if (key) seenKeys.push(key)
  }
  store.nextPostError = () => {
    if (!failOnce) return null
    failOnce = false
    return HttpResponse.json({ message: 'Transient error' }, { status: 503 })
  }
  const user = userEvent.setup()
  useMswHandlers(http.get('/api/v1/ritual', missingCity), ...handlers)
  publishMember(owner)
  const view = renderHome()
  try {
    await openSampleEditor()
    const saveButton = await screen.findByRole('button', { name: 'Save example look' })
    await user.click(saveButton)
    await waitFor(() => expect(seenKeys).toHaveLength(1))
    expect(store.items).toHaveLength(0)

    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(1))
    expect(seenKeys).toHaveLength(2)
    expect(seenKeys[0]).toBe(seenKeys[1])
  } finally {
    view.unmount()
  }
})

it('revalidates cached Home looks on re-save after remote deletion and merges slow initial GET with early Save', async () => {
  const owner = 'revalidate-merge-member'
  const existingOnServer = {
    id: 'sl-server-existing',
    ownerUserId: `bearer-${owner}`,
    source: 'home_sample' as const,
    lookId: 'sample:l:silk-midi',
    weather: 'warm-rainy',
    title: null,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [
      {
        slotIndex: 0,
        category: 'top' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:knit-tee',
        label: null,
        missing: false,
        imageAccess: null,
      },
    ],
    swaps: {},
    collection: 'all',
    comfort: {
      runsColdWarm: 'neutral' as const,
      windTolerance: 'medium' as const,
      precipPreparedness: 'medium' as const,
    },
    availabilityStatus: 'ready' as const,
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
  }
  const { store, handlers } = createSavedLooksMswHandlers([existingOnServer])
  let releaseInitialGet!: () => void
  let heldOnce = false
  store.onGet = async (request) => {
    if (heldOnce || new URL(request.url).pathname !== '/api/v1/wardrobe/saved-looks') {
      return
    }
    heldOnce = true
    await new Promise<void>((resolve) => {
      releaseInitialGet = resolve
    })
  }

  const user = userEvent.setup()
  useMswHandlers(http.get('/api/v1/ritual', missingCity), ...handlers)
  publishMember(owner)
  const view = renderHome()
  try {
    // Save before the initial GET finishes, then release GET -> both looks are present.
    await openSampleEditor()
    const saveButton = await screen.findByRole('button', { name: 'Save example look' })
    await user.click(saveButton)
    await waitFor(() => expect(store.items).toHaveLength(2))
    releaseInitialGet()
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sample-saved-looks')).getAllByRole('button')
      ).toHaveLength(4)
    )

    // Remove the newly saved look remotely on another device -> re-saving revalidates (404) and recreates it.
    const newlyCreatedId = store.items.find((item) => item.id !== existingOnServer.id)!.id
    store.items = store.items.filter((item) => item.id !== newlyCreatedId)
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(2))
    expect(store.items.some((item) => item.id !== existingOnServer.id)).toBe(true)

    // 404 stale remove cleans up the local list cleanly.
    store.items = []
    const removeButtons = within(screen.getByTestId('sample-saved-looks')).getAllByRole(
      'button',
      { name: /^Remove / }
    )
    await user.click(removeButtons[0]!)
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sample-saved-looks')).getAllByRole('button')
      ).toHaveLength(2)
    )

    // 409 SAVED_LOOK_ALREADY_REMOVED returns false cleanly without duplicate creation.
    let return409Once = true
    store.nextPostError = () => {
      if (!return409Once) return null
      return409Once = false
      return HttpResponse.json(
        { code: 'SAVED_LOOK_ALREADY_REMOVED', message: 'Already removed' },
        { status: 409 }
      )
    }
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() =>
      expect(screen.getByTestId('sample-save-look')).toHaveTextContent('Failed')
    )

    // Save look again -> Undo Save with 404 from server still cleans up local state cleanly.
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(1))
    let return404OnUndoOnce = true
    store.nextDeleteError = () => {
      if (!return404OnUndoOnce) return null
      return404OnUndoOnce = false
      return HttpResponse.json({ message: 'Not found' }, { status: 404 })
    }
    await user.click(await screen.findByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )
    )
    store.items = []

    // Save look again -> View -> Reopen saved look -> Re-save hits verified 200 non-destructive refresh.
    // CC-7.12 D7: View opens the new look's detail. (The CC-7.2 step queried a
    // `status-bar-action-view-saved` id that never existed and skipped itself; the action is
    // `status-bar-action-view`.)
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(1))
    const createdId = store.items[0]!.id
    await user.click(await screen.findByTestId('status-bar-action-view'))
    expect(router.push).toHaveBeenCalledExactlyOnceWith(`/looks/saved/${createdId}`)

    // Shuffle away and reopen the saved look so saveResetKey resets while matching existingMatch.
    await user.click(screen.getByRole('button', { name: 'Try another look' }))
    const openSavedBtns = within(screen.getByTestId('sample-saved-looks')).getAllByRole(
      'button'
    )
    await user.click(openSavedBtns[0]!)
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() =>
      expect(screen.getByTestId('sample-save-look')).toHaveTextContent('Saved')
    )
    expect(screen.queryByTestId('status-bar-action-undo')).not.toBeInTheDocument()
    // Codex 7.12 #1: the save confirmed the existing look, so View opens that look.
    router.push.mockClear()
    await user.click(await screen.findByTestId('status-bar-action-view'))
    expect(router.push).toHaveBeenCalledExactlyOnceWith(`/looks/saved/${createdId}`)
    expect(store.items.map((item) => item.id)).toEqual([createdId])

    // Offline Remove shows offline notice without calling DELETE.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const removeSampleBtns = within(
      screen.getByTestId('sample-saved-looks')
    ).getAllByRole('button', { name: /^Remove / })
    await user.click(removeSampleBtns[0]!)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    Reflect.deleteProperty(navigator, 'onLine')

    // Failed Remove offers Retry, then failed Undo Remove shows error notice.
    let failDeleteSampleOnce = true
    store.nextDeleteError = () => {
      if (!failDeleteSampleOnce) return null
      failDeleteSampleOnce = false
      return HttpResponse.json({ message: 'Delete error' }, { status: 503 })
    }
    await user.click(removeSampleBtns[0]!)
    const retryDeleteSample = await screen.findByTestId('status-bar-action-retry')
    await user.click(retryDeleteSample)
    await waitFor(() => expect(store.items).toHaveLength(0))

    let failRestoreSampleOnce = true
    store.nextRestoreError = () => {
      if (!failRestoreSampleOnce) return null
      failRestoreSampleOnce = false
      return HttpResponse.json({ message: 'Restore error' }, { status: 503 })
    }
    const undoDeleteSample = await screen.findByTestId('status-bar-action-undo')
    // First click Undo while offline -> shows offline notice without calling /restore.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await user.click(undoDeleteSample)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    Reflect.deleteProperty(navigator, 'onLine')

    // Re-save and Remove again so Undo is back, then test 503 restore failure.
    await user.click(screen.getByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(1))
    const removeAgainBtns = within(screen.getByTestId('sample-saved-looks')).getAllByRole(
      'button',
      { name: /^Remove / }
    )
    await user.click(removeAgainBtns[0]!)
    await waitFor(() => expect(store.items).toHaveLength(0))
    const undoDeleteSample2 = await screen.findByTestId('status-bar-action-undo')
    await user.click(undoDeleteSample2)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )
  } finally {
    Reflect.deleteProperty(navigator, 'onLine')
    view.unmount()
  }
})

it('shows the city and garment entry links beside an editable sample when the member has no city', async () => {
  const user = userEvent.setup()
  const reads = vi.fn()
  useMswHandlers(
    http.get('/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
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
  expect(await screen.findByTestId('home-add-garment')).toHaveAttribute(
    'href',
    '/wardrobe?entry=add'
  )
  expect(screen.getByTestId('member-sample-label')).toHaveTextContent('Sample look')
  expect(screen.queryByTestId('share-card-open')).toBeNull()
  expect(reads).toHaveBeenCalledExactlyOnceWith('Bearer bearer-sample-member')

  await openSampleEditor()
  const look = () => screen.getByTestId('guest-preview-look-name').textContent
  const initial = look()
  await user.click(screen.getByRole('button', { name: 'Try another look' }))
  const rotated = look()
  expect(rotated).not.toBe(initial)

  const editorTop = () =>
    within(screen.getByTestId('guest-preview-outfit')).getByRole('button', {
      name: /^Swap top:/i,
    })
  const originalName = editorTop().getAttribute('aria-label')
  await user.click(editorTop())
  expect(screen.getByRole('dialog', { name: /swap the top/i })).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(editorTop()).toHaveFocus()
  await user.click(editorTop())
  const [option] = within(screen.getByRole('dialog')).getAllByRole('radio', {
    checked: false,
  })
  await user.click(option!)
  expect(editorTop()).not.toHaveAttribute('aria-label', originalName)
  await user.click(screen.getByRole('button', { name: 'Undo swaps' }))
  expect(editorTop()).toHaveAttribute('aria-label', originalName)

  view.unmount()
  renderHome()
  const sampleTitle = () =>
    screen.getByTestId('member-sample-outfit').querySelector(':scope > h2')
  await waitFor(() => expect(sampleTitle()).toHaveTextContent(rotated ?? ''))
  publishMember('other-sample-member')
  await waitFor(() => expect(sampleTitle()).toHaveTextContent(initial ?? ''))
  expect(sampleTitle()).not.toHaveTextContent(rotated ?? '')
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

  expect(await screen.findByTestId('home-outfit-retry')).toBeVisible()
  expect(screen.getByTestId('member-sample-outfit')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Set your city' })).toBeVisible()
  available = true
  await user.click(screen.getByRole('button', { name: 'Try again' }))

  const live = await screen.findByTestId('home-live-outfit')
  expect(
    await within(screen.getByTestId('weather-header')).findByText(homeCity.label)
  ).toBeVisible()
  expect(within(screen.getByTestId('weather-header')).getByText('70°F')).toBeVisible()
  await user.click(within(live).getByTestId('today-outfit-details'))
  expect(within(live).queryByRole('button', { name: 'Morning' })).toBeNull()
  expect(within(live).getByRole('button', { name: 'Midday' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(within(live).getByRole('button', { name: /swap.*outer layer/i })).toBeVisible()
  expect(within(live).getByTestId('today-outfit-slot-1')).toHaveAccessibleName(
    /swap.*top/i
  )
  expect(within(live).getByTestId('today-outfit-slot-1')).not.toHaveAccessibleName(
    /uncategorized-id/i
  )
  expect(screen.getByText('Wind advisory')).toBeVisible()
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
    http.get('/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
    http.get('/api/v1/ritual', () => HttpResponse.json(ritual(true))),
    http.get('/api/v1/locations', ({ request }) => {
      reads(request.headers.get('authorization'))
      return serviceUnavailable()
    })
  )
  publishMember('starter-member')
  renderHome()

  expect(await screen.findByTestId('today-outfit-catalog-0')).toBeVisible()
  expect(await screen.findByTestId('home-add-garment')).toHaveAttribute(
    'href',
    '/wardrobe?entry=add'
  )
  expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(/swap.*top/i)
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

it('shows inline Needs review badge for unresolved Home saved looks and avoids substituting another outfit on click (CC-7.3)', async () => {
  const user = userEvent.setup()
  const owner = 'home-review-member'
  window.localStorage.setItem(
    `couturecast.member-sample-bookmarks.${owner}`,
    JSON.stringify([
      {
        lookId: 'sample:l:summer-linen',
        weather: 'cool-windy',
        collection: 'all',
        comfort: {
          runsColdWarm: 'neutral',
          windTolerance: 'medium',
          precipPreparedness: 'medium',
        },
        swaps: {},
      },
    ])
  )
  const { store, handlers } = createSavedLooksMswHandlers()
  useMswHandlers(
    http.get('/api/v1/ritual', () => missingCity()),
    ...handlers
  )
  publishMember(owner)
  const view = renderHome()
  await openSampleEditor()

  try {
    await waitFor(() => expect(store.items).toHaveLength(1))
    expect(store.items[0]?.availabilityStatus).toBe('needs_review')

    const savedSection = await screen.findByTestId('sample-saved-looks')
    const badge = await within(savedSection).findByTestId('saved-look-needs-review')
    expect(badge).toHaveTextContent('Needs review')

    const beforeLook = screen.getByTestId('guest-preview-look-name').textContent
    const openBtn = within(savedSection).getAllByRole('button')[0]!
    await user.click(openBtn)

    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Review it to make sure it still fits.'
      )
    )
    expect(screen.getByTestId('guest-preview-look-name').textContent).toBe(beforeLook)
    expect(
      window.localStorage.getItem(`couturecast.member-sample-bookmarks.${owner}`)
    ).toBeNull()
  } finally {
    view.unmount()
  }
})

// Story CC-7.7 D2 (7.7-CMP-003, 7.7-CMP-004): a member never sees the sample outfit before their
// own ritual read settles. It appears only when that read answers without a usable outfit, or
// fails (with the failure copy and Retry in place).
function ritualWithoutOutfit(): RitualResponse {
  const response = ritual()
  return {
    data: {
      ...response.data,
      outfits: response.data.outfits.map(({ displayGarments: _unused, ...outfit }) => ({
        ...outfit,
        garmentIds: [],
      })),
    },
  }
}

it('7.7-CMP-003 renders no sample outfit while the member ritual read is unsettled', async () => {
  const held = Promise.withResolvers<void>()
  useMswHandlers(
    http.get('/api/v1/ritual', async () => {
      await held.promise
      return HttpResponse.json(ritualWithoutOutfit())
    })
  )
  publishMember('unsettled-member')
  renderHome()
  await settle()

  expect(screen.queryByTestId('member-sample-outfit')).toBeNull()
  expect(screen.queryByTestId('home-live-outfit')).toBeNull()
  expect(screen.queryByText('Visitor outfit demo')).toBeNull()

  held.resolve()
  expect(await screen.findByTestId('member-sample-outfit')).toBeVisible()
})

it('7.7-CMP-004 a ritual with no usable outfit shows the member sample outfit', async () => {
  useMswHandlers(
    http.get('/api/v1/ritual', () => HttpResponse.json(ritualWithoutOutfit()))
  )
  publishMember('empty-ritual-member')
  renderHome()

  expect(await screen.findByTestId('member-sample-outfit')).toBeVisible()
  expect(screen.queryByTestId('home-live-outfit')).toBeNull()
  expect(screen.queryByTestId('home-outfit-retry')).toBeNull()
})

it('7.7-CMP-004 a failed ritual shows the sample with the failure copy and Retry', async () => {
  useMswHandlers(http.get('/api/v1/ritual', serviceUnavailable))
  publishMember('failed-ritual-member')
  renderHome()

  expect(await screen.findByTestId('home-outfit-retry')).toBeVisible()
  expect(screen.getByTestId('member-sample-outfit')).toBeVisible()
  expect(screen.getByTestId('home-outfit-retry')).toBeVisible()
})

it('[7.14-PIC-005] retries the same dated save, keeps a second composition, and undoes only that save', async () => {
  const user = userEvent.setup()
  const { store, handlers } = createSavedLooksMswHandlers()
  const answers = [503, 201, 409, 201]
  const keys: (string | null)[] = []
  store.onPost = (request) => {
    keys.push(request.headers.get('Idempotency-Key'))
  }
  store.nextPostError = () => {
    const status = answers.shift()
    return status === 503 || status === 409
      ? HttpResponse.json({ message: 'Fixture save error' }, { status })
      : null
  }
  const starter = ritual(true)
  useMswHandlers(
    http.get('/api/v1/ritual', () => HttpResponse.json(starter)),
    ...handlers
  )
  publishMember('today-saver')
  renderHome()

  const wear = await screen.findByTestId('today-primary-action')
  await user.click(wear)
  await user.click(await screen.findByTestId('status-bar-action-retry'))
  await waitFor(() => expect(wear).toHaveAttribute('data-save-state', 'saved'))
  expect(store.items).toHaveLength(1)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  const first = store.items[0]!
  expect(first.wornOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await user.click(screen.getByTestId('status-bar-action-view'))
  expect(router.push).toHaveBeenCalledWith(`/looks/saved/${first.id}`)

  const slot = screen.getByTestId('today-outfit-slot-0')
  await user.click(slot)
  await user.click(screen.getByTestId('today-outfit-swap-option-1'))
  await user.click(wear)
  await user.click(await screen.findByTestId('status-bar-action-retry'))
  await waitFor(() => expect(wear).toHaveAttribute('data-save-state', 'saved'))
  expect(keys).toHaveLength(4)
  expect(keys[3]).not.toBe(keys[2])
  expect(store.items).toHaveLength(2)
  expect(store.items[0]?.composition[0]?.itemId).not.toBe(first.composition[0]?.itemId)

  await user.click(screen.getByTestId('status-bar-action-undo'))
  await waitFor(() => expect(store.items.map(({ id }) => id)).toEqual([first.id]))
  await waitFor(() =>
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Change undone.')
  )
})

it('[7.14-PIC-002/003] the guardian-pending catalog outfit has no recommendation-bound actions', async () => {
  const pending = ritual(true)
  pending.data.outfits = pending.data.outfits.map((outfit) => ({
    ...outfit,
    recommendationActionsAvailable: false,
  }))
  useMswHandlers(http.get('/api/v1/ritual', () => HttpResponse.json(pending)))
  publishMember('pending-today-member')
  renderHome()
  expect(await screen.findByTestId('today-outfit-catalog-0')).toBeVisible()
  expect(screen.getByTestId('today-outfit-picture').querySelector('img')).toBeNull()
  await userEvent.setup().click(screen.getByTestId('today-outfit-details'))
  expect(screen.getByText('morning comfort note')).toBeVisible()
  expect(screen.queryByTestId('share-card-open')).toBeNull()
  expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
})
