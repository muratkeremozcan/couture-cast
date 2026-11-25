// Story 7.5 test plan 7.5-CMP-005..012: the web garment detail and its tag editor. Done saves
// through the CC-7.1 status bar (Saved with Undo, No changes, distinct failures) and the detail
// shows the tags the PATCH answered with.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

function acceptTags(body: Record<string, unknown>) {
  return HttpResponse.json({ data: { ...blueTop, ...body } })
}

function Harness({
  initial = blueTop,
  onBack = vi.fn(),
  onStylePiece = vi.fn(),
  withProvider = true,
}: {
  initial?: ClosetGarment | null
  onBack?: () => void
  onStylePiece?: (selection: unknown, button: HTMLButtonElement) => void
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
      onRefresh={vi.fn()}
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
      { body: { category: 'top', material: 'wool', comfortRange: 'cold' }, header: '1' },
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
    expect(patches.map(({ body }) => body)).toEqual([
      { category: 'top', material: 'wool', comfortRange: 'cold' },
      { category: 'top', material: 'cotton', comfortRange: 'mild' },
    ])
    expect(detail().getByTestId('garment-detail-material')).toHaveTextContent(/^Cotton$/)
    expect(detail().getByTestId('garment-detail-comfort')).toHaveTextContent(/^Mild$/)
  })

  it('[P1] [7.5-CMP-007] a failed Undo keeps the saved tags and offers Retry', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await editTo(user, { material: 'wool' })
    await user.click(screen.getByTestId('garment-tag-done'))
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
    expect(patches.map(({ body }) => body)).toEqual([
      { category: 'top', material: 'wool', comfortRange: 'mild' },
      { category: 'top', material: 'cotton', comfortRange: 'mild' },
      { category: 'top', material: 'cotton', comfortRange: 'mild' },
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
    [
      'a concurrent update',
      409,
      'CONCURRENT_TAG_UPDATE',
      'conflict',
      'This piece changed on another device. Check the tags and try again.',
    ],
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
})
