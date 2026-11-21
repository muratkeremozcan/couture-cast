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
import { HomeRitual } from '../components/home-ritual'
import WardrobePage from './page'

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
const otherRecipe = {
  lookId: 'sample:l:office-oxford',
  weather: 'mild-dry',
  swaps: {},
} satisfies StylePieceRecipe

const inventory = vi.fn<(request: Request) => Response | Promise<Response>>()
const list = (...items: (typeof garment)[]) => HttpResponse.json({ data: items })
const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
type RequestLock = (key: string, apply: () => Promise<boolean>) => Promise<boolean>

function setLocks(request?: RequestLock) {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: request ? { request } : undefined,
  })
}

function publishOwner(member: string | null) {
  act(() => {
    session.owner = member
    if (member) sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, member)
    else sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    window.dispatchEvent(new Event('couture:session'))
  })
}

function readRecipes() {
  return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
}

async function completeRead(reply: PromiseWithResolvers<Response>, response: Response) {
  await act(async () => {
    reply.resolve(response)
    await reply.promise
  })
}

function storageEvent(key: string | null) {
  fireEvent(window, new StorageEvent('storage', { key, storageArea: localStorage }))
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
  setLocks()
  useMswHandlers(
    http.get(`${api}/wardrobe/garments`, ({ request }) => inventory(request)),
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  session.owner = null
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllEnvs()
  if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor)
  else Reflect.deleteProperty(navigator, 'locks')
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

  it('edits a sample companion, saves through Web Locks, and restores the look, weather and focus', async () => {
    const requestLock = vi.fn<RequestLock>((_key, apply) => apply())
    setLocks(requestLock)
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
    expect(requestLock).toHaveBeenCalledExactlyOnceWith(storageKey, expect.any(Function))
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
    expect(requestLock).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(selectedWeather).toHaveFocus()
  })

  it.each(['missing', 'rejected'] as const)(
    'merges the latest recipes and syncs storage events when Web Locks is %s',
    async (mode) => {
      const requestLock = vi
        .fn<RequestLock>()
        .mockRejectedValue(new Error('Lock unavailable'))
      if (mode === 'rejected') setLocks(requestLock)
      publishOwner(owner)
      render(<WardrobePage />)
      const { user, dialog } = await startStyling()

      // Another tab changed disk after hydration. The in-memory list is still empty.
      localStorage.setItem(storageKey, JSON.stringify([otherRecipe]))
      storageEvent('other-owner')
      expect(
        within(dialog).queryByRole('button', { name: /open saved look/i })
      ).toBeNull()
      await user.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
      await waitFor(() => expect(readRecipes()).toEqual([defaultRecipe, otherRecipe]))
      expect(
        within(dialog).getAllByRole('button', { name: /open saved look/i })
      ).toHaveLength(2)

      await user.click(
        within(dialog).getByRole('button', { name: /open saved look.*Dark jeans/i })
      )
      await waitFor(() => expect(firstLook(dialog).getByText('Dark jeans')).toBeVisible())
      await user.click(
        within(dialog).getByRole('button', { name: /remove saved look.*Dark jeans/i })
      )
      await waitFor(() => expect(readRecipes()).toEqual([defaultRecipe]))
      expect(requestLock).toHaveBeenCalledTimes(mode === 'rejected' ? 2 : 0)

      localStorage.setItem(storageKey, JSON.stringify([otherRecipe]))
      storageEvent(storageKey)
      expect(
        within(dialog).getByRole('button', { name: /open saved look.*Dark jeans/i })
      ).toBeVisible()
      localStorage.clear()
      storageEvent(null)
      expect(
        within(dialog).queryByRole('button', { name: /open saved look/i })
      ).toBeNull()
    }
  )

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
    fireEvent.error(failedPhoto)
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
    fireEvent.error(newPhoto)
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(firstLook(dialog).getByText('Loafers')).toBeVisible()
  })

  it('revalidates after the tab resumes and coalesces focus and visibility reads', async () => {
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    await user.click(within(dialog).getByRole('button', { name: 'Warm and rainy' }))
    fireEvent(window, new Event('pagehide'))
    expect(within(dialog).getByText('Checking your photo…')).toBeVisible()
    expect(within(dialog).queryByRole('img', { name: 'Your piece' })).toBeNull()

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
    expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
      'src',
      renewed.imageAccess.url
    )
    expect(inventory).toHaveBeenCalledTimes(3)
  })

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

  it('recovers recipe reads after storage denial and reports a failed write', async () => {
    localStorage.setItem(storageKey, JSON.stringify([otherRecipe]))
    const unavailable = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('Storage denied')
    })
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Saved looks are unavailable on this device.'
    )
    const save = firstLook(dialog).getByRole('button', { name: 'Save look' })
    expect(save).toBeDisabled()

    unavailable.mockRestore()
    storageEvent(storageKey)
    expect(save).toBeEnabled()
    const reopen = within(dialog).getByRole('button', {
      name: /open saved look.*Dark jeans/i,
    })
    // The card still shows the old metadata until it reads disk. The removed recipe cannot reopen.
    localStorage.removeItem(storageKey)
    inventory.mockImplementationOnce(() => list(renewed))
    await user.click(reopen)
    await waitFor(() =>
      expect(firstLook(dialog).getByRole('img', { name: 'Your piece' })).toHaveAttribute(
        'src',
        renewed.imageAccess.url
      )
    )
    expect(firstLook(dialog).getByText('Pleated skirt')).toBeVisible()

    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    await user.click(save)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Saved looks are unavailable on this device.'
    )
    expect(write).toHaveBeenCalledWith(storageKey, JSON.stringify([defaultRecipe]))
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
    inventory.mockImplementation(() => list())
    await user.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
    expect(await within(dialog).findByRole('alert')).toHaveFocus()
    expect(within(dialog).queryByRole('img', { name: 'Your piece' })).toBeNull()
    expect(readRecipes()).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add Garment' })).toHaveFocus()
    )
  })

  it('does not expose or write another owner’s look when a queued lock acquires after a switch', async () => {
    const lock = Promise.withResolvers<void>()
    const finished = Promise.withResolvers<boolean>()
    const requestLock = vi.fn<RequestLock>(async (_key, apply) => {
      await lock.promise
      const applied = await apply()
      finished.resolve(applied)
      return applied
    })
    setLocks(requestLock)
    publishOwner(owner)
    render(<WardrobePage />)
    const { user, dialog } = await startStyling()
    await user.click(firstLook(dialog).getByRole('button', { name: 'Save look' }))
    expect(requestLock).toHaveBeenCalledOnce()

    inventory.mockImplementation(() => list(renewed))
    publishOwner('different-owner')
    expect(screen.queryByRole('dialog', dialogName)).toBeNull()
    await act(async () => {
      lock.resolve()
      expect(await finished.promise).toBe(false)
    })
    expect(await openButton()).toBeVisible()
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(
      localStorage.getItem(stylePieceStorageKey('different-owner', garmentId))
    ).toBeNull()
  })

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
})
