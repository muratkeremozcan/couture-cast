// Learning path Step 79: Lookbook with shuffle and pinned pieces.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-79-lookbook-with-shuffle-and-pinned-pieces
// Step 80 verifies that a superseded request cannot replace the current ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  createMemberLookbook,
  createStyleProfileStore,
  memberLookbookDraftKey,
} from '@couture/utils'
import type { LookIdeasResponse } from '@couture/api-client/contracts/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SavedLooksModule from '../../../lib/saved-looks'
import type * as SessionModule from '../../../lib/use-web-session'
import { SavedLookRequestError } from '../../../lib/saved-looks'
import { UNVERIFIED_BEARER_OWNER } from '../../../lib/use-web-session'
import { SaveFeedbackProvider } from '../save-feedback'
import { MemberLookbook } from './member-lookbook'

type CreateLook = typeof SavedLooksModule.createSavedLookFromWeb
type SaveReceipt = Pick<Awaited<ReturnType<CreateLook>>, 'id' | 'revision'>

const api = vi.hoisted(() => ({
  ritual: vi.fn(),
  generate: vi.fn(),
  create: vi.fn<(...args: Parameters<CreateLook>) => Promise<SaveReceipt>>(),
  remove: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  owner: 'lookbook-fixture-owner',
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: api.push }) }))
vi.mock('../../../lib/ritual', () => ({ getRitualFromWeb: api.ritual }))
vi.mock('../../../lib/api-client', () => ({
  createWebApiClient: () => ({ apiV1PersonalizationLookIdeasPost: api.generate }),
}))
vi.mock('../../../lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooksModule>()),
  createSavedLookFromWeb: api.create,
  deleteSavedLookFromWeb: api.remove,
  notifySavedLooksChanged: api.notify,
}))
vi.mock('../../../lib/use-web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  currentWebStyleScope: () => api.owner,
  captureWebStyleBearer: (scope: string) =>
    scope === api.owner ? 'fixture-bearer' : null,
  readAsMember: (_owner: string, read: () => Promise<unknown>) => read(),
}))

const OWNER = 'lookbook-fixture-owner'
const SECOND = 'lookbook-second-owner'
const STORAGE_KEY = memberLookbookDraftKey(OWNER)
const SAVED = { id: 'saved-look-1', revision: 3 }

const styleStore = createStyleProfileStore(
  () => api.owner,
  () =>
    Promise.resolve({ mood: null, palette: null, texture: null, fit: null, avoid: [] })
)

function editor(owner = OWNER) {
  return (
    <SaveFeedbackProvider>
      <MemberLookbook
        key={owner}
        owner={owner}
        scope={owner}
        style={{
          scope: owner,
          profile: null,
          day: null,
          saving: false,
          status: 'ready',
          store: styleStore,
        }}
      />
    </SaveFeedbackProvider>
  )
}

const pin = () => screen.getByTestId('lookbook-pin-shoes')
const save = () => screen.getByTestId('lookbook-save')

async function openEditor() {
  const view = render(editor())
  await screen.findByTestId('member-lookbook')
  await waitFor(() => expect(api.generate).toHaveBeenCalled())
  return view
}

function clickStatusAction(name: string) {
  fireEvent.click(
    within(screen.getByTestId('status-feedback-bar')).getByRole('button', { name })
  )
}

beforeEach(() => {
  api.owner = OWNER
  api.ritual
    .mockReset()
    .mockResolvedValue({ weather: { current: { temperature: 22, condition: 'clear' } } })
  api.create.mockReset().mockResolvedValue(SAVED)
  api.remove.mockReset().mockResolvedValue(undefined)
  api.generate.mockReset().mockResolvedValue({ data: null })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(memberLookbookDraftKey(SECOND))
})

