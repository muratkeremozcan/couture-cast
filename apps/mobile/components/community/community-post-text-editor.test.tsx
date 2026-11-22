// Learning path Step 62: Community post edits persist.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-62-community-post-edits-persist
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  COMMUNITY_POST_TEXT_CONFLICT_MESSAGE,
  COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
  COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  type CommunityFeedItem,
} from '@couture/api-client/contracts/http'
import { initI18n } from '@/src/lib/i18n'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import { CommunityRequestError, type CommunityFailureReason } from '@/src/lib/community'
import type * as CommunityApi from '@/src/lib/community'
import {
  CommunityPostTextEditor,
  type SavedCommunityText,
} from './community-post-text-editor'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const save = vi.hoisted(() => vi.fn())
vi.mock('@/src/lib/community', async (importOriginal) => ({
  ...(await importOriginal<typeof CommunityApi>()),
  editCommunityPostTextFromMobile: save,
}))

beforeAll(initI18n)
beforeEach(() => {
  save.mockReset()
})

const post: CommunityFeedItem = {
  id: 'look',
  author: { displayName: 'You', isSelf: true },
  title: 'Original',
  caption: null,
  textRevision: 1,
  altText: null,
  climateBand: null,
  challengeId: null,
  createdAt: '2026-11-20T17:00:00.000Z',
  publishedAt: '2026-11-20T17:00:00.000Z',
  status: 'published',
  imageAccess: {
    url: 'https://fixtures.invalid/photo',
    expiresAt: '2026-11-20T19:00:00.000Z',
  },
}

it('suspends an in-flight save, retains the draft, and restores the edit button on cancel', async () => {
  let complete!: (text: SavedCommunityText) => void
  save.mockImplementationOnce(
    () =>
      new Promise<SavedCommunityText>((resolve) => {
        complete = resolve
      })
  )
  const onSaved = vi.fn()
  const edit = (enabled: boolean) => (
    <CommunityPostTextEditor item={post} enabled={enabled} onSaved={onSaved} />
  )
  const view = render(edit(true))
  fireEvent.click(screen.getByTestId('community-edit-text'))
  const title = screen.getByTestId('community-edit-title')
  await waitFor(() => expect(document.activeElement).toBe(title))
  fireEvent.change(title, { target: { value: 'A new draft' } })
  fireEvent.click(screen.getByTestId('community-edit-save'))
  const signal = save.mock.calls[0]?.[2] as AbortSignal | undefined
  expect(signal?.aborted).toBe(false)

  view.rerender(edit(false))
  expect(signal?.aborted).toBe(true)
  await act(() =>
    Promise.resolve(complete({ title: 'A late answer', caption: null, textRevision: 2 }))
  )
  expect(onSaved).not.toHaveBeenCalled()
  expect((title as HTMLInputElement).value).toBe('A new draft')

  view.rerender(edit(true))
  fireEvent.click(screen.getByTestId('community-edit-cancel'))
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByTestId('community-edit-text'))
  )
})

it('shows distinct outcome feedback for saved and unchanged edits', async () => {
  const onSaved = vi.fn()
  save
    .mockResolvedValueOnce({ title: 'Original', caption: null, textRevision: 1 })
    .mockResolvedValueOnce({ title: 'Revised', caption: 'Fresh note', textRevision: 2 })

  render(
    <SaveFeedbackProvider>
      <CommunityPostTextEditor item={post} enabled onSaved={onSaved} />
    </SaveFeedbackProvider>
  )

  fireEvent.click(screen.getByTestId('community-edit-text'))
  fireEvent.click(screen.getByTestId('community-edit-save'))
  expect((await screen.findByTestId('community-edit-status')).textContent).toBe(
    'No changes'
  )
  expect((await screen.findByTestId('status-feedback-bar')).textContent).toContain(
    'No changes'
  )
  expect(onSaved).not.toHaveBeenCalled()

  fireEvent.click(screen.getByTestId('community-edit-text'))
  fireEvent.change(screen.getByTestId('community-edit-title'), {
    target: { value: 'Revised' },
  })
  fireEvent.change(screen.getByTestId('community-edit-description'), {
    target: { value: 'Fresh note' },
  })
  fireEvent.click(screen.getByTestId('community-edit-save'))

  expect((await screen.findByTestId('community-edit-status')).textContent).toBe(
    'Changes saved.'
  )
  expect((await screen.findByTestId('status-feedback-bar')).textContent).toContain(
    'Changes saved.'
  )
  expect(onSaved).toHaveBeenCalledWith('look', {
    title: 'Revised',
    caption: 'Fresh note',
    textRevision: 2,
  })
})

it.each<[CommunityFailureReason, number, string, string]>([
  [
    'unknown',
    400,
    COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
    'These changes weren’t approved by our community guidelines. Edit the wording and try again.',
  ],
  [
    'unknown',
    503,
    COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
    'Text screening is temporarily unavailable. Your draft is still here—try again shortly.',
  ],
  [
    'unknown',
    409,
    COMMUNITY_POST_TEXT_CONFLICT_MESSAGE,
    'The look changed while you were editing. Reopen it to edit the latest version.',
  ],
  [
    'rate_limited',
    429,
    'You have reached the hourly post edit limit.',
    'You’ve reached the hourly post edit limit. Try again later.',
  ],
])(
  'maps %s (%i) to distinct message and retains attempted draft',
  async (reason, status, serverMessage, expectedCopy) => {
    save.mockRejectedValueOnce(
      new CommunityRequestError(reason, serverMessage, undefined, status)
    )
    const onSaved = vi.fn()
    render(<CommunityPostTextEditor item={post} enabled onSaved={onSaved} />)

    fireEvent.click(screen.getByTestId('community-edit-text'))
    const title = screen.getByTestId('community-edit-title')
    fireEvent.change(title, { target: { value: 'Kept draft' } })
    fireEvent.click(screen.getByTestId('community-edit-save'))

    expect(await screen.findByText(expectedCopy)).toBeTruthy()
    expect((title as HTMLInputElement).value).toBe('Kept draft')
    expect(onSaved).not.toHaveBeenCalled()
  }
)
