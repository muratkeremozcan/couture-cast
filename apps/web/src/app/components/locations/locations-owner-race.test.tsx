// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
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
import { LocationsSection } from './locations-section'

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
let renamed: boolean

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
    renamed = false
    session.identity = 'member-a'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-a')
    useMswHandlers(
      http.get('/api/v1/locations', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        if (bearer === 'Bearer token-b') return HttpResponse.json({ data: [B_OFFICE] })
        if (holdNextAList) {
          holdNextAList = false
          await new Promise<void>((resolve) => {
            heldList = { release: resolve }
          })
        }
        return HttpResponse.json({ data: [renamed ? A_RENAMED : A_HOME] })
      }),
      http.patch('/api/v1/locations/:id', () => {
        renamed = true
        return HttpResponse.json({ data: A_RENAMED })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('LOC-OWNER-WEB-01 a list that lands after sign-out shows none of the signed-out member', async () => {
    await renameAndHoldTheReload()

    publish(null, null, false)
    expect(section()).toHaveAttribute('data-state', 'signed_out')

    await act(async () => {
      heldList!.release()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.queryByText(/Alpha/)).toBeNull()
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
  })

  it('LOC-OWNER-WEB-02 a list that lands after the next member loaded leaves the next member list alone', async () => {
    await renameAndHoldTheReload()

    publish(null, null, true)
    publish('member-b', 'token-b', true)
    expect(await screen.findByText('Bravo Office')).toBeInTheDocument()

    await act(async () => {
      heldList!.release()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(screen.getByText('Bravo Office')).toBeInTheDocument()
    expect(screen.queryByText(/Alpha/)).toBeNull()
    expect(screen.getByTestId('locations-status-region')).not.toHaveTextContent(/Alpha/)
  })
})
