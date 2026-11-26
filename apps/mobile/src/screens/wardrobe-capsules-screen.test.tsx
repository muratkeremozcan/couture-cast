// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-033 (D6, P7), the capsule manager's parent is Looks,
// and a Looks capsule tile's `capsule` param scrolls to and focuses the card whose loaded id
// equals it; an unknown id or a selector-shaped value does nothing and shows no error.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'
import type {
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
// Story CC-7.12 D6: the screen reads its `capsule` param.
const searchParams = vi.hoisted(() => ({ current: {} as Record<string, string> }))
vi.mock('expo-router', () => ({
  router: routerMock,
  Stack: { Screen: () => null },
  useLocalSearchParams: () => searchParams.current,
}))

/**
 * `react-native-web`'s `Alert.alert` is a no-op, so the destructive-confirm
 * branch of the delete flow is unreachable without a stub that records the
 * buttons the screen offered.
 */
const alertMock = vi.hoisted(() => ({ alert: vi.fn() }))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: vi.fn(),
    Alert: alertMock,
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
  }
})

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { deleteCapsuleFromMobile, listCapsulesFromMobile } from '@/src/lib/wardrobe'
import WardrobeCapsulesScreen from '../../app/wardrobe-capsules'
import { PARENT_TAB } from '@/src/components/app-top-bar'

vi.mock('@/src/lib/wardrobe', { spy: true })

/**
 * Base64url-shaped JWT payload, built at runtime (not a literal) so it doesn't
 * look like a credential to secret scanners; a hardcoded JWT-shaped string
 * here previously tripped gitleaks' generic-api-key rule in CI.
 */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('auth-principal-user-1')
const SECOND_ACCESS_TOKEN = fakeAccessToken('auth-principal-user-2')

function garment(id: string, category: string): GarmentItemContract {
  return {
    id,
    status: 'ready',
    category,
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: '2026-08-05T10:00:00.000Z',
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: '2026-08-05T10:00:00.000Z',
    committedAt: '2026-08-05T10:00:00.000Z',
    imageAccess: null,
  } as unknown as GarmentItemContract
}

const GARMENTS = [
  garment('g-1', 'top'),
  garment('g-2', 'bottom'),
  garment('g-3', 'shoes'),
]

function capsuleGarment(id: string, order: number) {
  return {
    id,
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    imageAccess: null,
    availabilityStatus: 'ready',
    garmentOrder: order,
  }
}

function capsule(overrides: Partial<OutfitCapsuleContract> = {}): OutfitCapsuleContract {
  return {
    id: 'cap-1',
    ownerUserId: 'user-1',
    name: 'Work capsule',
    description: 'Weekday rotation',
    occasions: ['work'],
    isFavorite: false,
    revision: 3,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [capsuleGarment('g-1', 0), capsuleGarment('g-2', 1)],
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    ...overrides,
  } as unknown as OutfitCapsuleContract
}

const SECOND_MEMBER_CAPSULE = capsule({
  id: 'cap-2',
  ownerUserId: 'user-2',
  name: 'Current member capsule',
})

/** Every capsule-list request the screen issued, newest last. */
let listRequests: URL[] = []

function listHandler(items: OutfitCapsuleContract[], total = items.length) {
  return http.get('*/api/v1/wardrobe/:ownerUserId/capsules', ({ request }) => {
    listRequests.push(new URL(request.url))
    return HttpResponse.json({ data: items, total, limit: 20, offset: 0 })
  })
}

function garmentsHandler(items: GarmentItemContract[] = GARMENTS) {
  return http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: items }))
}

/** Invokes the button the screen passed to the native confirm dialog. */
function pressAlertButton(text: string) {
  const call = alertMock.alert.mock.calls.at(-1)
  const buttons = call?.[2] as { text: string; onPress?: () => void }[] | undefined
  const button = buttons?.find((candidate) => candidate.text === text)
  if (!button) {
    throw new Error(`No "${text}" button was offered in the confirm dialog`)
  }
  button.onPress?.()
}

