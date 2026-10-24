import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import * as ReactNative from 'react-native'
import { CommunityCommentsState } from '@couture/api-client'
import type { CommunityCommentSubmission } from '@couture/api-client/contracts/http'
import {
  createCommunityComment,
  createCommunityCommentSubmission,
} from '@couture/testing/factories/community.factory'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import {
  communityCommentsRootsFromMobile,
  communityCommentsRepliesFromMobile,
  communityCommentsSubmissionsFromMobile,
  communityCommentsCreateFromMobile,
  communityCommentsDeleteFromMobile,
  communityCommentsReportFromMobile,
  communityFailureReason,
} from '@/src/lib/community'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { CommunityCommentDrafts } from '@/src/features/community/community-comment-drafts'
import { press } from '@/src/test-utils/press'
import { CommunityCommentsSheet } from './community-comments-sheet'

/**
 * Native node handles stand in for reactTags: each distinct host node gets its own
 * number, so a focus call on the sheet title cannot pass for one on the private
 * status row. `nodeHandle(element)` returns the handle the sheet received for it.
 */
const nodeHandle = vi.hoisted(() => {
  const handles = new WeakMap<object, number>()
  let next = 1000
  return (node: unknown): number | null => {
    if (!node || typeof node !== 'object') return null
    if (!handles.has(node)) handles.set(node, next++)
    return handles.get(node) ?? null
  }
})
vi.mock('@/src/lib/accessibility-focus', () => ({
  safeFindNodeHandle: (node: unknown) => nodeHandle(node),
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNative>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
  }
})
const { announceForAccessibility, setAccessibilityFocus } = ReactNative.AccessibilityInfo
const root = createCommunityComment({ id: 'root', replyCount: 1 })
// The factory's own author and body, joined the way every entry names its actions.
const ROOT_CONTEXT = 'Style Explorer A1B2C3D4. A lovely layered look.'
const POST_ID = root.postId
const MEMBER = 'member-a'
const base = `*/api/v1/community/posts/${POST_ID}`
const page = (items = [root]) => ({
  data: { items, nextCursor: null, snapshot: 2, hasNewer: false },
})
const submissionsPage = (
  items: CommunityCommentSubmission[] = [],
  nextCursor: string | null = null
) => ({ data: { items, nextCursor } })
const reportReceipt = () => ({
  data: {
    reported: true,
    acceptedAt: '2026-10-19T12:00:00.000Z',
    routedAt: '2026-10-19T12:00:00.000Z',
    reviewDueAt: '2026-10-20T12:00:00.000Z',
  },
})
const makeState = () =>
  new CommunityCommentsState(
    {
      roots: communityCommentsRootsFromMobile,
      replies: communityCommentsRepliesFromMobile,
      submissions: communityCommentsSubmissionsFromMobile,
      create: communityCommentsCreateFromMobile,
      delete: communityCommentsDeleteFromMobile,
      report: communityCommentsReportFromMobile,
    },
    () => '00000000-0000-4000-8000-000000000064',
    communityFailureReason
  )
const sheet = ({
  state,
  onClose = vi.fn(),
  postId = POST_ID,
  drafts = new CommunityCommentDrafts(),
  member = MEMBER,
}: {
  state: CommunityCommentsState
  onClose?: () => void
  postId?: string | null
  drafts?: CommunityCommentDrafts
  member?: string | null
}) => (
  <CommunityCommentsSheet
    postId={postId}
    state={state}
    drafts={drafts}
    member={member}
    locale="en-US"
    onClose={onClose}
  />
)
const renderSheet = (options: { onClose?: () => void } = {}) =>
  render(sheet({ state: makeState(), ...options }))
const sheetTitle = () => screen.getByRole('heading', { name: 'Comments' })
const privateStatus = () =>
  screen.getByRole('heading', { name: 'Your submissions. Only you can see these.' })

let restore: (() => void) | undefined
beforeAll(() => initI18n())
beforeEach(async () => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', window.location.origin)
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  await i18n.changeLanguage('en-US')
  restore = setMobileAccessTokenResolver(() => 'synthetic-token')
  server.use(
    http.get(`${base}/comments`, () => HttpResponse.json(page())),
    http.get(`${base}/comment-submissions`, () => HttpResponse.json(submissionsPage()))
  )
})
afterEach(() => {
  restore?.()
  vi.unstubAllEnvs()
})

