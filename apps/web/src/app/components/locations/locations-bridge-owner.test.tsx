// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), Codex product review 7 findings 1 and 6: the session bridge
// can already hold member B's token while React still shows member A's Locations section (the
// couture:session event has not reached it yet). Nothing A started or presses in that window may
// reach the API: a held device position, an armed search timer, a save, a rename, a primary change
// or a delete sends zero requests. A focus decided for A is not carried out on B's turn either.
import { http, HttpResponse } from 'msw'
import { useLayoutEffect } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocationSearchCandidate,
  SavedLocation,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as DevicePosition from '../../../lib/device-position'
import type * as Locations from '../../../lib/locations'
import type * as WebSession from '../../../lib/web-session'
import { LOCATION_SEARCH_DEBOUNCE_MS } from './location-search-form'
import { useWebSession } from '../../../lib/use-web-session'
import { LocationsSection } from './locations-section'

/** Every client call the section or form starts, kept until it settles. */
const tracked = vi.hoisted(() => ({
  promises: [] as Promise<unknown>[],
  /** The labels of the last list the client handed to the section. */
  lastListLabels: [] as string[],
}))

function track<T>(promise: Promise<T>): Promise<T> {
  tracked.promises.push(promise)
  return promise
}

vi.mock('../../../lib/device-position', async (importOriginal) => {
  const actual = await importOriginal<typeof DevicePosition>()
  return {
    ...actual,
    readApproximatePosition: () => track(actual.readApproximatePosition()),
  }
})

vi.mock('../../../lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  const wrap =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A) =>
      track(call(...args))
  return {
    ...actual,
    listLocationsFromWeb: (...args: Parameters<typeof actual.listLocationsFromWeb>) =>
      track(
        actual.listLocationsFromWeb(...args).then((rows) => {
          tracked.lastListLabels = rows.map((row) => row.label)
          return rows
        })
      ),
    searchLocationsFromWeb: wrap(actual.searchLocationsFromWeb),
    locationsFromCoordinatesFromWeb: wrap(actual.locationsFromCoordinatesFromWeb),
    saveLocationFromSearchFromWeb: wrap(actual.saveLocationFromSearchFromWeb),
    renameLocationFromWeb: wrap(actual.renameLocationFromWeb),
    setPrimaryLocationFromWeb: wrap(actual.setPrimaryLocationFromWeb),
    deleteLocationFromWeb: wrap(actual.deleteLocationFromWeb),
  }
})

/** The browser's own frame scheduler: the test's waits never pass through a spy on it. */
const realFrame = window.requestAnimationFrame.bind(window)

/** Every tracked call has settled and React has applied what its handlers set. */
async function settleClient() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await Promise.allSettled(tracked.promises)
    })
    await act(async () => {
      await new Promise((resolve) => realFrame(() => resolve(undefined)))
    })
  }
}

/** The session bridge's state, driven by hand. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
}))

vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    Promise.resolve(
      session.identity
        ? (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY) ?? undefined)
        : undefined
    ),
}))

const navigation = vi.hoisted(() => ({ push: vi.fn(), query: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

function place(id: string, label: string, isPrimary: boolean): SavedLocation {
  return {
    id,
    label,
    locationKey: `${id}-key`,
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    isPrimary,
    sortOrder: isPrimary ? 0 : 1,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  }
}

function candidate(city: string, region: string): LocationSearchCandidate {
  return {
    city,
    region,
    country: 'US',
    latitude: 41.878,
    longitude: -87.63,
    displayLabel: `${city}, ${region}, United States`,
    candidateToken: `${city.toLowerCase()}-payload.signature`,
  }
}

const A_HOME = place('a-1', 'Alpha Home', true)
const A_WORK = place('a-2', 'Alpha Work', false)
const B_OFFICE = place('b-1', 'Bravo Office', true)
const CHICAGO = candidate('Chicago', 'Illinois')
const SPRINGFIELD = candidate('Springfield', 'Missouri')

/** Every request the API saw, and whether it came after the bridge moved to B. */
let requests: {
  method: string
  path: string
  bearer: string | null
  afterMove: boolean
}[]
let bridgeMoved: boolean
let renamedTo: string | null
/** Places A saved during the test, listed after A's two. */
let savedRows: SavedLocation[]
let pendingPosition: { success: PositionCallback } | null
/** When set, the next search or city lookup answer waits for the test to release it. */
let holdNextAnswer: boolean
let heldAnswer: { release: () => void } | null