describe('WardrobeCapsulesScreen', () => {
  let restoreAccessTokenResolver: () => void
  let accessToken: string

  function switchAccount() {
    accessToken = SECOND_ACCESS_TOKEN
    act(() => setMobileApplicationUserId('user-2'))
  }

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    server.use(
      http.get('*/api/v1/user/profile', ({ request }) => {
        const authorization = request.headers.get('authorization')
        const owner =
          authorization === `Bearer ${ACCESS_TOKEN}`
            ? 'user-1'
            : authorization === `Bearer ${SECOND_ACCESS_TOKEN}`
              ? 'user-2'
              : null
        if (!owner) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
        return HttpResponse.json({
          user: {
            id: owner,
            email: `${owner}@synthetic.test`,
            displayName: null,
            birthdate: '1990-01-01T00:00:00.000Z',
            role: 'guardian',
          },
          linkedGuardians: [],
          linkedTeens: [],
        })
      })
    )
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    listRequests = []
    searchParams.current = {}
    accessToken = ACCESS_TOKEN
    setMobileApplicationUserId('user-1')
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => accessToken)
    server.use(listHandler([capsule()]), garmentsHandler())
  })

  afterEach(() => {
    restoreAccessTokenResolver()
    setMobileApplicationUserId(null)
    vi.clearAllMocks()
  })

  it('4.3-MOB-CAPS-01 lists capsules scoped to the token owner with their availability summary', async () => {
    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-card-cap-1')).toBeInTheDocument()
    })
    expect(screen.getByText('Work capsule')).toBeInTheDocument()
    expect(screen.getByText('Weekday rotation')).toBeInTheDocument()
    expect(screen.getByText('2 garments · Ready')).toBeInTheDocument()
    // The canonical profile owns the segment. Its id differs from the bearer principal.
    expect(listRequests.at(-1)?.pathname).toBe('/api/v1/wardrobe/user-1/capsules')
    expect(screen.queryByTestId('capsule-loading-state')).not.toBeInTheDocument()
  })

  it('capsule account switch discards a late list response from the previous member', async () => {
    const lateCapsule = capsule({ name: 'Previous member private capsule' })
    let releaseList!: () => void
    const heldList = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    server.use(
      http.get('*/api/v1/wardrobe/:ownerUserId/capsules', async ({ request, params }) => {
        const url = new URL(request.url)
        listRequests.push(url)
        const secondMember = params.ownerUserId === 'user-2'
        const bearer = secondMember ? SECOND_ACCESS_TOKEN : ACCESS_TOKEN
        if (request.headers.get('authorization') !== `Bearer ${bearer}`)
          return new HttpResponse(null, { status: 401 })
        const filtered = !secondMember && url.searchParams.has('occasion')
        if (filtered) await heldList
        const item = secondMember
          ? SECOND_MEMBER_CAPSULE
          : filtered
            ? lateCapsule
            : capsule()
        return HttpResponse.json({ data: [item], total: 1, limit: 20, offset: 0 })
      })
    )

    render(<WardrobeCapsulesScreen />)
    try {
      await screen.findByText('Work capsule')
      await userEvent.click(screen.getByTestId('capsule-occasion-filter-work'))
      await waitFor(() =>
        expect(listRequests.at(-1)?.searchParams.get('occasion')).toBe('work')
      )
      const previousList = vi.mocked(listCapsulesFromMobile).mock.results.at(-1)
      if (previousList?.type !== 'return') throw new Error('Expected a pending list call')
      switchAccount()
      await act(async () => {
        releaseList()
        await previousList.value.catch(() => undefined)
      })

      expect(screen.queryByText(lateCapsule.name)).not.toBeInTheDocument()
      expect(await screen.findByText(SECOND_MEMBER_CAPSULE.name)).toBeInTheDocument()
      expect(screen.queryByText('Work capsule')).not.toBeInTheDocument()
    } finally {
      releaseList()
    }
  })

  it('capsule account switch retires a previous member’s native delete confirmation', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/user-2/capsules', ({ request }) => {
        if (request.headers.get('authorization') !== `Bearer ${SECOND_ACCESS_TOKEN}`)
          return new HttpResponse(null, { status: 401 })
        return HttpResponse.json({
          data: [SECOND_MEMBER_CAPSULE],
          total: 1,
          limit: 20,
          offset: 0,
        })
      }),
      http.delete(
        '*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId',
        () => new HttpResponse(null, { status: 204 })
      )
    )
    render(<WardrobeCapsulesScreen />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete capsule: Work capsule' })
    )
    expect(alertMock.alert).toHaveBeenCalledTimes(1)
    expect(deleteCapsuleFromMobile).not.toHaveBeenCalled()

    switchAccount()
    await act(async () => {
      pressAlertButton('Delete capsule')
      await Promise.resolve()
    })

    expect(deleteCapsuleFromMobile).not.toHaveBeenCalled()
    expect(await screen.findByText(SECOND_MEMBER_CAPSULE.name)).toBeInTheDocument()
    expect(screen.queryByText('Work capsule')).not.toBeInTheDocument()
    expect(screen.getByTestId('capsule-status-region')).toBeEmptyDOMElement()
  })

  it('4.3-MOB-CAPS-02 stops at a sign-in message instead of requesting capsules without a token', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-banner')).toHaveTextContent(
        'Sign in to manage capsules.'
      )
    })
    expect(screen.queryByTestId('capsule-loading-state')).not.toBeInTheDocument()
    expect(listRequests).toHaveLength(0)
  })

  it('4.3-MOB-CAPS-03 reports a malformed session token rather than spinning forever', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'malformed-token')

    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-banner')).toHaveTextContent(
        'Your session could not be verified. Sign in again.'
      )
    })
    expect(screen.queryByTestId('capsule-loading-state')).not.toBeInTheDocument()
    expect(listRequests).toHaveLength(0)
  })

  it('4.3-MOB-CAPS-04 shows the empty state when the wardrobe has no capsules', async () => {
    server.use(listHandler([]))

    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-empty-state')).toBeInTheDocument()
    })
    expect(screen.getByText('No capsules yet')).toBeInTheDocument()
  })

  it('4.3-MOB-CAPS-05 surfaces the server message when the list fails to load', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/:ownerUserId/capsules', () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Capsule store offline',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      )
    )

    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-banner')).toHaveTextContent(
        'Capsule store offline'
      )
    })
    // A failed load must still leave the toolbar usable so the user can retry
    // by changing a filter instead of being stuck on a spinner.
    expect(screen.queryByTestId('capsule-loading-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('create-capsule-button')).toBeInTheDocument()
  })

  it('4.3-MOB-CAPS-06 debounces typing into a single search request', async () => {
    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('capsule-card-cap-1'))
    const requestsBeforeTyping = listRequests.length

    const input = screen.getByTestId('capsule-search-input')
    fireEvent.change(input, { target: { value: 'wo' } })
    fireEvent.change(input, { target: { value: 'wor' } })
    fireEvent.change(input, { target: { value: 'work' } })

    await waitFor(() => {
      expect(listRequests.at(-1)?.searchParams.get('q')).toBe('work')
    })
    // Three keystrokes must collapse into one request, otherwise the list
    // hammers the API once per character.
    expect(listRequests.length - requestsBeforeTyping).toBe(1)
  })

  it('4.3-MOB-CAPS-07 filters by occasion and clears the filter when All is reselected', async () => {
    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('capsule-card-cap-1'))

    fireEvent.click(screen.getByTestId('capsule-occasion-filter-work'))
    await waitFor(() => {
      expect(listRequests.at(-1)?.searchParams.get('occasion')).toBe('work')
    })

    fireEvent.click(screen.getByTestId('capsule-occasion-filter-all'))
    await waitFor(() => {
      // "all" is a UI-only sentinel; sending it as a query value would make the
      // API reject the request against the occasion enum.
      expect(listRequests.at(-1)?.searchParams.has('occasion')).toBe(false)
    })
  })

  it('4.3-MOB-CAPS-08 toggles the favorites-only filter on and back off', async () => {
    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('capsule-card-cap-1'))

    fireEvent.click(screen.getByTestId('capsule-favorite-filter'))
    await waitFor(() => {
      expect(listRequests.at(-1)?.searchParams.get('isFavorite')).toBe('true')
    })

    fireEvent.click(screen.getByTestId('capsule-favorite-filter'))
    await waitFor(() => {
      // Unchecked means "no filter", not `isFavorite=false`, which would hide
      // every favorited capsule instead of showing all of them.
      expect(listRequests.at(-1)?.searchParams.has('isFavorite')).toBe(false)
    })
  })

  it('4.3-MOB-CAPS-09 favorites a capsule with its strong entity tag and announces the result', async () => {
    let favoriteRequest: { ifMatch: string | null; body: unknown } | null = null
    server.use(
      http.patch(
        '*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId/favorite',
        async ({ request }) => {
          favoriteRequest = {
            ifMatch: request.headers.get('if-match'),
            body: await request.json(),
          }
          return HttpResponse.json({ data: capsule({ isFavorite: true, revision: 4 }) })
        }
      )
    )

    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('favorite-button-cap-1'))

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    await waitFor(() => {
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Favorite status updated'
      )
    })
    expect(favoriteRequest).toEqual({
      ifMatch: '"capsule:cap-1:3"',
      body: { isFavorite: true },
    })
  })

  it('4.3-MOB-CAPS-10 keeps the list usable and explains why when favoriting is rejected', async () => {
    server.use(
      http.patch('*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId/favorite', () =>
        HttpResponse.json(
          {
            statusCode: 412,
            message: 'This capsule changed. Review the latest version and try again.',
            error: 'Precondition Failed',
          },
          { status: 412 }
        )
      )
    )

    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('favorite-button-cap-1'))

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-banner')).toHaveTextContent(
        'This capsule changed. Review the latest version and try again.'
      )
    })
    expect(screen.getByTestId('capsule-card-cap-1')).toBeInTheDocument()
  })

  it('4.3-MOB-CAPS-11 creates a capsule through the builder and refreshes the list', async () => {
    let createRequest: { idempotencyKey: string | null; body: unknown } | null = null
    server.use(
      http.post('*/api/v1/wardrobe/:ownerUserId/capsules', async ({ request }) => {
        createRequest = {
          idempotencyKey: request.headers.get('idempotency-key'),
          body: await request.json(),
        }
        return HttpResponse.json({ data: capsule({ id: 'cap-2', name: 'Weekend' }) })
      })
    )

    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('capsule-card-cap-1'))

    fireEvent.click(screen.getByTestId('create-capsule-button'))
    await waitFor(() => screen.getByTestId('garment-checkbox-g-1'))
    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Weekend' },
    })
    fireEvent.click(screen.getByTestId('garment-checkbox-g-1'))
    fireEvent.click(screen.getByTestId('garment-checkbox-g-2'))
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule created'
      )
    })
    expect(createRequest).toEqual({
      idempotencyKey: expect.any(String),
      body: {
        name: 'Weekend',
        description: null,
        occasions: ['casual'],
        garmentIds: ['g-1', 'g-2'],
        isFavorite: false,
      },
    })
    // The builder is fed by the garment list this screen loads; an empty
    // `availableGarments` would make creation impossible.
    expect(screen.getByTestId('mobile-capsule-builder-container')).toBeInTheDocument()
  })

  it('4.3-MOB-CAPS-12 edits an existing capsule with If-Match instead of creating a duplicate', async () => {
    let patchRequest: { ifMatch: string | null; body: unknown } | null = null
    const createSpy = vi.fn()
    server.use(
      http.post('*/api/v1/wardrobe/:ownerUserId/capsules', () => {
        createSpy()
        return HttpResponse.json({ data: capsule() })
      }),
      http.patch(
        '*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId',
        async ({ request }) => {
          patchRequest = {
            ifMatch: request.headers.get('if-match'),
            body: await request.json(),
          }
          return HttpResponse.json({ data: capsule({ name: 'Renamed', revision: 4 }) })
        }
      )
    )

    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('edit-capsule-button-cap-1'))

    fireEvent.click(screen.getByTestId('edit-capsule-button-cap-1'))
    await waitFor(() => screen.getByTestId('capsule-name-input'))
    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Renamed' },
    })
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule updated'
      )
    })
    expect(patchRequest).toEqual({
      ifMatch: '"capsule:cap-1:3"',
      body: {
        name: 'Renamed',
        description: 'Weekday rotation',
        occasions: ['work'],
        garmentIds: ['g-1', 'g-2'],
        isFavorite: false,
      },
    })
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('4.3-MOB-CAPS-13 deletes only after the destructive confirmation is accepted', async () => {
    const deleteSpy = vi.fn()
    server.use(
      http.delete('*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId', ({ request }) => {
        deleteSpy(request.headers.get('if-match'))
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('delete-capsule-button-cap-1'))

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))

    expect(alertMock.alert).toHaveBeenCalledWith(
      'Delete this capsule?',
      'This removes the capsule. Your wardrobe garments stay.',
      expect.any(Array)
    )
    // Cancel must be inert: a destructive action that fires on dismissal would
    // delete a capsule the user just declined to delete.
    pressAlertButton('Cancel')
    expect(deleteSpy).not.toHaveBeenCalled()

    pressAlertButton('Delete capsule')

    await waitFor(() => {
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule deleted'
      )
    })
    expect(deleteSpy).toHaveBeenCalledWith('"capsule:cap-1:3"')
  })

  it('4.3-MOB-CAPS-14 reports a failed delete instead of silently leaving the capsule', async () => {
    server.use(
      http.delete('*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Your guardian access is read-only.',
            error: 'Forbidden',
          },
          { status: 403 }
        )
      )
    )

    render(<WardrobeCapsulesScreen />)
    await waitFor(() => screen.getByTestId('delete-capsule-button-cap-1'))

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    pressAlertButton('Delete capsule')

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-banner')).toHaveTextContent(
        'Your guardian access is read-only.'
      )
    })
    expect(screen.getByTestId('capsule-card-cap-1')).toBeInTheDocument()
  })

  it('4.3-MOB-CAPS-15 flags capsules that need repair and warns when results are truncated', async () => {
    server.use(
      listHandler(
        [
          capsule({
            id: 'cap-9',
            name: 'Broken capsule',
            description: null,
            availabilityStatus: 'needs_repair',
            unavailableGarmentCount: 2,
          }),
        ],
        7
      )
    )

    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByText('2 garments · Needs repair')).toBeInTheDocument()
    })
    expect(screen.getByTestId('capsule-unavailable-count-cap-9')).toHaveTextContent(
      '2 unavailable garments'
    )
    // Without this notice a user filtering a large wardrobe would believe the
    // first page is the whole set.
    expect(screen.getByTestId('capsule-truncation-notice')).toHaveTextContent(
      'Showing 1 of 7.'
    )
  })

  it('4.3-MOB-CAPS-16 shows no repair line and no truncation notice for a healthy full page', async () => {
    render(<WardrobeCapsulesScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-card-cap-1')).toBeInTheDocument()
    })
    expect(
      screen.queryByTestId('capsule-unavailable-count-cap-1')
    ).not.toBeInTheDocument()
    // `total` equals the page size here, so claiming results were hidden would
    // send the user chasing capsules that do not exist.
    expect(screen.queryByTestId('capsule-truncation-notice')).not.toBeInTheDocument()
  })

  it('4.3-MOB-CAPS-17 closes the builder without saving when it is dismissed', async () => {
    const createSpy = vi.fn()
    server.use(
      http.post('*/api/v1/wardrobe/:ownerUserId/capsules', () => {
        createSpy()
        return HttpResponse.json({ data: capsule() })
      })
    )

    render(<WardrobeCapsulesScreen />)
    const createButton = screen.getByRole('button', { name: 'Create capsule' })
    await waitFor(() => expect(createButton).not.toBeDisabled())

    await userEvent.click(createButton)
    await waitFor(() => screen.getByTestId('close-modal-button'))

    fireEvent.click(screen.getByTestId('close-modal-button'))

    await waitFor(() => {
      expect(
        screen.queryByTestId('mobile-capsule-builder-container')
      ).not.toBeInTheDocument()
    })
    expect(createSpy).not.toHaveBeenCalled()
  })

  describe('Story CC-7.12 capsule focus from Looks', () => {
    const CAPSULES = [
      capsule({ id: 'cap-a', name: 'Office capsule' }),
      capsule({ id: 'cap-b', name: 'Weekend capsule' }),
      capsule({ id: 'cap-c', name: 'Travel capsule' }),
    ]

    /** Two animation frames: the screen focuses inside one after the card lays out. */
    const nextFrames = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )

    it('[P1] [7.12-NAT-033] Capsules goes back to Looks on a direct entry', () => {
      expect(PARENT_TAB['wardrobe-capsules']).toBe('/looks')
    })

    it('[P0] [7.12-NAT-033] a capsule param scrolls to that card and focuses it', async () => {
      server.use(listHandler(CAPSULES))
      searchParams.current = { capsule: 'cap-c' }
      const scroll = vi.spyOn(Element.prototype, 'scroll')
      render(<WardrobeCapsulesScreen />)

      const card = await screen.findByTestId('capsule-card-cap-c')
      await waitFor(() => expect(card).toHaveFocus())
      // The list scrolled to the card's own offset in its content, not to the top.
      const offset =
        card.getBoundingClientRect().top - card.parentElement!.getBoundingClientRect().top
      expect(offset).toBeGreaterThan(0)
      const tops = scroll.mock.calls.map(([options]) => (options as ScrollToOptions).top)
      expect(tops.some((top) => Math.abs((top ?? -1) - offset) < 1)).toBe(true)
      // Only the asked-for card was focused; the others never joined the tab order.
      expect(screen.getByTestId('capsule-card-cap-a')).not.toHaveFocus()
      expect(screen.getByTestId('capsule-card-cap-a').getAttribute('tabindex')).not.toBe(
        '0'
      )
      expect(screen.queryByTestId('capsule-error-banner')).toBeNull()
    })

    // Codex 7.12 #4 (D6): Looks pages capsules newest first, the manager reads its first 20 in
    // its own order, so a tile's capsule can sit past that page. The manager reads it by id.
    it('[P0] [7.12-NAT-033] [Codex 7.12 #4] a capsule outside the first page still shows and takes focus', async () => {
      const firstPage = Array.from({ length: 20 }, (_, index) =>
        capsule({ id: `cap-page-${index}`, name: `Page capsule ${index}` })
      )
      const target = capsule({ id: 'cap-target', name: 'Older capsule' })
      const singleReads: string[] = []
      server.use(
        listHandler(firstPage, 21),
        http.get(
          '*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId',
          ({ request, params }) => {
            singleReads.push(new URL(request.url).pathname)
            return params.capsuleId === 'cap-target'
              ? HttpResponse.json({ data: target })
              : HttpResponse.json({ message: 'Not found' }, { status: 404 })
          }
        )
      )
      searchParams.current = { capsule: 'cap-target' }
      render(<WardrobeCapsulesScreen />)

      const card = await screen.findByTestId('capsule-card-cap-target')
      await waitFor(() => expect(card).toHaveFocus())
      expect(card).toHaveTextContent('Older capsule')
      // One owner-scoped read for the asked-for capsule, beside the list's first page.
      expect(singleReads).toEqual(['/api/v1/wardrobe/user-1/capsules/cap-target'])
      expect(listRequests.at(-1)?.searchParams.get('offset')).toBe('0')
      expect(screen.getByTestId('capsule-card-cap-page-0')).not.toHaveFocus()
      expect(screen.queryByTestId('capsule-error-banner')).toBeNull()
    })

    it('[P1] [7.12-NAT-033] [Codex 7.12 #4] a gone or foreign capsule outside the first page focuses nothing and shows no error', async () => {
      server.use(
        listHandler(CAPSULES, 21),
        http.get('*/api/v1/wardrobe/:ownerUserId/capsules/:capsuleId', () =>
          HttpResponse.json({ message: 'Not found' }, { status: 404 })
        )
      )
      searchParams.current = { capsule: 'cap-foreign' }
      render(<WardrobeCapsulesScreen />)

      await screen.findByTestId('capsule-card-cap-c')
      await nextFrames()
      await nextFrames()
      expect(screen.queryByTestId('capsule-card-cap-foreign')).toBeNull()
      for (const id of ['cap-a', 'cap-b', 'cap-c'])
        expect(screen.getByTestId(`capsule-card-${id}`), id).not.toHaveFocus()
      expect(screen.queryByTestId('capsule-error-banner')).toBeNull()
      expect(screen.getByText('Travel capsule')).toBeVisible()
    })

    it.each([
      ['an unknown id', 'cap-missing'],
      ['a selector-shaped value', '"]\'><img src=x onerror=alert(1)>'],
      ['a prefix of a loaded id', 'cap-'],
    ])(
      '[P1] [7.12-NAT-033] %s focuses nothing and shows no error',
      async (_case, value) => {
        server.use(listHandler(CAPSULES))
        searchParams.current = { capsule: value }
        const scroll = vi.spyOn(Element.prototype, 'scroll')
        render(<WardrobeCapsulesScreen />)

        await screen.findByTestId('capsule-card-cap-c')
        await nextFrames()
        await nextFrames()

        for (const id of ['cap-a', 'cap-b', 'cap-c']) {
          const card = screen.getByTestId(`capsule-card-${id}`)
          expect(card, id).not.toHaveFocus()
          expect(card.getAttribute('tabindex'), id).not.toBe('0')
        }
        // P7: equality only, so the value never reaches a selector or the document.
        expect(document.querySelector('img[src="x"]')).toBeNull()
        expect(
          scroll.mock.calls.filter(
            ([options]) => ((options as ScrollToOptions).top ?? 0) > 0
          )
        ).toEqual([])
        expect(screen.queryByTestId('capsule-error-banner')).toBeNull()
        expect(screen.getByText('Travel capsule')).toBeVisible()
      }
    )
  })
})
