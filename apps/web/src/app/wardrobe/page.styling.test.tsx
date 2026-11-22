// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 61: Import device-saved looks for the same member.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-61-import-device-saved-looks-for-the-same-member
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import type * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCompletedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { stylePieceStorageKey, type StylePieceRecipe } from '@couture/utils'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  createSavedLooksMswHandlers,
  type SavedLooksMswStore,
} from '../../test-utils/saved-looks-msw'
import { HomeRitual } from '../components/home-ritual'
import WardrobePage from './page'

const photoErrors = vi.hoisted(() => new Map<string, () => void>())
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof ReactJsxDevRuntime>()
  return {
    ...runtime,
    jsxDEV: ((...args) => {
      const [type, props] = args
      if (type === 'img') {
        const image = props as {
          'data-testid'?: string
          src?: string
          onError?: () => void
        }
        if (image['data-testid'] === 'style-piece-anchor' && image.src && image.onError)
          photoErrors.set(image.src, image.onError)
      }
      return runtime.jsxDEV(...args)
    }) as typeof runtime.jsxDEV,
  }
})

const session = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/wardrobe' }))

const api = 'http://wardrobe-style.test/api/v1'
const owner = 'style-member'
const garmentId = 'style-top'
const storageKey = stylePieceStorageKey(owner, garmentId)
const garment = createReadyGarmentFixture({
  id: garmentId,
  imageAccess: {
    url: 'https://photos.example.test/style-top.png',
    expiresAt: '2090-01-01T00:00:00.000Z',
  },
})
const renewed = {
  ...garment,
  imageAccess: {
    url: 'https://photos.example.test/style-top-renewed.png',
    expiresAt: '2090-01-02T00:00:00.000Z',
  },
}
const defaultRecipe = {
  lookId: 'sample:l:soft-pleats',
  weather: 'mild-dry',
  swaps: {},
} satisfies StylePieceRecipe

const inventory = vi.fn<(request: Request) => Response | Promise<Response>>()
const list = (...items: (typeof garment)[]) => HttpResponse.json({ data: items })
let savedLooksStore!: SavedLooksMswStore

function publishOwner(member: string | null) {
  act(() => {
    session.owner = member
    if (member) sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, member)
    else sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    window.dispatchEvent(new Event('couture:session'))
  })
}

function readRecipes() {
  return savedLooksStore.items
    .filter((item) => item.source === 'style_piece' && item.anchorGarmentId === garmentId)
    .map((item) => ({
      lookId: item.lookId,
      weather: item.weather,
      swaps: item.swaps,
    }))
}

async function completeRead(reply: PromiseWithResolvers<Response>, response: Response) {
  await act(async () => {
    reply.resolve(response)
    await reply.promise
  })
}

const dialogName = { name: 'Style this piece' }
const openButton = () => screen.findByRole('button', dialogName)

async function startStyling() {
  const user = userEvent.setup()
  await user.click(await openButton())
  const dialog = await screen.findByRole('dialog', dialogName)
  await within(dialog).findByRole('heading', { name: 'Look 1' })
  return { user, dialog }
}

function firstLook(dialog: HTMLElement) {
  const [look] = within(dialog).getAllByRole('article')
  if (!look) throw new Error('Expected a styled look')
  return within(look)
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', api.slice(0, -'/api/v1'.length))
  inventory.mockReset().mockImplementation(() => list(garment))
  const savedLooksMsw = createSavedLooksMswHandlers([], `${api}/wardrobe/saved-looks`)
  savedLooksStore = savedLooksMsw.store
  useMswHandlers(
    http.get(`${api}/wardrobe/garments`, ({ request }) => inventory(request)),
    ...savedLooksMsw.handlers,
    http.get(`${api}/wardrobe/onboarding`, () =>
      HttpResponse.json({ data: createCompletedOnboardingStateFixture() })
    ),
    http.get(`${api}/user/profile`, () =>
      HttpResponse.json({
        user: {
          id: owner,
          email: 'wardrobe@example.test',
          displayName: null,
          birthdate: null,
          role: 'guardian',
        },
        linkedGuardians: [],
        linkedTeens: [],
      })
    )
  )
})