async function maybeHold() {
  if (!holdNextAnswer) return
  holdNextAnswer = false
  await new Promise<void>((resolve) => {
    heldAnswer = { release: resolve }
  })
}

/**
 * Every message the status and alert regions show from now on, once per change: a region that
 * goes from empty (or another text) to a message adds that message.
 */
function recordFeedback(): string[] {
  const seen: string[] = []
  const last = new Map<Element, string>()
  for (const region of document.querySelectorAll('[role="status"], [role="alert"]'))
    last.set(region, region.textContent?.trim() ?? '')
  const read = () => {
    for (const region of document.querySelectorAll('[role="status"], [role="alert"]')) {
      const text = region.textContent?.trim() ?? ''
      if (text !== (last.get(region) ?? '') && text) seen.push(text)
      last.set(region, text)
    }
  }
  const observer = new MutationObserver(read)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  feedbackObservers.push(observer)
  return seen
}
let feedbackObservers: MutationObserver[] = []

/** Requests sent after the bridge moved, before the section heard: all of them are A's. */
const staleRequests = () => requests.filter((request) => request.afterMove)

/** The bridge now names B and holds B's token; no couture:session event has fired yet. */
function moveBridgeToB() {
  session.identity = 'member-b'
  session.stored = true
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
  bridgeMoved = true
}

/** The event the bridge fires after it moved: B's section loads. */
async function publishB() {
  act(() => {
    window.dispatchEvent(new Event('couture:session'))
  })
  expect(await screen.findByText('Bravo Office')).toBeInTheDocument()
}

/**
 * Reads the page in the same commit as the section, before any passive effect runs: a sibling's
 * layout effect sees exactly what the successor's first commit put on screen.
 */
function FirstCommitProbe({ onCommit }: { onCommit: (owner: string | null) => void }) {
  const webSession = useWebSession()
  const owner = webSession.status === 'signed_in' ? webSession.owner : null
  useLayoutEffect(() => {
    onCommit(owner)
  }, [owner, onCommit])
  return null
}

function renderSection(onCommit?: (owner: string | null) => void) {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <LocationsSection />
        {onCommit && <FirstCommitProbe onCommit={onCommit} />}
      </main>
    </I18nextProvider>
  )
}

const searchInput = () => screen.getByRole('combobox', { name: 'Search for a city' })
const statusRegion = () => screen.getByTestId('locations-status-region')

async function renderA() {
  renderSection()
  expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
  expect(screen.getByText('Alpha Work')).toBeInTheDocument()
  await settleClient()
}

/** After B's section loaded: nothing of A's form or rows is left. */
async function expectCleanB() {
  await publishB()
  await settleClient()
  expect(screen.queryByText(/Alpha/)).toBeNull()
  expect(screen.queryByRole('option')).toBeNull()
  expect(searchInput()).toHaveValue('')
  expect(statusRegion()).not.toHaveTextContent(/Alpha|Chicago|Springfield/)
  expect(requests.filter((request) => request.bearer === 'Bearer token-b')).toEqual([
    {
      method: 'GET',
      path: '/api/v1/locations',
      bearer: 'Bearer token-b',
      afterMove: true,
    },
  ])
}

