// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 1 finding 2: only the
// first list load was tied to the member who asked for it. The list a rename starts is still in
// flight when member A signs out (or when member B signs in on the same tab); when it lands it
// must not put A's places, or A's status message, back on the screen.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedLocation } from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as WebSession from '../../../lib/web-session'
import type * as Locations from '../../../lib/locations'
import { LocationsSection } from './locations-section'

/** Every list and rename the section starts, kept until it settles, so a test waits for it. */
const lists = vi.hoisted(() => ({
  promises: [] as Promise<unknown>[],
  renames: [] as Promise<unknown>[],
}))

vi.mock('../../../lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  return {
    ...actual,
    listLocationsFromWeb: (...args: Parameters<typeof actual.listLocationsFromWeb>) => {
      const listing = actual.listLocationsFromWeb(...args)
      lists.promises.push(listing)
      return listing
    },
    renameLocationFromWeb: (...args: Parameters<typeof actual.renameLocationFromWeb>) => {
      const renaming = actual.renameLocationFromWeb(...args)
      lists.renames.push(renaming)
      return renaming
    },
  }
})

/** Every rename has settled and React has applied whatever its handlers set. */
async function settleRenames() {
  await act(async () => {
    await Promise.allSettled(lists.renames)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** Every list has settled and React has applied whatever its handlers set. */
async function settleLists() {
  await act(async () => {
    await Promise.allSettled(lists.promises)
  })
  await act(async () => {
    await Promise.resolve()
  })
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

/** The router's push, and the query the section reads (a guided entry sets returnTo). */
const navigation = vi.hoisted(() => ({ push: vi.fn(), query: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

function place(id: string, label: string, city: string): SavedLocation {
  return {
    id,
    label,
    locationKey: `${city.toLowerCase()}-key`,
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    city,
    region: 'Illinois',
    country: 'US',
    isPrimary: true,
    sortOrder: 0,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  }
}

const A_HOME = place('a-1', 'Alpha Home', 'Chicago')
const A_RENAMED = { ...A_HOME, label: 'Alpha Studio' }
const B_OFFICE = place('b-1', 'Bravo Office', 'Springfield')

/** A list answer the test releases by hand, for the list a rename starts. */
let heldList: { release: () => void } | null
let holdNextAList: boolean
/** The held A list answers 503 when released. */
let failHeldList: boolean
/** What the held A list answered once released: A's rows or the 503. */
let heldListAnswer: 'rows' | 'failed' | null
let renamed: boolean
/** A rename the test releases by hand, and every list GET's bearer. */
let heldPatch: { release: () => void } | null
let holdNextPatch: boolean
let listBearers: (string | null)[]

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <LocationsSection />
      </main>
    </I18nextProvider>
  )
}

function publish(identity: string | null, bearer: string | null, stored: boolean) {
  act(() => {
    session.identity = identity
    session.stored = stored
    if (bearer === null) window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, bearer)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/** Member A renames their place; the list reload that follows is held. */
async function renameAndHoldTheReload() {
  const user = userEvent.setup()
  renderSection()
  expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
  holdNextAList = true
  await user.click(screen.getByRole('button', { name: /Rename/ }))
  const field = screen.getByRole('textbox', { name: 'New name' })
  await user.clear(field)
  await user.type(field, 'Alpha Studio')
  await user.click(screen.getByRole('button', { name: /Save name/ }))
  await waitFor(() => expect(heldList).not.toBeNull())
}

const section = () => screen.getByTestId('locations-section')

describe('LocationsSection keeps a late list with the member who asked for it', () => {
  beforeEach(async () => {
    heldList = null
    holdNextAList = false
    failHeldList = false
    heldListAnswer = null
    lists.promises = []
    lists.renames = []
    navigation.push.mockClear()
    navigation.query = ''
    renamed = false
    heldPatch = null
    holdNextPatch = false
    listBearers = []
    session.identity = 'member-a'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-a')
    useMswHandlers(
      http.get('/api/v1/locations', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        listBearers.push(bearer)
        if (bearer === 'Bearer token-b') return HttpResponse.json({ data: [B_OFFICE] })
        if (holdNextAList) {
          holdNextAList = false
          await new Promise<void>((resolve) => {
            heldList = { release: resolve }
          })
          heldListAnswer = failHeldList ? 'failed' : 'rows'
          if (failHeldList)
            return HttpResponse.json(
              { statusCode: 503, message: 'down', error: 'Service Unavailable' },
              { status: 503 }
            )
        }
        return HttpResponse.json({ data: [renamed ? A_RENAMED : A_HOME] })
      }),
      http.get('/api/v1/locations/search', () =>
        HttpResponse.json({
          data: [
            {
              city: 'Chicago',
              region: 'Illinois',
              country: 'US',
              latitude: 41.878,
              longitude: -87.63,
              displayLabel: 'Chicago, Illinois, United States',
              candidateToken: 'chicago-payload.signature',
            },
          ],
        })
      ),
      http.post('/api/v1/locations/from-search', () => {
        renamed = true
        return HttpResponse.json({ data: A_RENAMED }, { status: 201 })
      }),
      http.patch('/api/v1/locations/:id', async () => {
        if (holdNextPatch) {
          holdNextPatch = false
          await new Promise<void>((resolve) => {
            heldPatch = { release: resolve }
          })
        }
        renamed = true
        return HttpResponse.json({ data: A_RENAMED })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  /** Member A renames their place and the confirmation is on screen. */
  async function renameAndConfirm() {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Rename/ }))
    const field = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(field)
    await user.type(field, 'Alpha Studio')
    await user.click(screen.getByRole('button', { name: /Save name/ }))
    await waitFor(() =>
      expect(screen.getByTestId('locations-status-region')).toHaveTextContent(
        'Renamed to Alpha Studio.'
      )
    )
    await settleLists()
  }

  it('LOC-OWNER-WEB-03 a confirmation already on screen leaves with the member who signs out', async () => {
    await renameAndConfirm()

    publish(null, null, false)
    await settleLists()

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
    expect(screen.queryByText(/Alpha/)).toBeNull()
  })

  it('LOC-OWNER-WEB-04 a confirmation already on screen is gone when the next member loads', async () => {
    await renameAndConfirm()

    publish(null, null, true)
    publish('member-b', 'token-b', true)
    expect(await screen.findByText('Bravo Office')).toBeInTheDocument()
    await settleLists()

    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
    expect(screen.queryByText(/Alpha/)).toBeNull()
  })

  // Codex review 3 finding 3: the rename itself (not its list) is still in flight at the switch.
  it('LOC-OWNER-WEB-05 a rename that finishes after the next member loaded starts no list and leaves their editor open', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
    holdNextPatch = true
    await user.click(screen.getByRole('button', { name: /Rename/ }))
    const field = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(field)
    await user.type(field, 'Alpha Studio')
    await user.click(screen.getByRole('button', { name: /Save name/ }))
    await waitFor(() => expect(heldPatch).not.toBeNull())

    publish(null, null, true)
    publish('member-b', 'token-b', true)
    expect(await screen.findByText('Bravo Office')).toBeInTheDocument()
    await settleLists()
    // B starts renaming their own place.
    await user.click(screen.getByRole('button', { name: /Rename/ }))
    const bField = screen.getByRole('textbox', { name: 'New name' })
    expect(bField).toHaveValue('Bravo Office')
    // B types a name they have not saved yet.
    await user.clear(bField)
    await user.type(bField, 'Bravo Draft')
    const historyBefore = [...listBearers]

    act(() => heldPatch!.release())
    // The rename settles first, then any list it would start has settled too.
    await settleRenames()
    await settleLists()

    // No list request of any kind, for either member, and B's draft is untouched.
    expect(listBearers).toEqual(historyBefore)
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveValue('Bravo Draft')
    expect(screen.queryByText(/Alpha/)).toBeNull()
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
  })

  // Codex review 5 finding 4: A leaves Profile while the rename is in flight, then B signs in.
  it('LOC-OWNER-WEB-06 a rename that settles after the section unmounted and B signed in sends no list request', async () => {
    const user = userEvent.setup()
    const view = renderSection()
    expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
    holdNextPatch = true
    await user.click(screen.getByRole('button', { name: /Rename/ }))
    const field = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(field)
    await user.type(field, 'Alpha Studio')
    await user.click(screen.getByRole('button', { name: /Save name/ }))
    await waitFor(() => expect(heldPatch).not.toBeNull())

    // A navigates away from Profile, then B signs in on the same tab.
    view.unmount()
    publish(null, null, true)
    publish('member-b', 'token-b', true)
    const historyBefore = [...listBearers]

    act(() => heldPatch!.release())
    await settleRenames()
    await settleLists()

    expect(listBearers).toEqual(historyBefore)
  })

  // Codex review 7 finding 4: the section stays mounted, the bridge has already switched the
  // session to B (identity and bearer), and A's rename settles before React has seen any event.
  it('LOC-OWNER-WEB-07 a rename that settles after the session moved to B, before the section heard, sends no list request', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
    holdNextPatch = true
    await user.click(screen.getByRole('button', { name: /Rename/ }))
    const field = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(field)
    await user.type(field, 'Alpha Studio')
    await user.click(screen.getByRole('button', { name: /Save name/ }))
    await waitFor(() => expect(heldPatch).not.toBeNull())

    // The backing session is B's now; no couture:session event has reached the section yet.
    session.identity = 'member-b'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
    const historyBefore = [...listBearers]

    act(() => heldPatch!.release())
    await settleRenames()
    await settleLists()

    expect(listBearers).toEqual(historyBefore)

    // When the event arrives, B's list loads exactly once.
    publish('member-b', 'token-b', true)
    expect(await screen.findByText('Bravo Office')).toBeInTheDocument()
    await settleLists()
    expect(listBearers).toEqual([...historyBefore, 'Bearer token-b'])
    expect(screen.queryByText(/Alpha/)).toBeNull()
  })

  // Codex product review 6 finding 2: A saves from a guided entry; the list that follows is held,
  // the bridge moves the session to B, and the list answers before the section heard the switch.
  it('LOC-OWNER-WEB-08 a post-save list answering after the session moved to B shows, announces and navigates nothing of A', async () => {
    navigation.query = 'addLocation=1&returnTo=%2F'
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
    const search = screen.getByRole('combobox', { name: 'Search for a city' })
    await user.type(search, 'Chicago')
    await user.click(await screen.findByRole('option', { name: /Chicago, Illinois/ }))
    const label = screen.getByRole('textbox', { name: 'Name this place' })
    await user.clear(label)
    await user.type(label, 'Alpha Studio')
    holdNextAList = true
    await user.click(screen.getByRole('button', { name: 'Save location' }))
    await waitFor(() => expect(heldList).not.toBeNull())

    // The backing session is B's; the section has not heard yet.
    session.identity = 'member-b'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
    act(() => heldList!.release())
    await settleLists()
    expect(heldListAnswer).toBe('rows')
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    expect(screen.queryByText('Alpha Studio')).toBeNull()
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
    expect(navigation.push).not.toHaveBeenCalled()
  })

  // Codex review 9 finding 3: the same ordering as WEB-08, with A's post-save list failing.
  it('LOC-OWNER-WEB-09 a post-save list failing after the session moved to B leaves no error behind, and B loads', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
    await user.type(
      screen.getByRole('combobox', { name: 'Search for a city' }),
      'Chicago'
    )
    await user.click(await screen.findByRole('option', { name: /Chicago, Illinois/ }))
    const label = screen.getByRole('textbox', { name: 'Name this place' })
    await user.clear(label)
    await user.type(label, 'Alpha Studio')
    holdNextAList = true
    failHeldList = true
    await user.click(screen.getByRole('button', { name: 'Save location' }))
    await waitFor(() => expect(heldList).not.toBeNull())

    session.identity = 'member-b'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
    act(() => heldList!.release())
    await settleLists()
    expect(heldListAnswer).toBe('failed')

    expect(section()).not.toHaveAttribute('data-state', 'load_failed')
    expect(screen.queryByTestId('locations-load-error')).toBeNull()

    publish('member-b', 'token-b', true)
    expect(await screen.findByText('Bravo Office')).toBeInTheDocument()
    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(screen.queryByTestId('locations-load-error')).toBeNull()
    expect(screen.queryByText(/Alpha/)).toBeNull()
  })

  it('LOC-OWNER-WEB-01 a list that lands after sign-out shows none of the signed-out member', async () => {
    await renameAndHoldTheReload()

    publish(null, null, false)
    expect(section()).toHaveAttribute('data-state', 'signed_out')

    act(() => heldList!.release())
    await settleLists()
    // The late answer carried A's rows (a 503 here would test nothing about disclosure).
    expect(heldListAnswer).toBe('rows')

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.queryByText(/Alpha/)).toBeNull()
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
  })

  it('LOC-OWNER-WEB-02 a list that lands after the next member loaded leaves the next member list alone', async () => {
    await renameAndHoldTheReload()

    publish(null, null, true)
    publish('member-b', 'token-b', true)
    expect(await screen.findByText('Bravo Office')).toBeInTheDocument()

    act(() => heldList!.release())
    await settleLists()
    expect(heldListAnswer).toBe('rows')

    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(screen.getByText('Bravo Office')).toBeInTheDocument()
    expect(screen.queryByText(/Alpha/)).toBeNull()
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
  })
})