describe('Story 6.4 native comments sheet through real wrappers', () => {
  it.each([
    [409, 'You already reported this comment for a different reason.', 'reason_changed'],
    [403, 'You cannot report your own comment.', 'self_report'],
  ] as const)(
    'classifies comment report HTTP %s "%s" as %s through the real transport',
    async (status, message, reason) => {
      server.use(
        http.post(`${base}/comments/root/report`, () =>
          HttpResponse.json(
            {
              statusCode: status,
              error: status === 409 ? 'Conflict' : 'Forbidden',
              message,
            },
            { status }
          )
        )
      )
      await expect(
        communityCommentsReportFromMobile(POST_ID, 'root', 'spam')
      ).rejects.toMatchObject({ reason, httpStatus: status, message })
    }
  )

  it('pages through root, reply and private submission pages', async () => {
    const secondRoot = createCommunityComment({
      id: 'root-next',
      body: 'Next root page',
      publicationSequence: 3,
    })
    const firstReply = createCommunityComment({
      id: 'reply-first',
      parentId: root.id,
      body: 'First reply page',
      publicationSequence: 2,
    })
    const secondReply = createCommunityComment({
      id: 'reply-next',
      parentId: root.id,
      body: 'Next reply page',
      publicationSequence: 4,
    })
    const firstPrivate = createCommunityCommentSubmission({
      id: 'private-first',
      body: 'First private page',
    })
    const secondPrivate = createCommunityCommentSubmission({
      id: 'private-next',
      body: 'Next private page',
    })
    server.use(
      http.get(`${base}/comments`, ({ request }) =>
        HttpResponse.json({
          data: {
            items: new URL(request.url).searchParams.has('cursor')
              ? [secondRoot]
              : [root],
            nextCursor: new URL(request.url).searchParams.has('cursor')
              ? null
              : 'roots-next',
            snapshot: 4,
            hasNewer: false,
          },
        })
      ),
      http.get(`${base}/comments/root/replies`, ({ request }) =>
        HttpResponse.json({
          data: {
            items: new URL(request.url).searchParams.has('cursor')
              ? [secondReply]
              : [firstReply],
            nextCursor: new URL(request.url).searchParams.has('cursor')
              ? null
              : 'replies-next',
            snapshot: 4,
            hasNewer: false,
          },
        })
      ),
      http.get(`${base}/comment-submissions`, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('cursor')
            ? submissionsPage([secondPrivate])
            : submissionsPage([firstPrivate], 'private-next')
        )
      )
    )
    renderSheet()
    press(await screen.findByRole('button', { name: 'More comments' }))
    expect(await screen.findByText('Next root page')).toBeVisible()
    const entry = within(screen.getByTestId('comment-root'))
    press(entry.getByRole('button', { name: `Replies (1): ${ROOT_CONTEXT}` }))
    press(await screen.findByRole('button', { name: 'More replies' }))
    expect(await screen.findByText('Next reply page')).toBeVisible()
    press(screen.getByRole('button', { name: 'More submissions' }))
    expect(await screen.findByText('Next private page')).toBeVisible()
  })

  it('cancels a reply draft and drops its reply target', async () => {
    // The file-level beforeEach serves the one-root page and an empty private list.
    renderSheet()
    const entry = within(await screen.findByTestId('comment-root'))
    press(entry.getByRole('button', { name: `Reply: ${ROOT_CONTEXT}` }))
    expect(screen.getByText(`Replying to a comment: ${ROOT_CONTEXT}`)).toBeVisible()
    press(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByText(`Replying to a comment: ${ROOT_CONTEXT}`)
    ).not.toBeInTheDocument()
  })

  it('submits the default report reason after a cancelled draft report picked another', async () => {
    const reports: unknown[] = []
    server.use(
      http.post(`${base}/comments/root/report`, async ({ request }) => {
        reports.push(await request.json())
        return HttpResponse.json(reportReceipt())
      })
    )
    renderSheet()
    const entry = within(await screen.findByTestId('comment-root'))
    press(entry.getByRole('button', { name: `Report: ${ROOT_CONTEXT}` }))
    press(screen.getByRole('radio', { name: 'Harassment or bullying' }))
    press(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Send report' })).not.toBeInTheDocument()
    press(entry.getByRole('button', { name: `Report: ${ROOT_CONTEXT}` }))
    press(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() =>
      expect(announceForAccessibility).toHaveBeenCalledWith('Report received.')
    )
    expect(reports).toEqual([{ reason: 'spam' }])
  })

  it('retains a failed report and selected reason until retry succeeds', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${base}/comments/root/report`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(reportReceipt())
      })
    )
    renderSheet()
    press(await screen.findByRole('button', { name: `Report: ${ROOT_CONTEXT}` }))
    press(screen.getByRole('radio', { name: 'Harassment or bullying' }))
    press(screen.getByRole('button', { name: 'Send report' }))
    await screen.findByText('Comments could not be updated. Try again.')
    // B8/O-LM1: a rejected report keeps its form and chosen reason for the retry.
    expect(screen.getByRole('button', { name: 'Send report' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Harassment or bullying' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Spam or misleading' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    press(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Send report' })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByText('Comments could not be updated. Try again.')
    ).not.toBeInTheDocument()
    expect(bodies).toEqual([{ reason: 'harassment' }, { reason: 'harassment' }])
    expect(vi.mocked(announceForAccessibility).mock.calls).toEqual([
      ['Comments could not be updated. Try again.'],
      ['Report received.'],
    ])
  })

  it('keeps a newer report form open when an earlier report is accepted', async () => {
    const secondRoot = createCommunityComment({
      id: 'root-two',
      author: 'Style Explorer E5F6G7H8',
      body: 'Linen trousers for a humid evening.',
      publicationSequence: 2,
    })
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const reports: { target: string; body: unknown }[] = []
    server.use(
      http.get(`${base}/comments`, () => HttpResponse.json(page([root, secondRoot]))),
      http.post(`${base}/comments/:commentId/report`, async ({ params, request }) => {
        reports.push({ target: String(params.commentId), body: await request.json() })
        if (params.commentId === root.id) await firstHeld
        return HttpResponse.json(reportReceipt())
      })
    )
    try {
      renderSheet()
      await screen.findByText('A lovely layered look.')
      const title = nodeHandle(sheetTitle())
      await waitFor(() => expect(setAccessibilityFocus).toHaveBeenCalledWith(title))

      press(screen.getByRole('button', { name: `Report: ${ROOT_CONTEXT}` }))
      press(screen.getByRole('button', { name: 'Send report' }))
      await waitFor(() =>
        expect(reports).toEqual([{ target: root.id, body: { reason: 'spam' } }])
      )
      press(
        screen.getByRole('button', {
          name: 'Report: Style Explorer E5F6G7H8. Linen trousers for a humid evening.',
        })
      )
      const newer = within(screen.getByTestId('comment-root-two'))
      press(newer.getByRole('radio', { name: 'Harassment or bullying' }))

      releaseFirst()
      // Completion barrier: the sheet announces A's acceptance from its effect.
      await waitFor(() =>
        expect(vi.mocked(announceForAccessibility).mock.calls).toEqual([
          ['Report received.'],
        ])
      )
      expect(newer.getByRole('button', { name: 'Send report' })).toBeVisible()
      expect(
        newer.getByRole('radio', { name: 'Harassment or bullying' })
      ).toHaveAttribute('aria-checked', 'true')
      expect(vi.mocked(setAccessibilityFocus).mock.calls).toEqual([[title]])
      expect(reports).toHaveLength(1)
    } finally {
      releaseFirst()
    }
  })

  it('starts each newly selected report target on the default reason', async () => {
    const secondRoot = createCommunityComment({
      id: 'root-two',
      author: 'Style Explorer E5F6G7H8',
      body: 'Linen trousers for a humid evening.',
      publicationSequence: 2,
    })
    const reports: { target: string; body: unknown }[] = []
    server.use(
      http.get(`${base}/comments`, () => HttpResponse.json(page([root, secondRoot]))),
      http.post(`${base}/comments/:commentId/report`, async ({ params, request }) => {
        reports.push({ target: String(params.commentId), body: await request.json() })
        return HttpResponse.json(reportReceipt())
      })
    )
    renderSheet()
    press(await screen.findByRole('button', { name: `Report: ${ROOT_CONTEXT}` }))
    press(screen.getByRole('radio', { name: 'Harassment or bullying' }))
    press(
      screen.getByRole('button', {
        name: 'Report: Style Explorer E5F6G7H8. Linen trousers for a humid evening.',
      })
    )
    const form = within(screen.getByTestId('comment-root-two'))
    expect(form.getByRole('radio', { name: 'Spam or misleading' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(form.getByRole('radio', { name: 'Harassment or bullying' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getAllByRole('button', { name: 'Send report' })).toHaveLength(1)
    press(form.getByRole('button', { name: 'Send report' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Send report' })
      ).not.toBeInTheDocument()
    )
    expect(reports).toEqual([{ target: 'root-two', body: { reason: 'spam' } }])
  })

  it('keeps author deletion available on an own unavailable public placeholder', async () => {
    server.use(
      http.get(`${base}/comments`, () =>
        HttpResponse.json(
          page([{ ...root, isOwn: true, unavailable: true, body: null, author: null }])
        )
      ),
      http.get(`${base}/comment-submissions`, () =>
        HttpResponse.json(
          submissionsPage([
            createCommunityCommentSubmission({
              id: root.id,
              status: 'consent_suspended',
              body: null,
            }),
          ])
        )
      ),
      http.delete(`${base}/comments/root`, () =>
        HttpResponse.json({
          data: createCommunityCommentSubmission({
            id: root.id,
            status: 'author_deleted',
            body: null,
          }),
        })
      )
    )
    renderSheet()
    await screen.findByText('Unavailable.')
    press(screen.getByRole('button', { name: 'Delete: Unavailable.' }))
    await waitFor(() =>
      expect(announceForAccessibility).toHaveBeenCalledWith('Comment deleted.')
    )
  })

  it('names its close target and hands closure to the owner', async () => {
    const close = vi.fn()
    renderSheet({ onClose: close })
    press(await screen.findByRole('button', { name: 'Close comments' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('focuses the title on open, the private status after submit, and announces once across reopen', async () => {
    const pending = createCommunityCommentSubmission()
    let privateItems: CommunityCommentSubmission[] = []
    server.use(
      http.get(`${base}/comment-submissions`, () =>
        HttpResponse.json(submissionsPage(privateItems))
      ),
      http.post(`${base}/comments`, () => {
        privateItems = [pending]
        return HttpResponse.json({ data: pending })
      })
    )
    const state = makeState()
    const view = render(sheet({ state }))
    await screen.findByText('A lovely layered look.')
    const firstTitle = nodeHandle(sheetTitle())
    await waitFor(() => expect(setAccessibilityFocus).toHaveBeenCalledWith(firstTitle))

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'A lovely layered look.' },
    })
    press(screen.getByRole('button', { name: 'Send comment' }))
    const submission = within(
      await screen.findByTestId(`comment-submission-${pending.id}`)
    )
    expect(submission.getByText('Screening. Only you can see this.')).toBeVisible()
    const status = nodeHandle(privateStatus())
    expect(status).not.toBe(firstTitle)
    await waitFor(() =>
      expect(vi.mocked(setAccessibilityFocus).mock.calls).toEqual([
        [firstTitle],
        [status],
      ])
    )
    expect(vi.mocked(announceForAccessibility).mock.calls).toEqual([
      ['Comment submitted for screening.'],
    ])
    // The announcement is spoken, never drawn as a second visible copy of the status.
    expect(screen.queryByText('Comment submitted for screening.')).not.toBeInTheDocument()

    view.rerender(sheet({ state, postId: null }))
    expect(
      screen.queryByRole('button', { name: 'Close comments' })
    ).not.toBeInTheDocument()
    view.rerender(sheet({ state }))
    await screen.findByTestId(`comment-submission-${pending.id}`)
    const reopenedTitle = nodeHandle(sheetTitle())
    expect(reopenedTitle).not.toBe(firstTitle)
    await waitFor(() =>
      expect(vi.mocked(setAccessibilityFocus).mock.calls).toEqual([
        [firstTitle],
        [status],
        [reopenedTitle],
      ])
    )
    expect(announceForAccessibility).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Comment submitted for screening.')).not.toBeInTheDocument()
  })

  it('deletes an own pending submission from the private status list', async () => {
    const pending = createCommunityCommentSubmission()
    server.use(
      http.post(`${base}/comments`, () => HttpResponse.json({ data: pending })),
      http.delete(`${base}/comments/${pending.id}`, () =>
        HttpResponse.json({ data: { ...pending, status: 'author_deleted', body: null } })
      )
    )
    renderSheet()
    fireEvent.change(await screen.findByLabelText('Add a comment'), {
      target: { value: 'A lovely layered look.' },
    })
    press(screen.getByRole('button', { name: 'Send comment' }))
    const submission = within(
      await screen.findByTestId(`comment-submission-${pending.id}`)
    )
    press(submission.getByRole('button', { name: 'Delete' }))
    expect(await submission.findByText('Deleted.')).toBeVisible()
    expect(submission.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('shows the recovery copy on held and blocked submissions, then deletes and resubmits', async () => {
    const held = createCommunityCommentSubmission({
      id: 'private-held',
      status: 'held_for_review',
      body: 'Held wording.',
    })
    const blocked = createCommunityCommentSubmission({
      id: 'private-blocked',
      status: 'blocked',
      body: 'Blocked wording.',
    })
    const resubmitted = createCommunityCommentSubmission({
      id: 'private-resubmitted',
      body: 'A kinder second try.',
    })
    const created: unknown[] = []
    server.use(
      http.get(`${base}/comment-submissions`, () =>
        HttpResponse.json(submissionsPage([held, blocked]))
      ),
      http.delete(`${base}/comments/${blocked.id}`, () =>
        HttpResponse.json({ data: { ...blocked, status: 'author_deleted', body: null } })
      ),
      http.post(`${base}/comments`, async ({ request }) => {
        created.push(await request.json())
        return HttpResponse.json({ data: resubmitted })
      })
    )
    renderSheet()
    const recovery = 'Delete this submission and try again with a new comment.'
    const heldRow = within(await screen.findByTestId('comment-submission-private-held'))
    expect(heldRow.getByText('Held for review. Only you can see this.')).toBeVisible()
    expect(heldRow.getByText(recovery)).toBeVisible()
    expect(heldRow.getByRole('button', { name: 'Delete' })).toBeVisible()
    const blockedRow = within(screen.getByTestId('comment-submission-private-blocked'))
    expect(
      blockedRow.getByText('Withheld by screening. Only you can see this.')
    ).toBeVisible()
    expect(blockedRow.getByText(recovery)).toBeVisible()

    press(blockedRow.getByRole('button', { name: 'Delete' }))
    expect(await blockedRow.findByText('Deleted.')).toBeVisible()
    expect(blockedRow.queryByText(recovery)).not.toBeInTheDocument()
    expect(blockedRow.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'A kinder second try.' },
    })
    press(screen.getByRole('button', { name: 'Send comment' }))
    const resubmittedRow = within(
      await screen.findByTestId('comment-submission-private-resubmitted')
    )
    expect(resubmittedRow.getByText('Screening. Only you can see this.')).toBeVisible()
    expect(created).toEqual([
      expect.objectContaining({ body: 'A kinder second try.', parentId: null }),
    ])
    expect(vi.mocked(announceForAccessibility).mock.calls).toEqual([
      ['Comment deleted.'],
      ['Comment submitted for screening.'],
    ])
  })

  it('keeps Send and Cancel usable beside a maximum-length reply context', async () => {
    // Device check for root: real software-keyboard overflow is only judged on a device.
    const longBody = 'Layered charcoal wool over a cream merino knit and boots. '
      .repeat(5)
      .slice(0, 279)
      .concat('.')
    const longAlias = 'Style Explorer Wandering Through Autumn Layers Z9Y8X7W6'
    const longRoot = createCommunityComment({
      id: 'root-long',
      author: longAlias,
      body: longBody,
    })
    const created: unknown[] = []
    server.use(
      http.get(`${base}/comments`, () => HttpResponse.json(page([longRoot]))),
      http.post(`${base}/comments`, async ({ request }) => {
        created.push(await request.json())
        return HttpResponse.json({
          data: createCommunityCommentSubmission({
            id: 'private-long-reply',
            parentId: longRoot.id,
            body: 'Agreed.',
          }),
        })
      })
    )
    expect(longBody).toHaveLength(280)
    renderSheet()
    const context = `${longAlias}. ${longBody}`
    const replyTo = await screen.findByRole('button', { name: `Reply: ${context}` })
    press(replyTo)
    expect(screen.getByText(`Replying to a comment: ${context}`)).toBeVisible()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toBeVisible()
    expect(cancel).not.toHaveAttribute('aria-disabled', 'true')
    press(cancel)
    expect(
      screen.queryByText(`Replying to a comment: ${context}`)
    ).not.toBeInTheDocument()

    press(replyTo)
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Agreed.' },
    })
    const send = screen.getByRole('button', { name: 'Send comment' })
    expect(send).toBeVisible()
    expect(send).not.toHaveAttribute('aria-disabled', 'true')
    press(send)
    await screen.findByTestId('comment-submission-private-long-reply')
    expect(created).toEqual([
      expect.objectContaining({ body: 'Agreed.', parentId: longRoot.id }),
    ])
  })

  it('loads replies on demand and reports an unavailable reply placeholder', async () => {
    const reply = createCommunityComment({
      id: 'reply',
      parentId: root.id,
      body: null,
      author: null,
      unavailable: true,
      publicationSequence: 2,
    })
    const reports: unknown[] = []
    server.use(
      http.get(`${base}/comments/root/replies`, () => HttpResponse.json(page([reply]))),
      http.post(`${base}/comments/reply/report`, async ({ request }) => {
        reports.push(await request.json())
        return HttpResponse.json(reportReceipt())
      })
    )
    renderSheet()
    press(await screen.findByRole('button', { name: `Replies (1): ${ROOT_CONTEXT}` }))
    const replyEntry = within(await screen.findByTestId('comment-reply'))
    expect(replyEntry.getByText('Unavailable.')).toBeVisible()
    press(replyEntry.getByRole('button', { name: 'Report: Unavailable.' }))
    press(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() =>
      expect(announceForAccessibility).toHaveBeenCalledWith('Report received.')
    )
    expect(reports).toEqual([{ reason: 'spam' }])
  })

  it('retains a draft across closure and reopen', async () => {
    const state = makeState()
    const view = render(sheet({ state }))
    fireEvent.change(await screen.findByLabelText('Add a comment'), {
      target: { value: 'Saved draft' },
    })
    view.rerender(sheet({ state, postId: null }))
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument()
    view.rerender(sheet({ state }))
    await waitFor(() =>
      expect(screen.getByLabelText('Add a comment')).toHaveValue('Saved draft')
    )
  })
})

it('R07 moves a removed notification target to the stable thread landmark once', async () => {
  let visible = true
  server.use(
    http.get(`${base}/comments`, () => HttpResponse.json(page(visible ? [root] : [])))
  )
  const state = makeState()
  render(
    <CommunityCommentsSheet
      postId={POST_ID}
      state={state}
      drafts={new CommunityCommentDrafts()}
      member={MEMBER}
      locale="en-US"
      onClose={vi.fn()}
      target={{
        commentId: root.id,
        parentId: null,
        pageCursor: null,
        parentPageCursor: null,
      }}
    />
  )
  await waitFor(() =>
    expect(setAccessibilityFocus).toHaveBeenCalledWith(
      nodeHandle(screen.getByTestId('comment-root'))
    )
  )
  const before = vi.mocked(announceForAccessibility).mock.calls.length
  visible = false
  await state.refresh(POST_ID)
  await waitFor(() => expect(screen.queryByTestId('comment-root')).toBeNull())
  expect(setAccessibilityFocus).toHaveBeenLastCalledWith(nodeHandle(sheetTitle()))
  expect(vi.mocked(announceForAccessibility).mock.calls.slice(before)).toEqual([
    ['Unavailable.'],
  ])
  await state.refresh(POST_ID)
  expect(vi.mocked(announceForAccessibility).mock.calls.slice(before)).toEqual([
    ['Unavailable.'],
  ])
})

/**
 * Story 6.5 R46: an unverified-access hide unmounts the sheet while the member types
 * (the screen passes a null post), and a reset or eviction meanwhile wipes the shared
 * comment state. Only the screen's in-memory drafts can give the comment back.
 */
describe('R46 unsent comment across an unverified-access hide', () => {
  /** Types into the composer, hides the sheet, wipes the comment state, shows it again. */
  async function typeHideWipeAndReturn({
    focused,
    member = MEMBER,
  }: {
    focused: boolean
    member?: string
  }) {
    const state = makeState()
    const drafts = new CommunityCommentDrafts()
    const view = render(sheet({ state, drafts }))
    await screen.findByText('A lovely layered look.')
    const composer = screen.getByTestId<HTMLInputElement>('comment-body')
    composer.focus()
    fireEvent.change(composer, { target: { value: 'Half a thought about the coat' } })
    if (!focused) composer.blur()
    expect(document.activeElement === composer).toBe(focused)

    view.rerender(sheet({ state, drafts, postId: null }))
    expect(screen.queryByTestId('comment-body')).toBeNull()
    act(() => state.reset())
    view.rerender(sheet({ state, drafts, member }))
    await screen.findByText('A lovely layered look.')
    return {
      state,
      drafts,
      view,
      composer: screen.getByTestId<HTMLInputElement>('comment-body'),
    }
  }

  it('restores the draft and the composer focus it had when the sheet unmounted', async () => {
    const { composer } = await typeHideWipeAndReturn({ focused: true })
    expect(composer).toHaveValue('Half a thought about the coat')
    await waitFor(() => expect(document.activeElement).toBe(composer))
  })

  it('restores a draft whose composer was not focused without taking focus', async () => {
    const { composer } = await typeHideWipeAndReturn({ focused: false })
    expect(composer).toHaveValue('Half a thought about the coat')
    // The sheet opens on its title, as for any other open.
    await waitFor(() =>
      expect(setAccessibilityFocus).toHaveBeenLastCalledWith(nodeHandle(sheetTitle()))
    )
    expect(document.activeElement).not.toBe(composer)
  })

  it('never gives one member the draft of another', async () => {
    const { composer, drafts } = await typeHideWipeAndReturn({
      focused: true,
      member: 'member-b',
    })
    expect(composer).toHaveValue('')
    expect(document.activeElement).not.toBe(composer)
    expect(drafts.restore('member-b', POST_ID)).toBeNull()
  })

  it('drops the draft when the member closes the sheet', async () => {
    const state = makeState()
    const drafts = new CommunityCommentDrafts()
    const close = vi.fn()
    const view = render(sheet({ state, drafts, onClose: close }))
    await screen.findByText('A lovely layered look.')
    const composer = screen.getByTestId<HTMLInputElement>('comment-body')
    composer.focus()
    fireEvent.change(composer, { target: { value: 'Never mind' } })
    press(screen.getByTestId('comments-close'))
    expect(close).toHaveBeenCalledOnce()

    view.rerender(sheet({ state, drafts, onClose: close, postId: null }))
    act(() => state.reset())
    view.rerender(sheet({ state, drafts, onClose: close }))
    await screen.findByText('A lovely layered look.')
    expect(screen.getByTestId('comment-body')).toHaveValue('')
    expect(document.activeElement).not.toBe(screen.getByTestId('comment-body'))
    expect(drafts.restore(MEMBER, POST_ID)).toBeNull()
  })

  it('drops the draft once the comment is accepted', async () => {
    let posted = 0
    server.use(
      http.post(`${base}/comments`, () => {
        posted++
        return HttpResponse.json({
          data: createCommunityCommentSubmission({ body: 'Sent for good' }),
        })
      })
    )
    const state = makeState()
    const drafts = new CommunityCommentDrafts()
    const view = render(sheet({ state, drafts }))
    await screen.findByText('A lovely layered look.')
    fireEvent.change(screen.getByTestId('comment-body'), {
      target: { value: 'Sent for good' },
    })
    expect(drafts.restore(MEMBER, POST_ID)?.body).toBe('Sent for good')
    press(screen.getByRole('button', { name: 'Send comment' }))
    await waitFor(() => expect(screen.getByTestId('comment-body')).toHaveValue(''))
    expect(posted).toBe(1)
    expect(drafts.restore(MEMBER, POST_ID)).toBeNull()

    view.rerender(sheet({ state, drafts, postId: null }))
    act(() => state.reset())
    view.rerender(sheet({ state, drafts }))
    await screen.findByText('A lovely layered look.')
    expect(screen.getByTestId('comment-body')).toHaveValue('')
  })
})
