// Story 7.5 test plan 7.5-CMP-005..012: the web garment detail and its tag editor. Done saves
// through the CC-7.1 status bar (Saved with Undo, No changes, distinct failures) and the detail
// shows the tags the PATCH answered with.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
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
import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GarmentWithColor } from '@couture/api-client/contracts/http'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { SaveFeedbackProvider } from '../components/save-feedback'
import { GarmentDetail, type ClosetGarment } from './garment-detail'

const session = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
}))

const api = 'http://garment-detail.test/api/v1'
const owner = 'detail-member'
const garmentId = 'garment-blue-top'
const tagsPath = `${api}/wardrobe/garments/${garmentId}/tags`
const blueTop: GarmentWithColor = {
  ...createReadyGarmentFixture({
    id: garmentId,
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    imageAccess: {
      url: 'https://photos.example.test/blue-top.png',
      expiresAt: '2090-01-01T00:00:00.000Z',
    },
  }),
  colorFamily: 'blue',
}

type Patch = { body: unknown; header: string | null }
let patches: Patch[]
let reply: (body: Record<string, unknown>) => Response | Promise<Response>

const loaded = { category: 'top', material: 'cotton', comfortRange: 'mild' }

/** Answers like the API: the request's tags win; `expected` is a request-only field. */
function acceptTags(body: Record<string, unknown>) {
  const tags = { ...body }
  delete tags.expected
  return HttpResponse.json({ data: { ...blueTop, ...tags } })
}

function Harness({
  initial = blueTop,
  onBack = vi.fn(),
  onStylePiece = vi.fn(),
  onRefresh = vi.fn(),
  withProvider = true,
}: {
  initial?: ClosetGarment | null
  onBack?: () => void
  onStylePiece?: (selection: unknown, button: HTMLButtonElement) => void
  onRefresh?: () => void
  withProvider?: boolean
}) {
  const [garment, setGarment] = useState<ClosetGarment | null>(initial)
  const detail = (
    <GarmentDetail
      garment={garment}
      owner={owner}
      hasLoaded
      loadFailed={false}
      loading={false}
      onBack={onBack}
      onTagsSaved={setGarment}
      onRefresh={onRefresh}
      onStylePiece={onStylePiece}
    />
  )
  return withProvider ? <SaveFeedbackProvider>{detail}</SaveFeedbackProvider> : detail
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

const detail = () => within(screen.getByTestId('garment-detail'))
const statusBar = () => screen.findByTestId('status-feedback-bar')

async function editTo(
  user: ReturnType<typeof userEvent.setup>,
  choices: { material?: string; comfort?: string; category?: string }
) {
  await user.click(screen.getByTestId('garment-edit-tags'))
  if (choices.category)
    await user.click(
      screen.getByTestId(`garment-tag-option-category-${choices.category}`)
    )
  if (choices.material)
    await user.click(
      screen.getByTestId(`garment-tag-option-material-${choices.material}`)
    )
  if (choices.comfort)
    await user.click(screen.getByTestId(`garment-tag-option-comfort-${choices.comfort}`))
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', api.slice(0, -'/api/v1'.length))
  session.owner = owner
  sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, owner)
  setOnline(true)
  patches = []
  reply = acceptTags
  useMswHandlers(
    http.patch(tagsPath, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      patches.push({ body, header: request.headers.get('x-couture-garment-color') })
      return reply(body)
    })
  )
})

afterEach(() => {
  cleanup()
  setOnline(true)
  session.owner = null
  sessionStorage.clear()
  vi.unstubAllEnvs()
})

