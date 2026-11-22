// Learning path Step 62: Community post edits persist.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-62-community-post-edits-persist
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
  COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  type CommunityFeedItem,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { SaveFeedbackProvider } from './save-feedback'
import {
  errorBody,
  feedHandler,
  item,
  OPENED_PATH,
  POST_PATH,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  ranked,
  SPOTLIGHT_PATH,
  spotlightBody,
} from '../../test-utils/community-spotlight'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import { CommunityPostTextEditor } from './community-post-text-editor'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()

const EDIT_PATH = `${POST_PATH}/text`
const EDIT = 'Edit title and description'
const SAVE = 'Save changes'
const original = 'Autumn layers'
const description = 'A wool coat for the commute.'

function ownedPost(overrides: Partial<CommunityFeedItem> = {}) {
  return item({
    author: { displayName: 'You', isSelf: true },
    title: original,
    caption: description,
    textRevision: 4,
    ...overrides,
  })
}

async function openDetail(user: ReturnType<typeof userEvent.setup>, post = ownedPost()) {
  mockApi(
    feedHandler({ items: [post] }),
    http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
  )
  renderGrid()
  await user.click(await screen.findByTestId(`lookbook-open-${post.id}`))
  return within(await screen.findByRole('dialog'))
}

describe('Community look text editing', () => {
  setupCommunityGridSurface()

  it('cancels a draft, then saves revised text and updates the detail and card', async () => {
    signIn()
    const user = userEvent.setup()
    const requests: unknown[] = []
    mockApi(
      http.patch(EDIT_PATH, async ({ request }) => {
        requests.push(await request.json())
        return HttpResponse.json({
          data: { title: 'Winter layers', caption: null, textRevision: 5 },
        })
      })
    )
    const detail = await openDetail(user)
    const edit = () => detail.getByRole('button', { name: EDIT })
    await user.click(edit())
    const title = () => detail.getByRole('textbox', { name: 'Title (optional)' })
    const caption = () => detail.getByRole('textbox', { name: 'Description (optional)' })
    expect(title()).toHaveFocus()
    expect(title()).toHaveValue(original)
    expect(caption()).toHaveValue(description)

    await user.clear(title())
    await user.type(title(), 'A draft I will discard')
    await user.click(detail.getByRole('button', { name: 'Cancel' }))
    expect(edit()).toHaveFocus()
    expect(requests).toEqual([])

    await user.click(edit())
    expect(title()).toHaveValue(original)
    await user.clear(title())
    await user.type(title(), '  Winter layers  ')
    await user.clear(caption())
    await user.click(detail.getByRole('button', { name: SAVE }))

    expect(await screen.findByRole('dialog', { name: 'Winter layers' })).toBeVisible()
    expect(requests).toEqual([{ baseRevision: 4, title: 'Winter layers', caption: null }])
    expect(edit()).toHaveFocus()
    expect(detail.getByTestId('community-detail-edited')).toHaveTextContent('Edited')
    expect(detail.getByTestId('community-edit-status')).toHaveTextContent(
      'Changes saved.'
    )
    expect(detail.queryByText(description)).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('title-post-1')).toHaveTextContent('Winter layers')
    expect(screen.getByTestId('edited-badge-post-1')).toHaveTextContent('Edited')
  })

  it('updates both cards when the owner edits a look from City Spotlight', async () => {
    signIn()
    const user = userEvent.setup()
    const post = ownedPost()
    const revisedDescription = 'A lighter jacket for the afternoon.'
    let requestBody: unknown
    mockApi(
      feedHandler({ items: [post] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1, post)] })),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true })),
      http.patch(EDIT_PATH, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          data: { title: null, caption: revisedDescription, textRevision: 5 },
        })
      })
    )
    renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    await user.click(await screen.findByTestId('spotlight-lookbook-open-post-1'))
    const detail = within(await screen.findByRole('dialog', { name: original }))
    await user.click(detail.getByRole('button', { name: EDIT }))
    const caption = detail.getByRole('textbox', { name: 'Description (optional)' })
    await user.clear(detail.getByRole('textbox', { name: 'Title (optional)' }))
    await user.clear(caption)
    await user.type(caption, revisedDescription)
    await user.click(detail.getByRole('button', { name: SAVE }))
    await waitFor(() =>
      expect(detail.getByTestId('community-detail-caption')).toHaveTextContent(
        revisedDescription
      )
    )
    expect(requestBody).toEqual({
      title: null,
      caption: revisedDescription,
      baseRevision: 4,
    })
    await user.keyboard('{Escape}')

    expect(screen.getByTestId('caption-post-1')).toHaveTextContent(revisedDescription)
    expect(screen.getByTestId('spotlight-caption-post-1')).toHaveTextContent(
      revisedDescription
    )
    expect(screen.queryByTestId('title-post-1')).toBeNull()
    expect(screen.queryByTestId('spotlight-title-post-1')).toBeNull()
  })

  it.each([
    [400, 'We couldn’t save your changes. Check the text and try again.'],
    [
      409,
      'The look changed while you were editing. Reopen it to edit the latest version.',
    ],
    [429, 'You’ve reached the hourly post edit limit. Try again later.'],
  ])(
    'preserves the editable draft and published copy when save returns %s',
    async (status, message) => {
      signIn()
      const user = userEvent.setup()
      mockApi(http.patch(EDIT_PATH, () => errorBody(status, 'Edit refused', 'Error')))
      const detail = await openDetail(user)
      await user.click(detail.getByRole('button', { name: EDIT }))
      const title = detail.getByRole('textbox', { name: 'Title (optional)' })
      const caption = detail.getByRole('textbox', { name: 'Description (optional)' })
      await user.clear(title)
      await user.type(title, 'Revised title')
      await user.type(caption, ' Add scarf.')
      const save = detail.getByRole('button', { name: SAVE })
      await user.click(save)

      expect(await detail.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('dialog', { name: original })).toBeVisible()
      expect(detail.getByText(description)).toBeVisible()
      expect(title).toHaveValue('Revised title')
      expect(caption).toHaveValue(`${description} Add scarf.`)
      expect(save).toBeEnabled()
    }
  )

  it('keeps invalid input local and starts empty for a post without text', async () => {
    signIn()
    const user = userEvent.setup()
    const patch = vi.fn(() => errorBody(400, 'Unexpected request', 'Bad Request'))
    mockApi(http.patch(EDIT_PATH, patch))
    const detail = await openDetail(user, ownedPost({ title: null, caption: null }))
    await user.click(detail.getByRole('button', { name: EDIT }))
    const title = detail.getByRole('textbox', { name: 'Title (optional)' })
    expect(title).toHaveValue('')
    expect(detail.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(
      ''
    )
    await user.type(title, 'https://example.com')
    await user.click(detail.getByRole('button', { name: SAVE }))

    expect(detail.getByRole('alert')).toHaveTextContent('Check the text and try again.')
    expect(title).toHaveValue('https://example.com')
    expect(patch).not.toHaveBeenCalled()
  })

  it('aborts an in-flight edit when the reader closes the detail', async () => {
    signIn()
    const user = userEvent.setup()
    const started = Promise.withResolvers<AbortSignal>()
    const response = Promise.withResolvers<Response>()
    const lateChange = HttpResponse.json({
      data: { title: 'Late answer', caption: null, textRevision: 5 },
    })
    mockApi(
      http.patch(EDIT_PATH, ({ request }) => {
        started.resolve(request.signal)
        return response.promise
      })
    )
    const detail = await openDetail(user)
    await user.click(detail.getByRole('button', { name: EDIT }))
    await user.click(detail.getByRole('button', { name: SAVE }))
    try {
      const signal = await started.promise
      expect(detail.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      expect(detail.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(signal.aborted).toBe(true))
      await act(async () => {
        response.resolve(lateChange)
        await response.promise
      })

      expect(screen.queryByRole('dialog')).toBeNull()
      const card = within(screen.getByTestId('lookbook-card-post-1'))
      expect(card.getByTestId('title-post-1')).toHaveTextContent(original)
      expect(card.queryByText('Late answer')).toBeNull()
    } finally {
      response.resolve(lateChange)
    }
  })

  it('retains the draft if editing is temporarily suspended', async () => {
    signIn()
    const user = userEvent.setup()
    const started = Promise.withResolvers<AbortSignal>()
    const response = Promise.withResolvers<Response>()
    const lateChange = HttpResponse.json({
      data: { title: 'Late answer', caption: null, textRevision: 5 },
    })
    mockApi(
      http.patch(EDIT_PATH, ({ request }) => {
        started.resolve(request.signal)
        return response.promise
      })
    )
    const onSaved = vi.fn()
    const post = ownedPost()
    const editor = (enabled: boolean) => (
      <CommunityPostTextEditor
        item={post}
        enabled={enabled}
        onSaved={onSaved}
        t={(key) => getI18n().t(key)}
      />
    )
    const view = render(editor(true))
    await user.click(screen.getByRole('button', { name: EDIT }))
    const title = screen.getByRole('textbox', { name: 'Title (optional)' })
    await user.type(title, ' plus scarf')
    await user.click(screen.getByRole('button', { name: SAVE }))
    try {
      const signal = await started.promise
      view.rerender(editor(false))
      await waitFor(() => expect(signal.aborted).toBe(true))
      await act(async () => {
        response.resolve(lateChange)
        await response.promise
      })
      expect(onSaved).not.toHaveBeenCalled()
      expect(title).toHaveValue(`${original} plus scarf`)
      expect(screen.getByRole('button', { name: SAVE })).toBeDisabled()
      view.rerender(editor(true))
      expect(screen.getByRole('button', { name: SAVE })).toBeEnabled()
    } finally {
      response.resolve(lateChange)
    }
  })

  it.each([
    [
      400,
      COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
      'These changes weren’t approved by our community guidelines. Edit the wording and try again.',
    ],
    [
      503,
      COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
      'Text screening is temporarily unavailable. Your draft is still here—try again shortly.',
    ],
  ])(
    'shows distinct outcome copy for %s screening error while preserving approved text and draft',
    async (status, serverMessage, expectedCopy) => {
      signIn()
      const user = userEvent.setup()
      mockApi(http.patch(EDIT_PATH, () => errorBody(status, serverMessage, 'Error')))
      const detail = await openDetail(user)
      await user.click(detail.getByRole('button', { name: EDIT }))
      const title = detail.getByRole('textbox', { name: 'Title (optional)' })
      await user.clear(title)
      await user.type(title, 'Attempted draft')
      await user.click(detail.getByRole('button', { name: SAVE }))

      expect(await detail.findByRole('alert')).toHaveTextContent(expectedCopy)
      expect(screen.getByRole('dialog', { name: original })).toBeVisible()
      expect(detail.getByTestId('community-detail-caption')).toHaveTextContent(
        description
      )
      expect(title).toHaveValue('Attempted draft')
    }
  )

  it('shows "No changes" and keeps textRevision unchanged for an unchanged payload', async () => {
    signIn()
    const user = userEvent.setup()
    mockApi(
      http.patch(EDIT_PATH, () =>
        HttpResponse.json({
          data: { title: original, caption: description, textRevision: 0 },
        })
      )
    )
    const unedited = ownedPost({ textRevision: 0 })
    const detail = await openDetail(user, unedited)
    expect(detail.queryByTestId('community-detail-edited')).toBeNull()

    await user.click(detail.getByRole('button', { name: EDIT }))
    await user.click(detail.getByRole('button', { name: SAVE }))

    expect(await detail.findByTestId('community-edit-status')).toHaveTextContent(
      'No changes'
    )
    expect(detail.queryByTestId('community-detail-edited')).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('edited-badge-post-1')).toBeNull()
  })

  it('announces saved feedback through SaveFeedbackProvider when mounted inside it', async () => {
    signIn()
    const user = userEvent.setup()
    mockApi(
      http.patch(EDIT_PATH, () =>
        HttpResponse.json({
          data: { title: 'Updated look', caption: description, textRevision: 1 },
        })
      )
    )
    const onSaved = vi.fn()
    render(
      <SaveFeedbackProvider>
        <CommunityPostTextEditor
          item={ownedPost({ textRevision: 0 })}
          enabled
          onSaved={onSaved}
          t={(key) => getI18n().t(key)}
        />
      </SaveFeedbackProvider>
    )
    await user.click(screen.getByRole('button', { name: EDIT }))
    const title = screen.getByRole('textbox', { name: 'Title (optional)' })
    await user.clear(title)
    await user.type(title, 'Updated look')
    await user.click(screen.getByRole('button', { name: SAVE }))

    expect(await screen.findByTestId('community-edit-status')).toHaveTextContent(
      'Changes saved.'
    )
    expect(onSaved).toHaveBeenCalledWith('post-1', {
      title: 'Updated look',
      caption: description,
      textRevision: 1,
    })
  })

  it('does not let a stale targets/resolve read overwrite a newer saved text revision', async () => {
    signIn()
    const user = userEvent.setup()
    const stalePost = ownedPost({ textRevision: 0 })
    const releaseResolve = Promise.withResolvers<Response>()
    let resolveCalled = false
    mockApi(
      feedHandler({ items: [stalePost] }),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true })),
      http.post('*/api/v1/community/targets/resolve', () => {
        if (!resolveCalled) {
          resolveCalled = true
          return releaseResolve.promise
        }
        return HttpResponse.json({
          data: {
            targets: [
              {
                key: stalePost.id,
                status: 'available',
                communityRevision: '1',
                post: stalePost,
                comment: null,
                parent: null,
                pageCursor: null,
                parentPageCursor: null,
                threadPosition: null,
              },
            ],
          },
        })
      }),
      http.patch(EDIT_PATH, () =>
        HttpResponse.json({
          data: {
            title: 'Saved newer title',
            caption: 'Saved newer caption',
            textRevision: 1,
          },
        })
      )
    )
    renderGrid()
    await user.click(await screen.findByTestId(`lookbook-open-${stalePost.id}`))
    const detail = within(await screen.findByRole('dialog'))
    await user.click(detail.getByRole('button', { name: EDIT }))
    const title = detail.getByRole('textbox', { name: 'Title (optional)' })
    const caption = detail.getByRole('textbox', { name: 'Description (optional)' })
    await user.clear(title)
    await user.type(title, 'Saved newer title')
    await user.clear(caption)
    await user.type(caption, 'Saved newer caption')
    await user.click(detail.getByRole('button', { name: SAVE }))
    expect(await screen.findByRole('dialog', { name: 'Saved newer title' })).toBeVisible()

    // Release the older resolve that captured textRevision: 0 before the edit saved.
    await act(async () => {
      releaseResolve.resolve(
        HttpResponse.json({
          data: {
            targets: [
              {
                key: stalePost.id,
                status: 'available',
                communityRevision: '1',
                post: stalePost,
                comment: null,
                parent: null,
                pageCursor: null,
                parentPageCursor: null,
                threadPosition: null,
              },
            ],
          },
        })
      )
      await releaseResolve.promise
    })

    expect(screen.getByRole('dialog', { name: 'Saved newer title' })).toBeVisible()
    expect(detail.getByTestId('community-detail-caption')).toHaveTextContent(
      'Saved newer caption'
    )
    expect(detail.getByTestId('community-detail-edited')).toHaveTextContent('Edited')
  })
})