describe('nothing A started reaches the API once the bridge holds B', () => {
  let user: UserEvent

  beforeEach(async () => {
    user = userEvent.setup()
    requests = []
    bridgeMoved = false
    renamedTo = null
    pendingPosition = null
    holdNextAnswer = false
    heldAnswer = null
    feedbackObservers = []
    tracked.promises = []
    tracked.lastListLabels = []
    navigation.push.mockClear()
    navigation.query = ''
    savedRows = []
    session.identity = 'member-a'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-a')
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          pendingPosition = { success }
        }),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    })
    const log = (request: Request) => {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        bearer: request.headers.get('authorization'),
        afterMove: bridgeMoved,
      })
    }
    useMswHandlers(
      http.get('/api/v1/locations', ({ request }) => {
        log(request)
        if (request.headers.get('authorization') === 'Bearer token-b')
          return HttpResponse.json({ data: [B_OFFICE] })
        return HttpResponse.json({
          data: [
            renamedTo ? { ...A_HOME, label: renamedTo } : A_HOME,
            A_WORK,
            ...savedRows,
          ],
        })
      }),
      http.get('/api/v1/locations/search', async ({ request }) => {
        log(request)
        await maybeHold()
        return HttpResponse.json({ data: [SPRINGFIELD] })
      }),
      http.post('/api/v1/locations/from-coordinates', async ({ request }) => {
        log(request)
        await maybeHold()
        return HttpResponse.json({ data: [CHICAGO] })
      }),
      http.post('/api/v1/locations/from-search', ({ request }) => {
        log(request)
        const saved = place('a-3', 'Springfield', false)
        savedRows.push(saved)
        return HttpResponse.json({ data: saved })
      }),
      http.patch('/api/v1/locations/:id', async ({ request }) => {
        log(request)
        const body = (await request.json()) as { label: string }
        renamedTo = body.label
        return HttpResponse.json({ data: { ...A_HOME, label: body.label } })
      }),
      http.post('/api/v1/locations/:id/primary', ({ request }) => {
        log(request)
        return HttpResponse.json({ data: { ...A_WORK, isPrimary: true } })
      }),
      http.delete('/api/v1/locations/:id', ({ request, params }) => {
        log(request)
        savedRows = savedRows.filter((row) => row.id !== params.id)
        return HttpResponse.json({ data: { deleted: true } })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    for (const observer of feedbackObservers) observer.disconnect()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    Reflect.deleteProperty(window.navigator, 'geolocation')
  })

  it('LOC-BRIDGE-WEB-01 a device position that arrives after the bridge moved asks no city lookup', async () => {
    await renderA()
    await user.click(screen.getByRole('button', { name: 'Use my location' }))
    await waitFor(() => expect(pendingPosition).not.toBeNull())

    moveBridgeToB()
    await act(async () => {
      pendingPosition!.success({
        coords: { latitude: 41.878113, longitude: -87.629799 },
      } as GeolocationPosition)
      await Promise.resolve()
    })
    await settleClient()

    expect(staleRequests()).toEqual([])
    expect(screen.queryByRole('option', { name: CHICAGO.displayLabel })).toBeNull()
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-02 a search timer A armed and that fires after the bridge moved searches nothing', async () => {
    await renderA()
    // Hold the form's debounce so the bridge can move between arming and firing.
    const held: { run: () => void; cleared: boolean }[] = []
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      delay?: number,
      ...rest: unknown[]
    ) => {
      if (delay === LOCATION_SEARCH_DEBOUNCE_MS) {
        const entry = { run: handler, cleared: false }
        held.push(entry)
        return entry as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(handler, delay, ...rest)
    }) as typeof setTimeout)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
      id?: ReturnType<typeof setTimeout>
    ) => {
      const entry = held.find((each) => (each as unknown) === id)
      if (entry) entry.cleared = true
      else realClearTimeout(id)
    }) as typeof clearTimeout)

    await user.type(searchInput(), 'Sp')
    const armed = held.filter((entry) => !entry.cleared)
    expect(armed).toHaveLength(1)

    moveBridgeToB()
    await act(async () => {
      armed[0]!.run()
      await Promise.resolve()
    })
    await settleClient()

    expect(staleRequests()).toEqual([])
    expect(screen.queryByRole('option', { name: SPRINGFIELD.displayLabel })).toBeNull()
    vi.restoreAllMocks()
    await expectCleanB()
  })

  // Codex review 12 finding 1: a request A sent before the bridge moved answers after it moved.
  it('LOC-BRIDGE-WEB-09 a city lookup A sent that answers after the bridge moved shows and says nothing', async () => {
    await renderA()
    holdNextAnswer = true
    await user.click(screen.getByRole('button', { name: 'Use my location' }))
    await waitFor(() => expect(pendingPosition).not.toBeNull())
    await act(async () => {
      pendingPosition!.success({
        coords: { latitude: 41.878113, longitude: -87.629799 },
      } as GeolocationPosition)
      await Promise.resolve()
    })
    await waitFor(() => expect(heldAnswer).not.toBeNull())
    expect(requests.at(-1)).toMatchObject({
      path: '/api/v1/locations/from-coordinates',
      bearer: 'Bearer token-a',
      afterMove: false,
    })

    moveBridgeToB()
    const feedback = recordFeedback()
    await act(async () => {
      heldAnswer!.release()
      await Promise.resolve()
    })
    await settleClient()

    // Before B's section loads: A's late Chicago is neither offered nor announced.
    expect(screen.queryByRole('option', { name: CHICAGO.displayLabel })).toBeNull()
    expect(feedback).toEqual([])
    await expectCleanB()
    expect(feedback).toEqual([])
  })

  it('LOC-BRIDGE-WEB-10 a search A sent that answers after the bridge moved shows and says nothing', async () => {
    await renderA()
    holdNextAnswer = true
    await user.type(searchInput(), 'Spring')
    await waitFor(() => expect(heldAnswer).not.toBeNull())
    expect(requests.at(-1)).toMatchObject({
      path: '/api/v1/locations/search',
      bearer: 'Bearer token-a',
      afterMove: false,
    })

    moveBridgeToB()
    const feedback = recordFeedback()
    await act(async () => {
      heldAnswer!.release()
      await Promise.resolve()
    })
    await settleClient()

    expect(screen.queryByRole('option', { name: SPRINGFIELD.displayLabel })).toBeNull()
    expect(feedback).toEqual([])
    await expectCleanB()
    expect(feedback).toEqual([])
  })

  it('LOC-BRIDGE-WEB-03 Save pressed after the bridge moved sends no save', async () => {
    await renderA()
    await user.type(searchInput(), 'Springfield')
    await user.click(
      await screen.findByRole('option', { name: SPRINGFIELD.displayLabel })
    )
    await settleClient()

    moveBridgeToB()
    await user.click(screen.getByRole('button', { name: 'Save location' }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    expect(statusRegion()).not.toHaveTextContent('Springfield saved.')
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-04 Save name pressed after the bridge moved sends no rename', async () => {
    await renderA()
    await user.click(screen.getByRole('button', { name: 'Rename, Alpha Home' }))
    const field = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(field)
    await user.type(field, 'Alpha Studio')

    moveBridgeToB()
    await user.click(screen.getByRole('button', { name: /Save name/ }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-05 Make primary pressed after the bridge moved changes nothing', async () => {
    await renderA()

    moveBridgeToB()
    await user.click(screen.getByRole('button', { name: 'Make primary, Alpha Work' }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-06 a delete confirmed after the bridge moved deletes nothing', async () => {
    await renderA()
    await user.click(screen.getByRole('button', { name: 'Delete, Alpha Work' }))
    const item = screen.getByText('Alpha Work').closest('li')!

    moveBridgeToB()
    await user.click(within(item).getByRole('button', { name: /Yes, delete/ }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    await expectCleanB()
  })

  describe('focus after a rename (finding 6)', () => {
    let labelsAtSwitch: string[] | null = null

    async function renameAlphaHome(moveOnAnnouncement: boolean) {
      labelsAtSwitch = null
      await renderA()
      await user.click(screen.getByRole('button', { name: 'Rename, Alpha Home' }))
      const field = screen.getByRole('textbox', { name: 'New name' })
      await user.clear(field)
      await user.type(field, 'Alpha Studio')
      if (moveOnAnnouncement) {
        // The section decides focus and queues its announcement in one step after the reload; the
        // bridge moves right there, before React commits and the focus is carried out.
        // Only the section's own frames reach this spy (the test waits on the real scheduler), and
        // the switch waits until the rename's reload handed Alpha Studio to the section.
        let moved = false
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
          if (!moved && tracked.lastListLabels.includes('Alpha Studio')) {
            moved = true
            labelsAtSwitch = [...tracked.lastListLabels]
            moveBridgeToB()
          }
          return realFrame(callback)
        })
      }
      await user.click(screen.getByRole('button', { name: /Save name/ }))
      await settleClient()
    }

    it('LOC-BRIDGE-WEB-07 control: with no member change, focus lands on the renamed place', async () => {
      await renameAlphaHome(false)
      expect(screen.getByText('Alpha Studio')).toHaveFocus()
      expect(statusRegion()).toHaveTextContent('Renamed to Alpha Studio.')
    })

    it('LOC-BRIDGE-WEB-08 a focus decided for A is dropped when the bridge moved before it ran', async () => {
      await renameAlphaHome(true)
      expect(bridgeMoved).toBe(true)
      // The switch came after the reload: the focus decision was made for a list with A's new name.
      expect(labelsAtSwitch).toEqual(['Alpha Studio', 'Alpha Work'])
      expect(
        requests.filter((request) => request.method === 'GET' && !request.afterMove)
      ).toHaveLength(2)
      expect(screen.queryAllByTestId('location-item-label')).not.toContainEqual(
        document.activeElement
      )
      expect(statusRegion()).not.toHaveTextContent(/Alpha/)
      vi.restoreAllMocks()
      await expectCleanB()
    })
  })

  // Codex product review 8. Each case pins one window the structural round closes.
  describe('product review 8', () => {
    // Finding 2: the successor's first commit, read before passive effects run.
    it.each([
      ['member B signs in', 'member-b' as const],
      ['A signs out', null],
    ])(
      'LOC-BRIDGE-WEB-11 when %s, the first commit for the successor shows none of A rows',
      async (_case, successor) => {
        const commits: { owner: string | null; text: string }[] = []
        renderSection((owner) =>
          commits.push({ owner, text: document.body.textContent ?? '' })
        )
        expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
        await settleClient()
        commits.length = 0

        act(() => {
          session.identity = successor
          session.stored = successor !== null
          if (successor)
            window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
          else window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
          window.dispatchEvent(new Event('couture:session'))
        })

        expect(commits[0]).toMatchObject({ owner: successor })
        expect(commits[0]!.text).not.toMatch(/Alpha/)
      }
    )

    // Finding 5: the third place fills the list and removes the form, and the save still lands.
    it('LOC-BRIDGE-WEB-12 saving a third place announces it once and focuses its row', async () => {
      await renderA()
      const feedback = recordFeedback()
      await user.type(searchInput(), 'Springfield')
      await user.click(
        await screen.findByRole('option', { name: SPRINGFIELD.displayLabel })
      )
      await user.click(screen.getByRole('button', { name: 'Save location' }))
      await settleClient()

      expect(screen.getByTestId('locations-limit')).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Search for a city' })).toBeNull()
      expect(statusRegion()).toHaveTextContent('Springfield saved.')
      expect(feedback.filter((text) => /saved\./.test(text))).toEqual([
        'Springfield saved.',
      ])
      const row = screen
        .getAllByTestId('location-item-label')
        .find((label) => label.textContent === 'Springfield')
      expect(row).toHaveFocus()
    })

    // Finding 6: the same member's token refreshes while the browser asks for consent.
    it('LOC-BRIDGE-WEB-13 a token refreshed for the same member during consent sends the fresh token', async () => {
      await renderA()
      await user.click(screen.getByRole('button', { name: 'Use my location' }))
      await waitFor(() => expect(pendingPosition).not.toBeNull())

      act(() => {
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-a2')
        window.dispatchEvent(new Event('couture:session'))
      })
      await act(async () => {
        pendingPosition!.success({
          coords: { latitude: 41.878113, longitude: -87.629799 },
        } as GeolocationPosition)
        await Promise.resolve()
      })
      await settleClient()

      expect(
        requests.filter(
          (request) => request.path === '/api/v1/locations/from-coordinates'
        )
      ).toEqual([
        {
          method: 'POST',
          path: '/api/v1/locations/from-coordinates',
          bearer: 'Bearer token-a2',
          afterMove: false,
        },
      ])
      expect(
        await screen.findByRole('option', { name: CHICAGO.displayLabel })
      ).toBeInTheDocument()
    })

    // Finding 7: the guided search's autofocus is delivered for the member who still owns it.
    describe('guided autofocus when the form mounts after a delete', () => {
      async function deleteFromFull(moveOnAnnouncement: boolean) {
        navigation.query = 'addLocation=1'
        savedRows = [place('a-3', 'Alpha Third', false)]
        renderSection()
        expect(await screen.findByText('Alpha Third')).toBeInTheDocument()
        expect(screen.getByTestId('locations-limit')).toBeInTheDocument()
        await settleClient()
        await user.click(screen.getByRole('button', { name: 'Delete, Alpha Third' }))
        let moved = false
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
          // The delete's reload has two rows: the form mounts in this commit.
          if (moveOnAnnouncement && !moved && tracked.lastListLabels.length === 2) {
            moved = true
            moveBridgeToB()
          }
          return realFrame(callback)
        })
        const item = screen.getByText('Alpha Third').closest('li')!
        await user.click(within(item).getByRole('button', { name: /Yes, delete/ }))
        await settleClient()
        vi.restoreAllMocks()
      }

      it('LOC-BRIDGE-WEB-14 control: with no member change, the form mounts and focus lands on the heading', async () => {
        await deleteFromFull(false)
        expect(
          screen.getByRole('combobox', { name: 'Search for a city' })
        ).toBeInTheDocument()
        expect(searchInput()).not.toHaveFocus()
        expect(bridgeMoved).toBe(false)
      })

      it('LOC-BRIDGE-WEB-15 a guided form mounting after the bridge moved does not take focus', async () => {
        await deleteFromFull(true)
        expect(bridgeMoved).toBe(true)
        const input = screen.queryByRole('combobox', { name: 'Search for a city' })
        expect(input === null || document.activeElement !== input).toBe(true)
        await expectCleanB()
      })
    })
  })
})