describe('GarmentDetail', () => {
  it('[P0] [7.5-CMP-003] shows back, the photo, the tags, Edit tags and Style this piece', () => {
    render(<Harness />)

    expect(detail().getByTestId('garment-detail-back')).toHaveTextContent(
      'Back to closet'
    )
    expect(detail().getByRole('img', { name: 'Blue top' })).toHaveAttribute(
      'src',
      'https://photos.example.test/blue-top.png'
    )
    expect(detail().getByRole('heading', { name: 'Blue top' })).toHaveFocus()
    expect(detail().getByTestId('garment-detail-category')).toHaveTextContent(/^Top$/)
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Cotton$/)
    expect(detail().getByTestId('garment-detail-comfort')).toHaveTextContent(/^Mild$/)
    expect(detail().getByTestId('garment-edit-tags')).toHaveTextContent('Edit tags')
    expect(detail().getByTestId('style-piece-open')).toBeEnabled()
  })

  it('[P0] [7.5-CMP-005] saves changed tags, shows the answer and offers Undo', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await editTo(user, { material: 'wool', comfort: 'cold' })
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await statusBar()).toHaveTextContent('Saved')
    expect(screen.getByTestId('status-bar-action-undo')).toHaveTextContent('Undo')
    expect(patches).toEqual([
      {
        // Codex P2.1: Done names the tags it loaded, so a newer edit elsewhere is not overwritten.
        body: {
          category: 'top',
          material: 'wool',
          comfortRange: 'cold',
          expected: loaded,
        },
        header: '1',
      },
    ])
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Wool$/)
    expect(detail().getByTestId('garment-detail-comfort')).toHaveTextContent(/^Cold$/)
    expect(screen.queryByTestId('garment-tag-editor')).toBeNull()
    expect(screen.getByTestId('garment-edit-tags')).toHaveFocus()
  })

  it('[P0] [7.5-CMP-005] renders the tags the server answered with, not the draft', async () => {
    const user = userEvent.setup()
    // The server normalizes the request (another device's comfort wins).
    reply = (body) => acceptTags({ ...body, comfortRange: 'cool' })
    render(<Harness />)

    await editTo(user, { comfort: 'cold' })
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await statusBar()).toHaveTextContent('Saved')
    expect(detail().getByTestId('garment-detail-comfort')).toHaveTextContent(/^Cool$/)
  })

  it('[P0] [7.5-CMP-006] Undo sends the previous tags back and says so', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await editTo(user, { material: 'wool', comfort: 'cold' })
    await user.click(screen.getByTestId('garment-tag-done'))
    await user.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )
    )
    // Undo restores the loaded tags and names the tags it saved.
    expect(patches.map(({ body }) => body)).toEqual([
      { category: 'top', material: 'wool', comfortRange: 'cold', expected: loaded },
      {
        ...loaded,
        expected: { category: 'top', material: 'wool', comfortRange: 'cold' },
      },
    ])
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Cotton$/)
    expect(detail().getByTestId('garment-detail-comfort')).toHaveTextContent(/^Mild$/)
  })

  it('[P1] [7.5-CMP-007] a failed Undo keeps the saved tags and offers Retry', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))
    // The save settles before the next reply is set, so only the Undo meets it.
    expect(await statusBar()).toHaveTextContent('Saved')
    reply = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })
    await user.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not undo. Try again.'
      )
    )
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Wool$/)

    reply = acceptTags
    await user.click(screen.getByTestId('status-bar-action-retry'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )
    )
    const savedTags = { category: 'top', material: 'wool', comfortRange: 'mild' }
    expect(patches.map(({ body }) => body)).toEqual([
      { ...savedTags, expected: loaded },
      { ...loaded, expected: savedTags },
      { ...loaded, expected: savedTags },
    ])
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Cotton$/)
  })

  it('[P0] [7.5-CMP-008] Done without a change says "No changes" and sends nothing', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByTestId('garment-edit-tags'))
    // Changing a tag and changing it back is still no change.
    await user.click(screen.getByTestId('garment-tag-option-material-wool'))
    await user.click(screen.getByTestId('garment-tag-option-material-cotton'))
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await statusBar()).toHaveTextContent('No changes')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
    expect(screen.queryByTestId('garment-tag-editor')).toBeNull()
    expect(patches).toEqual([])
  })

  it.each([
    ['tags another device changed', 'GARMENT_TAGS_CHANGED'],
    ['a concurrent update', 'CONCURRENT_TAG_UPDATE'],
  ])(
    '[P1] [7.5-CMP-009] names %s as a conflict, closes the editor and reads the piece again',
    async (_case, message) => {
      const user = userEvent.setup()
      const onRefresh = vi.fn()
      reply = () =>
        HttpResponse.json(
          { statusCode: 409, message, error: 'Conflict' },
          { status: 409 }
        )
      render(<Harness onRefresh={onRefresh} />)

      await editTo(user, { material: 'wool', comfort: 'cold' })
      await user.click(screen.getByTestId('garment-tag-done'))

      const copy = 'This piece changed on another device. Check the tags and try again.'
      const error = await screen.findByTestId('garment-tag-error')
      expect(error).toHaveAttribute('data-failure', 'conflict')
      expect(error).toHaveTextContent(copy)
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(copy)
      // A stale draft is not kept: the editor closes and the closet re-reads the piece.
      expect(screen.queryByTestId('garment-tag-editor')).toBeNull()
      expect(onRefresh).toHaveBeenCalledTimes(1)
      expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(
        /^Cotton$/
      )

      // Opening the editor again starts clean.
      await user.click(screen.getByTestId('garment-edit-tags'))
      expect(screen.queryByTestId('garment-tag-error')).toBeNull()
    }
  )

  it.each([
    [
      'a guardian block',
      403,
      'GUARDIAN_CONSENT_REQUIRED',
      'not-allowed',
      'A guardian has to approve closet changes first.',
    ],
    [
      'a server failure',
      500,
      'Internal server error',
      'failed',
      'Could not save. Try again.',
    ],
  ])(
    '[P1] [7.5-CMP-009] names %s in its own words and keeps the draft',
    async (_case, status, message, failure, copy) => {
      const user = userEvent.setup()
      reply = () => HttpResponse.json({ statusCode: status, message }, { status })
      render(<Harness />)

      await editTo(user, { material: 'wool', comfort: 'cold' })
      await user.click(screen.getByTestId('garment-tag-done'))

      const error = await screen.findByTestId('garment-tag-error')
      expect(error).toHaveAttribute('data-failure', failure)
      expect(error).toHaveTextContent(copy)
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(copy)
      // The draft stays selected and the saved tags stay on show.
      expect(screen.getByTestId('garment-tag-option-material-wool')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByTestId('garment-tag-option-comfort-cold')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(
        /^Cotton$/
      )
      expect(screen.getByTestId('garment-tag-done')).toBeEnabled()
    }
  )

  it('[P1] [7.5-CMP-009] a dropped connection reads as offline, keeps the draft and retries', async () => {
    const user = userEvent.setup()
    reply = () => HttpResponse.error()
    render(<Harness />)

    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await screen.findByTestId('garment-tag-error')).toHaveAttribute(
      'data-failure',
      'offline'
    )
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )
    expect(screen.getByTestId('garment-tag-option-material-wool')).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    reply = acceptTags
    await user.click(screen.getByTestId('status-bar-action-retry'))
    await waitFor(() =>
      expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Wool$/)
    )
    expect(patches).toHaveLength(2)
  })

  it('[P1] [7.5-CMP-009] offline Done sends nothing and keeps the draft', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await editTo(user, { material: 'wool' })
    setOnline(false)

    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await screen.findByTestId('garment-tag-error')).toHaveAttribute(
      'data-failure',
      'offline'
    )
    expect(patches).toEqual([])
    expect(screen.getByTestId('garment-tag-option-material-wool')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('[P1] [7.5-CMP-010] clears material to null; category and comfort have no empty choice', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByTestId('garment-edit-tags'))
    expect(screen.queryByTestId('garment-tag-option-category-none')).toBeNull()
    expect(screen.queryByTestId('garment-tag-option-comfort-none')).toBeNull()
    expect(screen.getByTestId('garment-tag-option-category-top')).toHaveTextContent(
      /^Top$/
    )
    expect(screen.getByTestId('garment-tag-option-category-outerwear')).toHaveTextContent(
      /^Outer layer$/
    )
    await user.click(screen.getByTestId('garment-tag-option-material-none'))
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await statusBar()).toHaveTextContent('Saved')
    expect(patches[0]?.body).toEqual({
      category: 'top',
      material: null,
      comfortRange: 'mild',
      expected: loaded,
    })
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(
      /^No material$/
    )
  })

  it('[P1] [7.5-CMP-010] Cancel closes the editor without a request', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await editTo(user, { category: 'dress' })
    await user.click(screen.getByTestId('garment-tag-cancel'))

    expect(screen.queryByTestId('garment-tag-editor')).toBeNull()
    expect(detail().getByTestId('garment-detail-category')).toHaveTextContent(/^Top$/)
    expect(patches).toEqual([])
  })

  it('[P1] [7.5-CMP-011] Style this piece opens for this garment', async () => {
    const user = userEvent.setup()
    const onStylePiece = vi.fn()
    render(<Harness onStylePiece={onStylePiece} />)

    await user.click(screen.getByTestId('style-piece-open'))

    expect(onStylePiece).toHaveBeenCalledTimes(1)
    expect(onStylePiece.mock.calls[0]?.[0]).toEqual({
      id: garmentId,
      category: 'top',
      comfortRange: 'mild',
    })
  })

  it('[P1] [7.5-CMP-004] an id that left the closet says so and offers back', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<Harness initial={null} onBack={onBack} />)

    expect(screen.getByTestId('garment-detail-missing')).toHaveTextContent(
      'This piece is no longer in your closet.'
    )
    await user.click(screen.getByTestId('garment-detail-back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('[P2] [7.5-CMP-012] shows Saved inline when no status bar provider is mounted', async () => {
    const user = userEvent.setup()
    render(<Harness withProvider={false} />)

    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))

    const bar = await statusBar()
    expect(bar).toHaveAttribute('data-placement', 'inline')
    expect(bar).toHaveTextContent('Saved')
  })

  it('[P0] [7.5-CMP-013] a newer Done retires the older Undo (Codex P2.1)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))
    await screen.findByTestId('status-bar-action-undo')

    await editTo(user, { comfort: 'cold' })
    await user.click(screen.getByTestId('garment-tag-done'))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(screen.getAllByTestId('status-bar-action-undo')).toHaveLength(1)

    await user.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )
    )
    // Only the newest save is undone: back to the first save's tags, not the loaded ones.
    expect(patches.map(({ body }) => body)).toEqual([
      { category: 'top', material: 'wool', comfortRange: 'mild', expected: loaded },
      {
        category: 'top',
        material: 'wool',
        comfortRange: 'cold',
        expected: { category: 'top', material: 'wool', comfortRange: 'mild' },
      },
      {
        category: 'top',
        material: 'wool',
        comfortRange: 'mild',
        expected: { category: 'top', material: 'wool', comfortRange: 'cold' },
      },
    ])
    expect(detail().getByTestId('garment-detail-comfort')).toHaveTextContent(/^Mild$/)
  })

  it('[P1] [7.5-CMP-013] an Undo refused because the piece changed elsewhere says so without Retry', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))
    // The save settles before the next reply is set, so only the Undo meets it.
    expect(await statusBar()).toHaveTextContent('Saved')
    reply = () =>
      HttpResponse.json(
        { statusCode: 409, message: 'GARMENT_TAGS_CHANGED', error: 'Conflict' },
        { status: 409 }
      )

    await user.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'This piece changed on another device. Check the tags and try again.'
      )
    )
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Wool$/)
  })

  it('[P1] [7.5-CMP-014] a slow save shows Saving, then Still saving, then Saved (Codex P2.3)', async () => {
    const user = userEvent.setup()
    const pending = Promise.withResolvers<void>()
    reply = async (body) => {
      await pending.promise
      return acceptTags(body)
    }
    render(<Harness />)
    await editTo(user, { material: 'wool' })

    await user.click(screen.getByTestId('garment-tag-done'))
    const done = screen.getByTestId('garment-tag-done')
    expect(done).toHaveAttribute('data-save-state', 'saving')
    expect(done).toHaveTextContent('Saving')
    await waitFor(() => expect(done).toHaveAttribute('data-save-state', 'still-saving'), {
      timeout: 3000,
    })
    expect(done).toHaveTextContent('Still saving')
    expect(screen.getByTestId('save-feedback-announcer')).toHaveTextContent(
      'Still saving'
    )

    pending.resolve()
    expect(await statusBar()).toHaveTextContent('Saved')
  })

  it('[P1] [7.5-CMP-014] a reopened detail announces its Saved again under the same provider', async () => {
    const user = userEvent.setup()
    function Reopenable({ round }: { round: number }) {
      const [garment, setGarment] = useState<ClosetGarment>(blueTop)
      return (
        <GarmentDetail
          key={round}
          garment={garment}
          owner={owner}
          hasLoaded
          loadFailed={false}
          loading={false}
          onBack={vi.fn()}
          onTagsSaved={setGarment}
          onRefresh={vi.fn()}
          onStylePiece={vi.fn()}
        />
      )
    }
    const { rerender } = render(
      <SaveFeedbackProvider>
        <Reopenable round={1} />
      </SaveFeedbackProvider>
    )
    const announcer = () => screen.getByTestId('save-feedback-announcer')
    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))
    await waitFor(() => expect(announcer()).toHaveTextContent('Saved'))
    await editTo(user, {})
    await user.click(screen.getByTestId('garment-tag-done'))
    await waitFor(() => expect(announcer()).toHaveTextContent('No changes'))

    // The same piece opened again: its first notice must not reuse an announced id.
    rerender(
      <SaveFeedbackProvider>
        <Reopenable round={2} />
      </SaveFeedbackProvider>
    )
    await editTo(user, { material: 'linen' })
    await user.click(screen.getByTestId('garment-tag-done'))

    await waitFor(() => expect(announcer()).toHaveTextContent('Saved'))
  })

  it('[P1] [7.5-CMP-015] renews a photo whose signed link is about to expire (Codex P2.5)', () => {
    const onRefresh = vi.fn()
    const soon = new Date(Date.now() + 30_000).toISOString()
    const later = new Date(Date.now() + 10 * 60_000).toISOString()
    const garmentWith = (expiresAt: string) => ({
      ...blueTop,
      imageAccess: { url: `https://photos.example.test/${expiresAt}.png`, expiresAt },
    })

    const { unmount } = render(
      <Harness initial={garmentWith(later)} onRefresh={onRefresh} />
    )
    expect(onRefresh).not.toHaveBeenCalled()
    unmount()

    render(<Harness initial={garmentWith(soon)} onRefresh={onRefresh} />)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.5-CMP-015] a photo that fails to load falls back to a named placeholder and refetches once', () => {
    const onRefresh = vi.fn()
    const props = {
      owner,
      hasLoaded: true,
      loadFailed: false,
      loading: false,
      onBack: vi.fn(),
      onTagsSaved: vi.fn(),
      onRefresh,
      onStylePiece: vi.fn(),
    }
    const renewed = {
      ...blueTop,
      imageAccess: {
        url: 'https://photos.example.test/blue-top-renewed.png',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    }
    const { rerender } = render(
      <SaveFeedbackProvider>
        <GarmentDetail {...props} garment={blueTop} />
      </SaveFeedbackProvider>
    )

    fireEvent.error(screen.getByRole('img', { name: 'Blue top' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    const placeholder = screen.getByTestId('garment-detail-photo')
    expect(placeholder.tagName).not.toBe('IMG')
    expect(placeholder).toHaveAccessibleName('Blue top')

    // The refetched link loads again; a second failure stays a placeholder without a loop.
    rerender(
      <SaveFeedbackProvider>
        <GarmentDetail {...props} garment={renewed} />
      </SaveFeedbackProvider>
    )
    const retried = screen.getByRole('img', { name: 'Blue top' })
    expect(retried).toHaveAttribute('src', renewed.imageAccess.url)
    fireEvent.error(retried)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('garment-detail-photo').tagName).not.toBe('IMG')
  })

  it('[P1] [7.5-CMP-018] the editor compares and sends the tags it opened with, even if the piece reloads meanwhile', async () => {
    const user = userEvent.setup()
    let update!: (garment: ClosetGarment) => void
    function Reloading() {
      const [garment, setGarment] = useState<ClosetGarment>(blueTop)
      update = setGarment
      return (
        <SaveFeedbackProvider>
          <GarmentDetail
            garment={garment}
            owner={owner}
            hasLoaded
            loadFailed={false}
            loading={false}
            onBack={vi.fn()}
            onTagsSaved={setGarment}
            onRefresh={vi.fn()}
            onStylePiece={vi.fn()}
          />
        </SaveFeedbackProvider>
      )
    }
    render(<Reloading />)

    await user.click(screen.getByTestId('garment-edit-tags'))
    // A background read brings another device's material while the editor is open.
    act(() => update({ ...blueTop, material: 'linen' }))
    await user.click(screen.getByTestId('garment-tag-option-comfort-cold'))
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await statusBar()).toHaveTextContent('Saved')
    expect(patches.map(({ body }) => body)).toEqual([
      { category: 'top', material: 'cotton', comfortRange: 'cold', expected: loaded },
    ])
  })

  it('[P1] [7.5-CMP-018] focus moves to the selected category on open and back to Edit tags on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByTestId('garment-edit-tags'))
    const selected = screen.getByTestId('garment-tag-option-category-top')
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected).toHaveFocus()

    await user.click(screen.getByTestId('garment-tag-cancel'))
    expect(screen.getByTestId('garment-edit-tags')).toHaveFocus()
  })

  it('[P1] [7.5-CMP-019] a failed closet read offers Retry instead of saying the piece is gone', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    render(
      <SaveFeedbackProvider>
        <GarmentDetail
          garment={null}
          owner={owner}
          hasLoaded
          loadFailed
          loading={false}
          onBack={vi.fn()}
          onTagsSaved={vi.fn()}
          onRefresh={onRefresh}
          onStylePiece={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    expect(screen.queryByTestId('garment-detail-missing')).toBeNull()
    expect(screen.getByTestId('garment-detail-loading')).toHaveTextContent(
      'Could not load this piece. Try again.'
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
