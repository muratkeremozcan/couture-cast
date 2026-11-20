import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, it, vi } from 'vitest'
import type { CommunityFeedItem } from '@couture/api-client/contracts/http'
import { initI18n } from '@/src/lib/i18n'
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