describe('CC-7.22 web lookbook save and draft boundaries', () => {
  it('keeps the draft on a failed write, retries once with the same key, and confirms the saved look', async () => {
    api.create.mockRejectedValueOnce(new SavedLookRequestError('Unavailable', 503))
    await openEditor()
    fireEvent.click(pin())
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(save())
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'failed'))
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
    expect(api.notify).not.toHaveBeenCalled()

    clickStatusAction('Retry')
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'saved'))
    expect(pin()).toHaveAttribute('aria-pressed', 'false')
    expect(api.create).toHaveBeenCalledTimes(2)
    const [first, second] = api.create.mock.calls
    expect(first?.[0]).toMatchObject({ source: 'home_sample', weather: 'warm-dry' })
    expect(first?.[1]?.accessToken).toBe('fixture-bearer')
    expect(first?.[1]?.idempotencyKey).toMatch(/\S/)
    expect(second).toEqual(first)
    expect(api.notify).toHaveBeenCalledExactlyOnceWith(OWNER)

    clickStatusAction('View')
    expect(api.push).toHaveBeenCalledExactlyOnceWith('/looks/saved/saved-look-1')
  })

  it('retries a conflict with a new key and accepts a look already removed during Undo', async () => {
    api.create.mockRejectedValueOnce(new SavedLookRequestError('Conflict', 409))
    api.remove.mockRejectedValueOnce(new SavedLookRequestError('Gone', 404))
    await openEditor()
    fireEvent.click(save())
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'failed'))
    clickStatusAction('Retry')
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'saved'))
    expect(screen.getByTestId('lookbook-reset')).toBeDisabled()
    expect(api.create).toHaveBeenCalledTimes(2)
    const keys = api.create.mock.calls.map(([, options]) => options?.idempotencyKey)
    expect(keys).toEqual([expect.any(String), expect.any(String)])
    expect(keys[1]).not.toBe(keys[0])
    expect(
      within(screen.getByTestId('status-feedback-bar')).getByRole('button', {
        name: 'View',
      })
    ).toBeEnabled()

    clickStatusAction('Undo')
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'idle'))
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(
      SAVED.id,
      '"saved-look:saved-look-1:3"',
      expect.objectContaining({ accessToken: 'fixture-bearer' })
    )
    expect(api.notify.mock.calls).toEqual([[OWNER], [OWNER]])
  })

  it('keeps the confirmed look and reports a failed Undo', async () => {
    api.remove.mockRejectedValueOnce(new SavedLookRequestError('Unavailable', 503))
    await openEditor()
    fireEvent.click(save())
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'saved'))
    clickStatusAction('Undo')
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )
    expect(save()).toHaveAttribute('data-save-state', 'saved')
    expect(api.notify).toHaveBeenCalledTimes(1)
    expect(api.remove).toHaveBeenCalledTimes(1)
  })

  it('uses mild and dry on a missing forecast and keeps the editor usable without storage', async () => {
    api.ritual.mockRejectedValueOnce(new Error('No location'))
    await openEditor()
    expect(screen.getByTestId('lookbook-weather-reason')).toHaveTextContent(
      /outer layer|mild/i
    )
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage disabled')
    })
    try {
      fireEvent.click(pin())
      expect(pin()).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByTestId('lookbook-reset'))
      expect(pin()).toHaveAttribute('aria-pressed', 'false')
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    } finally {
      write.mockRestore()
    }
  })

  it('discards an in-flight saved response after switching members', async () => {
    let resolve!: (record: typeof SAVED) => void
    const pending = new Promise<typeof SAVED>((accept) => {
      resolve = accept
    })
    api.create.mockReturnValueOnce(pending)
    const view = await openEditor()
    fireEvent.click(pin())
    fireEvent.click(save())
    await waitFor(() => expect(save()).toHaveAttribute('data-save-state', 'saving'))
    expect(api.create).toHaveBeenCalledTimes(1)
    const previous = localStorage.getItem(STORAGE_KEY)

    api.owner = SECOND
    view.rerender(editor(SECOND))
    await act(async () => {
      resolve(SAVED)
      await pending
    })
    await screen.findByTestId('member-lookbook')
    expect(pin()).toHaveAttribute('aria-pressed', 'false')
    expect(save()).toHaveAttribute('data-save-state', 'idle')
    expect(api.notify).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(previous)
    expect(localStorage.getItem(memberLookbookDraftKey(SECOND))).toBeNull()
  })

  it('refreshes forecast on focus after visibility returns', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    render(editor())
    expect(api.ritual).not.toHaveBeenCalled()
    expect(screen.getByTestId('member-lookbook')).toBeVisible()
    expect(screen.getByTestId('lookbook-weather-reason')).toHaveTextContent(
      /outer layer|mild/i
    )
    expect(api.generate).not.toHaveBeenCalled()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(api.ritual).toHaveBeenCalledTimes(1))

    api.ritual.mockResolvedValueOnce({
      weather: { current: { temperature: 16, condition: 'rain' } },
    })
    fireEvent(window, new Event('focus'))
    await waitFor(() =>
      expect(screen.getByTestId('lookbook-weather-reason')).toHaveTextContent(/rain/i)
    )
    expect(api.ritual).toHaveBeenCalledTimes(2)
  })

  it('syncs the same owner’s stored draft across tabs and ignores other storage keys', async () => {
    await openEditor()
    const active = screen.getByTestId('lookbook-mood-active')
    expect(active).toHaveAttribute('aria-pressed', 'false')
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mood: 'active', looks: {} }))
    fireEvent(
      window,
      new StorageEvent('storage', { key: memberLookbookDraftKey(SECOND) })
    )
    expect(active).toHaveAttribute('aria-pressed', 'false')
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY }))
    expect(active).toHaveAttribute('aria-pressed', 'true')
    localStorage.removeItem(STORAGE_KEY)
    fireEvent(window, new StorageEvent('storage', { key: null }))
    expect(active).toHaveAttribute('aria-pressed', 'false')
  })

  it('lets a fixture bearer edit for the session without writing a device draft', async () => {
    api.owner = UNVERIFIED_BEARER_OWNER
    const write = vi.spyOn(Storage.prototype, 'setItem')
    render(editor(UNVERIFIED_BEARER_OWNER))
    await screen.findByTestId('member-lookbook')
    fireEvent.click(pin())
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('lookbook-shuffle'))
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps a newer forecast ranking when generation for the previous weather arrives late', async () => {
    const older = Promise.withResolvers<LookIdeasResponse>()
    const newer = Promise.withResolvers<LookIdeasResponse>()
    const oldWeather = 'warm-dry'
    const newWeather = 'mild-rainy'
    const describeWeather = (
      weather: typeof oldWeather | typeof newWeather,
      description: string
    ) =>
      createMemberLookbook(weather)
        .map(({ result }) => ({
          lookId: result.look!.id,
          description,
        }))
        .reverse()
    const oldDescription = 'A simple mix for a warm day.'
    const newDescription = 'A polished mix for a rainy day.'
    api.generate.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    await openEditor()

    api.ritual.mockResolvedValueOnce({
      weather: { current: { temperature: 16, condition: 'rain' } },
    })
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(2))
    await act(async () => {
      newer.resolve({ data: describeWeather(newWeather, newDescription) })
      await newer.promise
    })
    const description = await screen.findByTestId('lookbook-ai-description')
    expect(description).toHaveTextContent(newDescription)

    await act(async () => {
      older.resolve({ data: describeWeather(oldWeather, oldDescription) })
      await older.promise
    })
    expect(description).toHaveTextContent(newDescription)
    expect(screen.queryByTestId('lookbook-new-ideas')).toBeNull()
  })
})