afterEach(() => {
  cleanup()
  photoErrors.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  session.owner = null
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('Wardrobe styling', () => {
  it('waits for a verified owner, then checks the current wardrobe before showing their photo', async () => {
    const reply = Promise.withResolvers<Response>()
    render(<WardrobePage />)
    expect(await screen.findByText(/your session expired/i)).toBeVisible()
    expect(screen.queryByRole('button', dialogName)).toBeNull()
    expect(inventory).not.toHaveBeenCalled()

    inventory
      .mockImplementationOnce(() => list(garment))
      .mockReturnValueOnce(reply.promise)
    publishOwner(owner)
    const opener = await openButton()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', dialogName)
    expect(within(dialog).getByText('Checking your photo…')).toBeVisible()
    expect(within(dialog).queryByRole('img', { name: 'Your piece' })).toBeNull()
    const close = within(dialog).getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    await userEvent.setup().tab()
    expect(close).toHaveFocus()
    await waitFor(() => expect(inventory).toHaveBeenCalledTimes(2))
    expect(inventory.mock.lastCall?.[0].headers.get('Authorization')).toBe(
      `Bearer ${owner}`
    )

    await completeRead(reply, list(renewed))
    expect(
      await within(dialog).findAllByRole('img', { name: 'Your piece' })
    ).toHaveLength(3)
    expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
      'src',
      renewed.imageAccess.url
    )
    expect(
      within(dialog).getAllByRole('heading', { name: 'Example pieces' })
    ).toHaveLength(3)
  })

  it('edits a sample companion, saves to the account API, and restores the look, weather and focus', async () => {
    publishOwner(owner)
    render(<WardrobePage />)
    const opener = await openButton()
    const { user, dialog } = await startStyling()
    await user.click(within(dialog).getByRole('button', { name: 'Warm and rainy' }))
    const look = firstLook(dialog)
    const swap = look.getByTestId('style-piece-swap-shoes')
    expect(look.getByText('White sneakers')).toBeVisible()
    expect(look.getByText('Rain shell')).toBeVisible()
    expect(look.queryByTestId('style-piece-swap-top')).toBeNull()

    await user.click(swap)
    expect(swap).toHaveAttribute('aria-expanded', 'true')
    await user.click(look.getByRole('button', { name: 'Loafers' }))
    await waitFor(() => expect(swap).toHaveFocus())
    expect(swap).toHaveAttribute('aria-expanded', 'false')
    expect(look.getByText('Loafers')).toBeVisible()
    expect(look.getByRole('img', { name: 'Your piece' })).toHaveAttribute(
      'src',
      garment.imageAccess?.url
    )

    const rain = within(dialog).getByRole('button', { name: 'Warm and rainy' })
    await user.click(rain)
    expect(look.getByText('Loafers')).toBeVisible()
    await user.click(look.getByRole('button', { name: 'Save look' }))
    expect(
      await within(dialog).findByRole('region', { name: 'Saved on this device' })
    ).toBeVisible()
    expect(readRecipes()).toEqual([
      {
        lookId: 'sample:l:silk-midi',
        weather: 'warm-rainy',
        swaps: { shoes: 'sample:g:loafers' },
      },
    ])

    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog', dialogName)).toBeNull()
    const { dialog: reopened } = await startStyling()
    const selectedWeather = within(reopened).getByRole('button', {
      name: 'Warm and rainy',
    })
    expect(selectedWeather).toHaveAttribute('aria-pressed', 'false')
    await user.click(
      await within(reopened).findByRole('button', { name: /open saved look.*Loafers/i })
    )
    await waitFor(() => expect(selectedWeather).toHaveAttribute('aria-pressed', 'true'))
    expect(firstLook(reopened).getByText('Loafers')).toBeVisible()
    await waitFor(() =>
      expect(within(reopened).getByRole('heading', { name: 'Look 1' })).toHaveFocus()
    )

    await user.click(within(reopened).getByRole('button', { name: /remove saved look/i }))
    await waitFor(() =>
      expect(
        within(reopened).queryByRole('button', { name: /open saved look/i })
      ).toBeNull()
    )
    expect(readRecipes()).toEqual([])
    expect(selectedWeather).toHaveFocus()
  })

  it('reuses the same Idempotency-Key on retry and saves even when localStorage is blocked', async () => {
    const blockedStorage = vi
      .spyOn(window, 'localStorage', 'get')
      .mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError')
      })
    const seenKeys: string[] = []
    let failOnce = true
    savedLooksStore.onPost = (request) => {
      const key = request.headers.get('Idempotency-Key')
      if (key) seenKeys.push(key)
    }
    savedLooksStore.nextPostError = () => {
      if (!failOnce) return null
      failOnce = false
      return HttpResponse.json({ message: 'Transient error' }, { status: 503 })
    }
    try {
      publishOwner(owner)
      render(<WardrobePage />)
      const { user, dialog } = await startStyling()
      const saveButton = firstLook(dialog).getByTestId('style-piece-save')
      await user.click(saveButton)
      await waitFor(() => expect(seenKeys).toHaveLength(1))
      expect(readRecipes()).toEqual([])

      await user.click(saveButton)
      await waitFor(() => expect(readRecipes()).toEqual([defaultRecipe]))
      expect(seenKeys).toHaveLength(2)
      expect(seenKeys[0]).toBe(seenKeys[1])
    } finally {
      blockedStorage.mockRestore()
    }
  })

  it.each(['expired', 'absent'] as const)(
    'refreshes a ready card with an %s photo',
    async (reason) => {
      const stale = {
        ...garment,
        imageAccess:
          reason === 'absent'
            ? null
            : { ...renewed.imageAccess, expiresAt: '2000-01-01T00:00:00.000Z' },
      }
      const reply = Promise.withResolvers<Response>()
      inventory
        .mockImplementationOnce(() => list(stale))
        .mockReturnValueOnce(reply.promise)
      publishOwner(owner)
      render(<WardrobePage />)
      const user = userEvent.setup()
      const refresh = await screen.findByRole('button', { name: 'Refresh photo' })
      expect(screen.queryByRole('button', dialogName)).toBeNull()
      await user.click(refresh)
      expect(refresh).toBeDisabled()

      await completeRead(reply, list(renewed))
      expect(await openButton()).toBeEnabled()
      expect(screen.getByRole('img', { name: 'Uploaded garment' })).toHaveAttribute(
        'src',
        renewed.imageAccess.url
      )
    }
  )

  it('shows the unavailable alert after a failed read, then restores focus after a retry', async () => {
    inventory
      .mockImplementationOnce(() => list(garment))
      .mockImplementationOnce(() => new HttpResponse(null, { status: 503 }))
    publishOwner(owner)
    render(<WardrobePage />)
    const user = userEvent.setup()
    await user.click(await openButton())

    const dialog = await screen.findByRole('dialog', dialogName)
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Your photo is unavailable.')
    expect(alert).toHaveFocus()
    expect(within(dialog).queryByRole('button', { name: 'Save look' })).toBeNull()

    const reply = Promise.withResolvers<Response>()
    inventory.mockReturnValueOnce(reply.promise)
    const button = within(dialog).getByRole('button', { name: 'Refresh photo' })
    await user.tab()
    expect(button).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    await waitFor(() => expect(inventory).toHaveBeenCalledTimes(3))

    await completeRead(reply, list(renewed))
    const mild = await within(dialog).findByRole('button', { name: 'Mild and dry' })
    await waitFor(() => expect(mild).toHaveFocus())
    expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
      'src',
      renewed.imageAccess.url
    )
  })

  it('preserves an edited draft when an image error requires a renewed photo', async () => {
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    await user.click(within(dialog).getByRole('button', { name: 'Warm and rainy' }))
    await user.click(firstLook(dialog).getByTestId('style-piece-swap-shoes'))
    await user.click(firstLook(dialog).getByRole('button', { name: 'Loafers' }))
    fireEvent.error(firstLook(dialog).getByRole('img', { name: 'Your piece' }))
    expect(within(dialog).getByRole('alert')).toHaveFocus()
    expect(within(dialog).queryByRole('img', { name: 'Your piece' })).toBeNull()

    inventory.mockImplementation(() => list(renewed))
    await user.click(within(dialog).getByRole('button', { name: 'Refresh photo' }))
    const weather = await within(dialog).findByRole('button', { name: 'Warm and rainy' })
    await waitFor(() => expect(weather).toHaveFocus())
    expect(weather).toHaveAttribute('aria-pressed', 'true')
    expect(firstLook(dialog).getByText('Loafers')).toBeVisible()
    expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
      'src',
      renewed.imageAccess.url
    )
  })

  it('recovers the edited draft automatically when a periodic read replaces a failed URL', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    await user.click(within(dialog).getByRole('button', { name: 'Warm and rainy' }))
    await user.click(firstLook(dialog).getByTestId('style-piece-swap-shoes'))
    await user.click(firstLook(dialog).getByRole('button', { name: 'Loafers' }))
    const failedPhoto = firstLook(dialog).getByRole('img', { name: 'Your piece' })
    const onOldPhotoError = photoErrors.get(garment.imageAccess!.url)
    expect(onOldPhotoError).toBeTypeOf('function')
    fireEvent.error(failedPhoto)
    expect(within(dialog).getByRole('alert')).toBeVisible()

    // Revalidating the same signed URL leaves the retry available. The other
    // card shows the response finished before we advance to the next poll.
    const other = createReadyGarmentFixture({
      id: 'other-style-piece',
      imageAccess: null,
    })
    inventory.mockImplementationOnce(() => list(garment, other))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    await vi.waitFor(() =>
      expect(screen.getByTestId('garment-card-other-style-piece')).toBeInTheDocument()
    )
    expect(within(dialog).getByRole('alert')).toBeVisible()

    inventory.mockImplementation(() => list(renewed))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    await vi.waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull())
    const newPhoto = firstLook(dialog).getByRole('img', { name: 'Your piece' })
    expect(newPhoto).toHaveAttribute('src', renewed.imageAccess.url)
    expect(firstLook(dialog).getByText('Loafers')).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: 'Warm and rainy' })
    ).toHaveAttribute('aria-pressed', 'true')
    act(() => onOldPhotoError!())
    expect(newPhoto).toBeVisible()
    expect(within(dialog).queryByRole('alert')).toBeNull()

    const nextPhoto = {
      ...renewed.imageAccess,
      url: 'https://photos.example.test/next.png',
    }
    inventory.mockImplementation(() => list({ ...renewed, imageAccess: nextPhoto }))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    await vi.waitFor(() =>
      expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
        'src',
        nextPhoto.url
      )
    )
    expect(newPhoto).not.toBeInTheDocument()
    expect(firstLook(dialog).getByText('Loafers')).toBeVisible()

    // A late error must also leave an error from the currently mounted image intact.
    fireEvent.error(firstLook(dialog).getByRole('img', { name: 'Your piece' }))
    expect(within(dialog).getByRole('alert')).toBeVisible()
    act(() => onOldPhotoError!())
    expect(within(dialog).getByRole('alert')).toBeVisible()
  })

  it.each(['previous control', 'new focus'] as const)(
    'revalidates on tab resume and preserves %s',
    async (focus) => {
      publishOwner(owner)
      render(<WardrobePage />)
      const { user, dialog } = await startStyling()
      const previous = within(dialog).getByRole('button', { name: 'Warm and rainy' })
      await user.click(previous)
      expect(previous).toHaveFocus()
      fireEvent(window, new Event('pagehide'))
      expect(within(dialog).getByText('Checking your photo…')).toBeVisible()
      expect(within(dialog).queryByRole('img', { name: 'Your piece' })).toBeNull()
      expect(dialog.contains(document.activeElement)).toBe(true)
      const close = within(dialog).getByRole('button', { name: 'Close' })
      if (focus === 'new focus') {
        await user.tab()
        expect(close).toHaveFocus()
      }

      const visibility = vi
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('hidden')
      fireEvent(document, new Event('visibilitychange'))
      expect(inventory).toHaveBeenCalledTimes(2)

      const refresh = Promise.withResolvers<Response>()
      inventory.mockReturnValueOnce(refresh.promise)
      visibility.mockReturnValue('visible')
      fireEvent(window, new Event('pageshow'))
      fireEvent(window, new Event('focus'))
      fireEvent(document, new Event('visibilitychange'))
      await waitFor(() => expect(inventory).toHaveBeenCalledTimes(3))
      await completeRead(refresh, list(renewed))
      expect(
        await within(dialog).findByRole('button', { name: 'Warm and rainy' })
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        focus === 'new focus'
          ? close
          : within(dialog).getByRole('button', { name: 'Warm and rainy' })
      ).toHaveFocus()
      expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
        'src',
        renewed.imageAccess.url
      )
      expect(inventory).toHaveBeenCalledTimes(3)
    }
  )

  it('changes the card action when its signed photo expires in the wardrobe', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const expiring = {
      ...garment,
      imageAccess: {
        ...renewed.imageAccess,
        expiresAt: new Date(Date.now() + 15_000).toISOString(),
      },
    }
    inventory
      .mockImplementationOnce(() => list(expiring))
      .mockImplementation(() => list(renewed))
    publishOwner(owner)
    render(<WardrobePage />)
    await vi.waitFor(() => expect(screen.getByRole('button', dialogName)).toBeEnabled())
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    const refresh = screen.getByRole('button', { name: 'Refresh photo' })
    fireEvent.click(refresh)
    await vi.waitFor(() => expect(screen.getByRole('button', dialogName)).toBeEnabled())
    expect(inventory).toHaveBeenCalledTimes(2)
  })

  it('surfaces a load alert when saved looks fail to load and still allows saving once API recovers', async () => {
    let failGet = true
    savedLooksStore.nextGetError = () =>
      failGet ? HttpResponse.json({ message: 'Unavailable' }, { status: 503 }) : null
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not load your saved looks.'
    )
    const save = firstLook(dialog).getByRole('button', { name: 'Save look' })
    expect(save).toBeEnabled()

    failGet = false
    await user.click(save)
    await waitFor(() => expect(readRecipes()).toEqual([defaultRecipe]))
  })

  it('keeps the original photo and suppresses saves when the weather needs unknown protection', async () => {
    const jacket = createReadyGarmentFixture({ ...garment, category: 'outerwear' })
    inventory.mockImplementation(() => list(jacket))
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    await user.click(within(dialog).getByRole('button', { name: 'Warm and rainy' }))
    expect(within(dialog).getByText(/can handle wind or rain/i)).toBeVisible()
    expect(within(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
      'src',
      garment.imageAccess?.url
    )
    expect(within(dialog).queryByRole('button', { name: 'Save look' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Mild and dry' }))
    expect(firstLook(dialog).getByRole('button', { name: 'Save look' })).toBeEnabled()
  })

  it('drops the anchor and keeps storage untouched when the selected garment was deleted before saving', async () => {
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const remove = vi.spyOn(Storage.prototype, 'removeItem')
    inventory.mockImplementation(() => list())
    await user.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
    expect(await within(dialog).findByRole('alert')).toHaveFocus()
    expect(within(dialog).queryByRole('img', { name: 'Your piece' })).toBeNull()
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(write).not.toHaveBeenCalledWith(storageKey, expect.anything())
    expect(remove).not.toHaveBeenCalledWith(storageKey)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add Garment' })).toHaveFocus()
    )
  })

  it('waits for the wardrobe GET before posting a saved look', async () => {
    let postCalls = 0
    savedLooksStore.onPost = () => {
      postCalls += 1
    }
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    const reply = Promise.withResolvers<Response>()
    inventory.mockReturnValueOnce(reply.promise)
    try {
      await user.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
      await waitFor(() => expect(inventory).toHaveBeenCalledTimes(3))
      expect(postCalls).toBe(0)
    } finally {
      await completeRead(reply, list(renewed))
    }
    await waitFor(() => expect(readRecipes()).toEqual([defaultRecipe]))
    expect(postCalls).toBe(1)
  })

  it('aborts a stalled wardrobe GET before posting a saved look', async () => {
    let postCalls = 0
    savedLooksStore.onPost = () => {
      postCalls += 1
    }
    publishOwner(owner)
    render(<WardrobePage />)
    const { dialog } = await startStyling()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = Promise.withResolvers<Response>()
    inventory.mockReturnValueOnce(pending.promise)
    try {
      fireEvent.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
      await vi.waitFor(() => expect(inventory).toHaveBeenCalledTimes(3))
      const signal = inventory.mock.lastCall?.[0].signal
      expect(signal?.aborted).toBe(false)
      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      expect(signal?.aborted).toBe(true)
      await vi.waitFor(() =>
        expect(within(dialog).getByRole('alert')).toHaveTextContent(
          'Your photo is unavailable.'
        )
      )
      expect(postCalls).toBe(0)
      expect(readRecipes()).toEqual([])
    } finally {
      await completeRead(pending, list(renewed))
      vi.useRealTimers()
    }
  })

  it.each(['weather', 'companion'] as const)(
    'keeps a newer %s edit when an old saved-look request completes',
    async (edit) => {
      savedLooksStore.items = [
        {
          id: 'seeded-style-1',
          ownerUserId: owner,
          source: 'style_piece',
          lookId: defaultRecipe.lookId,
          weather: defaultRecipe.weather,
          title: null,
          anchorGarmentId: garmentId,
          anchorSnapshot: {
            garmentId,
            category: 'top',
            comfortRange: 'mild',
          },
          composition: [
            {
              slotIndex: 0,
              category: 'top',
              kind: 'garment',
              itemId: garmentId,
              label: null,
              missing: false,
              imageAccess: null,
            },
          ],
          swaps: defaultRecipe.swaps,
          collection: null,
          comfort: null,
          availabilityStatus: 'ready',
          missingGarmentIds: [],
          needsReviewReasons: [],
          revision: 0,
          createdAt: '2026-11-22T00:00:00.000Z',
          updatedAt: '2026-11-22T00:00:00.000Z',
        },
      ]
      publishOwner(owner)
      render(<WardrobePage />)
      const { user, dialog } = await startStyling()
      const weather = within(dialog).getByRole('button', { name: 'Warm and rainy' })
      await user.click(weather)
      const reply = Promise.withResolvers<Response>()
      inventory.mockReturnValueOnce(reply.promise)
      try {
        await user.click(
          await within(dialog).findByRole('button', { name: /open saved look/i })
        )
        await waitFor(() => expect(inventory).toHaveBeenCalledTimes(3))
        if (edit === 'weather') {
          await user.click(within(dialog).getByRole('button', { name: 'Cool and windy' }))
        } else {
          await user.click(firstLook(dialog).getByTestId('style-piece-swap-shoes'))
          await user.click(firstLook(dialog).getByRole('button', { name: 'Loafers' }))
        }
      } finally {
        await completeRead(reply, list(renewed))
      }
      await waitFor(() =>
        expect(
          screen.getByTestId('garment-card-style-top').querySelector('img')
        ).toHaveAttribute('src', renewed.imageAccess.url)
      )
      if (edit === 'weather') {
        const cool = within(dialog).getByRole('button', { name: 'Cool and windy' })
        expect(cool).toHaveAttribute('aria-pressed', 'true')
        expect(cool).toHaveFocus()
      } else {
        expect(firstLook(dialog).getByText('Loafers')).toBeVisible()
        expect(weather).toHaveAttribute('aria-pressed', 'true')
      }
    }
  )

  it.each(['account switch', 'page hide'] as const)(
    'does not post a saved look when inventory refresh settles after %s',
    async (boundary) => {
      let postCalls = 0
      savedLooksStore.onPost = () => {
        postCalls += 1
      }
      publishOwner(owner)
      render(<WardrobePage />)
      const { user, dialog } = await startStyling()
      const reply = Promise.withResolvers<Response>()
      inventory.mockReturnValueOnce(reply.promise)
      await user.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
      await waitFor(() => expect(inventory).toHaveBeenCalledTimes(3))

      if (boundary === 'account switch') {
        inventory.mockImplementation(() => list(renewed))
        publishOwner('different-owner')
        expect(screen.queryByRole('dialog', dialogName)).toBeNull()
      } else {
        fireEvent(window, new Event('pagehide'))
        expect(within(dialog).getByText('Checking your photo…')).toBeVisible()
      }
      await completeRead(reply, list(renewed))
      if (boundary === 'account switch') expect(await openButton()).toBeVisible()
      expect(postCalls).toBe(0)
      expect(readRecipes()).toEqual([])
    }
  )

  it('keeps first-use Home bookmarks separate from saves for a wardrobe garment', async () => {
    useMswHandlers(
      http.get(`${api}/ritual`, () =>
        HttpResponse.json(
          { message: 'No location preferences found for user' },
          { status: 400 }
        )
      )
    )
    publishOwner(owner)
    const home = (
      <I18nextProvider i18n={getI18n()}>
        <HomeRitual demo={null} />
      </I18nextProvider>
    )
    const user = userEvent.setup()
    const view = render(home)
    const saveExample = await screen.findByRole('button', { name: 'Save example look' })
    const homeWeather = () => screen.getByRole('combobox', { name: 'Sample weather' })
    await user.selectOptions(homeWeather(), 'warm-rainy')
    await user.click(saveExample)
    const homeSaves = () => screen.findByRole('region', { name: 'Saved on this device' })
    expect(await homeSaves()).toBeVisible()

    view.rerender(<WardrobePage />)
    const { dialog } = await startStyling()
    const save = firstLook(dialog).getByRole('button', { name: 'Save look' })
    await waitFor(() => expect(save).toBeEnabled())
    expect(within(dialog).queryByRole('button', { name: /open saved look/i })).toBeNull()
    await user.click(save)
    expect(
      await within(dialog).findByRole('button', { name: /open saved look/i })
    ).toBeVisible()
    expect(readRecipes()).toEqual([defaultRecipe])

    view.rerender(home)
    const savedOnHome = within(await homeSaves())
    await user.selectOptions(homeWeather(), 'mild-dry')
    const reopen = savedOnHome.getByRole('button', { name: /^(?!Remove )/ })
    await user.click(reopen)
    expect(homeWeather()).toHaveValue('warm-rainy')
    await user.click(savedOnHome.getByRole('button', { name: /^Remove / }))
    expect(screen.queryByRole('region', { name: 'Saved on this device' })).toBeNull()
    expect(readRecipes()).toEqual([defaultRecipe])
  })

  it('replays a committed Style this piece POST after a lost response without creating a duplicate row', async () => {
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    const seenKeys: string[] = []
    let simulateLostResponse = true
    savedLooksStore.onPost = async (request) => {
      const key = request.headers.get('Idempotency-Key')
      if (key) seenKeys.push(key)
      if (!simulateLostResponse) return
      simulateLostResponse = false
      // Commit on server before simulating a lost HTTP response to the client.
      const body = (await request.clone().json()) as {
        source: 'style_piece'
        lookId: string
        weather: string
        anchorGarmentId: string
        anchorSnapshot: {
          garmentId: string
          category: 'top'
          comfortRange: 'mild'
        }
        composition: {
          slotIndex: number
          category: 'top' | 'bottom' | 'shoes' | 'outerwear' | 'dress' | 'accessory'
          kind: 'garment' | 'catalog'
          itemId: string
          label?: string | null
        }[]
        swaps?: Record<string, string>
      }
      const now = new Date().toISOString()
      const ownerToken =
        request.headers
          .get('Authorization')
          ?.replace(/^Bearer\s+/i, '')
          .trim() || 'anonymous'
      const committed = {
        id: 'saved-look-committed-lost',
        ownerUserId: ownerToken,
        source: body.source,
        lookId: body.lookId,
        weather: body.weather,
        title: null,
        anchorGarmentId: body.anchorGarmentId,
        anchorSnapshot: body.anchorSnapshot,
        composition: body.composition.map((s) => ({
          ...s,
          label: s.label ?? null,
          missing: false,
          imageAccess: null,
        })),
        swaps: body.swaps ?? {},
        collection: null,
        comfort: null,
        availabilityStatus: 'ready' as const,
        missingGarmentIds: [],
        needsReviewReasons: [],
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }
      savedLooksStore.items = [committed]
      if (key) savedLooksStore.idempotencyKeys.set(`${ownerToken}:${key}`, committed)
      savedLooksStore.nextPostError = () => {
        savedLooksStore.nextPostError = undefined
        return HttpResponse.json({ message: 'Response dropped' }, { status: 503 })
      }
    }

    const save = firstLook(dialog).getByRole('button', { name: 'Save look' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    await waitFor(() =>
      expect(within(dialog).getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )
    expect(savedLooksStore.items).toHaveLength(1)

    await user.click(within(dialog).getByTestId('status-bar-action-retry'))
    await waitFor(() =>
      expect(within(dialog).getByTestId('status-feedback-bar')).toHaveTextContent(
        'Saved to your looks.'
      )
    )
    expect(seenKeys).toHaveLength(2)
    expect(seenKeys[0]).toBe(seenKeys[1])
    expect(savedLooksStore.items).toHaveLength(1)
  })

  it('imports pre-CC-7.2 device-saved looks for the active member on Closet load, marks unresolved looks Needs review, and preserves other members and guest storage', async () => {
    const user = userEvent.setup()
    const changedGarment = createReadyGarmentFixture({
      id: 'style-jacket-changed',
      category: 'outerwear',
      comfortRange: 'cold',
      imageAccess: {
        url: 'https://photos.example.test/style-jacket.png',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    inventory.mockImplementation(() => list(garment, changedGarment))
    savedLooksStore.unownedGarmentIds.add('tampered-other-garment')

    const guestState = JSON.stringify({ schemaVersion: 1, weather: 'mild-dry' })
    const otherOwnerKey = stylePieceStorageKey('other-member', garmentId)
    const ownValidKey = stylePieceStorageKey(owner, garmentId)
    const ownUnresolvedKey = stylePieceStorageKey(owner, changedGarment.id)
    const ownTamperedKey = stylePieceStorageKey(owner, 'tampered-other-garment')

    localStorage.setItem('couturecast.guest-preview.v1', guestState)
    localStorage.setItem(
      otherOwnerKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )
    localStorage.setItem(
      ownValidKey,
      JSON.stringify([
        {
          lookId: 'sample:l:office-oxford',
          weather: 'mild-dry',
          swaps: { shoes: 'sample:g:white-sneakers' },
        },
      ])
    )
    localStorage.setItem(
      ownUnresolvedKey,
      JSON.stringify([
        {
          lookId: 'sample:l:silk-midi',
          weather: 'warm-rainy',
          swaps: { shoes: 'sample:g:loafers' },
        },
      ])
    )
    localStorage.setItem(
      ownTamperedKey,
      JSON.stringify([
        { lookId: 'sample:l:office-oxford', weather: 'mild-dry', swaps: {} },
      ])
    )

    publishOwner(owner)
    render(<WardrobePage />)

    const row = await screen.findByTestId('closet-saved-looks-row')
    await waitFor(() => expect(row).toHaveTextContent('2 saved'))
    await user.click(row)

    expect(await screen.findByTestId('saved-look-needs-review')).toHaveTextContent(
      'Needs review'
    )
    expect(localStorage.getItem(ownValidKey)).toBeNull()
    expect(localStorage.getItem(ownUnresolvedKey)).toBeNull()
    expect(localStorage.getItem(ownTamperedKey)).toBeNull()
    expect(localStorage.getItem('couturecast.guest-preview.v1')).toBe(guestState)
    expect(localStorage.getItem(otherOwnerKey)).not.toBeNull()
  })
})
