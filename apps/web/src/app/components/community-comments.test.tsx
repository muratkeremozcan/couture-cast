import { useState } from 'react'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  type CommunityCommentSubmission,
} from '@couture/api-client/contracts/http'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommunityCommentsState } from '@couture/api-client'
import {
  createCommunityComment,
  createCommunityCommentSubmission,
} from '@couture/testing'
import { CommunityComments } from './community-comments'
import { AccessibleModal } from './accessible-modal'
import {
  communityCommentsRootsFromWeb,
  communityCommentsRepliesFromWeb,
  communityCommentsSubmissionsFromWeb,
  communityCommentsCreateFromWeb,
  communityCommentsDeleteFromWeb,
  communityCommentsReportFromWeb,
  communityFailureReason,
} from '../../lib/community'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { signIn } from '../../test-utils/community-lookbook-grid'

const base = '*/api/v1/community/posts/community-post-1'
const root = createCommunityComment({ id: 'root', replyCount: 1 })
const reply = createCommunityComment({
  id: 'reply',
  parentId: 'root',
  publicationSequence: 2,
  body: 'Original reply body.',
})
// Contextual action names are "<Action>: <author>. <body>" (community-comments.tsx L67-72).
const rootContext = `${root.author}. ${root.body}`
const page = (items = [root]) => ({
  data: { items, snapshot: 2, nextCursor: null, hasNewer: false },
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
const makeState = (newId = () => '00000000-0000-4000-8000-000000000001') =>
  new CommunityCommentsState(
    {
      roots: communityCommentsRootsFromWeb,
      replies: communityCommentsRepliesFromWeb,
      submissions: communityCommentsSubmissionsFromWeb,
      create: communityCommentsCreateFromWeb,
      delete: communityCommentsDeleteFromWeb,
      report: communityCommentsReportFromWeb,
    },
    newId,
    communityFailureReason
  )
function Journey({ state }: { state: CommunityCommentsState }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen((value) => !value)}>
        {open ? 'Close thread' : 'Open thread'}
      </button>
      {open && <CommunityComments postId="community-post-1" state={state} />}
    </>
  )
}
/** Completion barrier: wait for every state read a spy has started so far. */
async function settle(spy: { mock: { results: { value: unknown }[] } }) {
  await act(async () => {
    await Promise.all(spy.mock.results.map((result) => result.value))
  })
}
function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  signIn()
  useMswHandlers(
    http.get(`${base}/comment-submissions`, () => HttpResponse.json(submissionsPage()))
  )
})

describe('Story 6.4 rendered comments through real web wrappers', () => {
  it('R07 moves a removed focused target to the thread landmark once', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    let visible = true
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page(visible ? [root] : [])))
    )
    const state = makeState()
    render(
      <CommunityComments
        postId="community-post-1"
        state={state}
        target={{
          commentId: root.id,
          parentId: null,
          pageCursor: null,
          parentPageCursor: null,
        }}
      />
    )
    await waitFor(() => expect(screen.getByTestId('comment-root')).toHaveFocus())
    visible = false
    await act(async () => {
      await state.refresh('community-post-1')
    })
    expect(screen.queryByTestId('comment-root')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Comments' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable.')
  })

  it('R07 keeps composer focus when its previously focused target is removed', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    let visible = true
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page(visible ? [root] : [])))
    )
    const state = makeState()
    render(
      <CommunityComments
        postId="community-post-1"
        state={state}
        target={{
          commentId: root.id,
          parentId: null,
          pageCursor: null,
          parentPageCursor: null,
        }}
      />
    )
    await waitFor(() => expect(screen.getByTestId('comment-root')).toHaveFocus())
    const composer = screen.getByRole('textbox', { name: 'Add a comment' })
    composer.focus()
    fireEvent.change(composer, { target: { value: 'Keep writing' } })
    visible = false
    await act(async () => {
      await state.refresh('community-post-1')
    })
    expect(composer).toHaveFocus()
    expect(composer).toHaveValue('Keep writing')
  })
  it.each([
    [409, 'You already reported this comment for a different reason.', 'reason_changed'],
    [403, 'You cannot report your own comment.', 'self_report'],
  ] as const)(
    'classifies comment report HTTP %s "%s" as %s through the real transport',
    async (status, message, reason) => {
      useMswHandlers(
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
        communityCommentsReportFromWeb('community-post-1', 'root', 'spam')
      ).rejects.toMatchObject({ reason, httpStatus: status, message })
    }
  )

  it('6.7b-WEB-080 names a published comment whose author has no alias with the card fallback rule', async () => {
    // The contract lets an available comment carry `author: null` (an author with
    // no community alias); the thread applies the card rule so every entry names
    // someone: "You" for the viewer, the localized fallback for anyone else.
    const nameless = createCommunityComment({
      id: 'root-nameless',
      author: null,
      isOwn: false,
      body: 'Seeded long root without an alias.',
      publicationSequence: 2,
    })
    const ownNameless = createCommunityComment({
      id: 'root-own',
      author: null,
      isOwn: true,
      body: 'My own look notes.',
      publicationSequence: 3,
    })
    useMswHandlers(
      http.get(`${base}/comments`, () =>
        HttpResponse.json(page([root, nameless, ownNameless]))
      )
    )
    render(<Journey state={makeState()} />)

    const other = within(await screen.findByTestId('comment-root-nameless'))
    expect(other.getByText('Style explorer')).toBeVisible()
    expect(within(screen.getByTestId('comment-root-own')).getByText('You')).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'Reply: Style explorer. Seeded long root without an alias.',
      })
    ).toBeVisible()
    expect(
      within(screen.getByTestId('comment-root')).getByText(root.author!)
    ).toBeVisible()
  })

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
    useMswHandlers(
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
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    await user.click(await screen.findByRole('button', { name: 'More comments' }))
    expect(await screen.findByText('Next root page')).toBeVisible()
    const entry = within(screen.getByTestId('comment-root'))
    await user.click(entry.getByRole('button', { name: `Replies (1): ${rootContext}` }))
    await user.click(await screen.findByRole('button', { name: 'More replies' }))
    expect(await screen.findByText('Next reply page')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'More submissions' }))
    expect(await screen.findByText('Next private page')).toBeVisible()
  })

  it('cancels a reply draft and drops its reply target', async () => {
    useMswHandlers(http.get(`${base}/comments`, () => HttpResponse.json(page())))
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    const entry = within(await screen.findByTestId('comment-root'))
    await user.click(entry.getByRole('button', { name: `Reply: ${rootContext}` }))
    expect(screen.getByText(`Replying to a comment: ${rootContext}`)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByText(`Replying to a comment: ${rootContext}`)
    ).not.toBeInTheDocument()
  })

  it('submits the default report reason after a cancelled draft report picked another', async () => {
    const reports: unknown[] = []
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page())),
      http.post(`${base}/comments/root/report`, async ({ request }) => {
        reports.push(await request.json())
        return HttpResponse.json(reportReceipt())
      })
    )
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    const entry = within(await screen.findByTestId('comment-root'))
    await user.click(entry.getByRole('button', { name: `Report: ${rootContext}` }))
    await user.selectOptions(screen.getByRole('combobox'), 'harassment')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Send report' })).not.toBeInTheDocument()
    await user.click(entry.getByRole('button', { name: `Report: ${rootContext}` }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('Report received.')).toBeVisible()
    expect(reports).toEqual([{ reason: 'spam' }])
  })

  it('releases a confirmed rejected reply so a corrected root uses a new intent', async () => {
    const requests: { body: string; parentId: string | null; mutationId: string }[] = []
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page())),
      http.post(`${base}/comments`, async ({ request }) => {
        const body = (await request.json()) as (typeof requests)[number]
        requests.push(body)
        return requests.length === 1
          ? HttpResponse.json(
              {
                message: COMMUNITY_AGE_GATE_DENIED_MESSAGE,
                statusCode: 403,
                error: 'Forbidden',
              },
              { status: 403 }
            )
          : HttpResponse.json({
              data: createCommunityCommentSubmission({
                id: 'corrected-root',
                body: body.body,
              }),
            })
      })
    )
    const user = userEvent.setup()
    let next = 1
    const state = makeState(
      () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
    )
    render(<Journey state={state} />)
    await user.click(await screen.findByRole('button', { name: `Reply: ${rootContext}` }))
    await user.type(screen.getByLabelText('Add a comment'), 'Rejected reply')
    await user.click(screen.getByRole('button', { name: 'Send comment' }))
    // The age-gate refusal names its cause; it is not the generic failure copy.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^You need to be at least 13 to post to the community\.$/
    )
    expect(
      screen.queryByRole('button', { name: 'Retry submission' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.clear(screen.getByLabelText('Add a comment'))
    await user.type(screen.getByLabelText('Add a comment'), 'Corrected root')
    await user.click(screen.getByRole('button', { name: 'Send comment' }))
    expect(
      within(await screen.findByTestId('comment-submission-corrected-root')).getByText(
        'Corrected root'
      )
    ).toBeVisible()
    expect(requests[1]).toMatchObject({ body: 'Corrected root', parentId: null })
    expect(requests[1]?.mutationId).not.toBe(requests[0]?.mutationId)
  })

  it('keeps a failed report open with its selected reason and closes only after acceptance', async () => {
    const bodies: unknown[] = []
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page())),
      http.post(`${base}/comments/root/report`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? HttpResponse.error()
          : HttpResponse.json(reportReceipt())
      })
    )
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    const trigger = await screen.findByRole('button', { name: `Report: ${rootContext}` })
    await user.click(trigger)
    const reason = screen.getByRole('combobox', { name: 'Reason for the report' })
    expect(reason).toHaveFocus()
    await user.selectOptions(reason, 'harassment')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Comments could not be updated\. Try again\.$/
    )
    expect(screen.getByRole('combobox')).toHaveValue('harassment')
    expect(screen.getByRole('button', { name: 'Send report' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    await screen.findByText('Report received.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(bodies).toEqual([{ reason: 'harassment' }, { reason: 'harassment' }])
  })

  it('applies private consent suppression to the visible own root before public deduplication', async () => {
    let suspended = false
    useMswHandlers(
      http.get(`${base}/comments`, () =>
        HttpResponse.json(page([{ ...root, isOwn: true }]))
      ),
      http.get(`${base}/comment-submissions`, () =>
        HttpResponse.json(
          submissionsPage([
            createCommunityCommentSubmission({
              id: root.id,
              status: suspended ? 'consent_suspended' : 'published',
              body: suspended ? null : root.body,
              publicationSequence: 1,
            }),
          ])
        )
      )
    )
    const state = makeState()
    render(<Journey state={state} />)
    expect(await screen.findByText(root.body!)).toBeVisible()
    suspended = true
    await act(async () => state.statuses('community-post-1'))
    expect(screen.queryByText(root.body!)).not.toBeInTheDocument()
    expect(screen.getByText('Unavailable.')).toBeVisible()
  })

  it('keeps keyboard focus inside the dialog after report cancel, reply cancel and final paging', async () => {
    useMswHandlers(
      http.get(`${base}/comments`, ({ request }) =>
        HttpResponse.json({
          data: {
            ...page().data,
            nextCursor: new URL(request.url).searchParams.has('cursor') ? null : 'next',
            items: [root],
          },
        })
      )
    )
    const close = vi.fn(),
      user = userEvent.setup()
    render(
      <AccessibleModal isOpen title="Look" titleId="keyboard-look" onClose={close}>
        <CommunityComments postId="community-post-1" state={makeState()} />
      </AccessibleModal>
    )
    const report = await screen.findByRole('button', { name: `Report: ${rootContext}` })
    await user.click(report)
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(report).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: `Reply: ${rootContext}` }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Add a comment')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'More comments' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Comments' })).toHaveFocus()
    )
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('keeps author deletion available on an own unavailable public placeholder', async () => {
    useMswHandlers(
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
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    await screen.findByText('Unavailable.')
    // An unavailable own entry has no author or body, so only the placeholder names it.
    await user.click(screen.getByRole('button', { name: 'Delete: Unavailable.' }))
    expect(await screen.findByText('Comment deleted.')).toBeVisible()
  })

  it('refreshes an expanded reply after another member deletes it', async () => {
    let removed = false
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page())),
      http.get(`${base}/comments/root/replies`, () =>
        HttpResponse.json(
          page([
            removed ? { ...reply, body: null, author: null, unavailable: true } : reply,
          ])
        )
      )
    )
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    await user.click(
      await screen.findByRole('button', { name: `Replies (1): ${rootContext}` })
    )
    expect(await screen.findByText('Original reply body.')).toBeVisible()
    // The second member's completed deletion is reflected by the authoritative API fixture.
    removed = true
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(screen.queryByText('Original reply body.')).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: `Replies (1): ${rootContext}` }))
    expect(await screen.findByText('Unavailable.')).toBeVisible()
  })

  it('discards an unexpanded reply read that finishes after closing and refreshing the thread', async () => {
    const delayed = deferred()
    let started = false
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page())),
      http.get(`${base}/comments/root/replies`, async () => {
        started = true
        await delayed.promise
        return HttpResponse.json(page([reply]))
      })
    )
    const user = userEvent.setup(),
      state = makeState(),
      reads = vi.spyOn(state, 'load')
    render(<Journey state={state} />)
    await user.click(
      await screen.findByRole('button', { name: `Replies (1): ${rootContext}` })
    )
    await waitFor(() => expect(started).toBe(true))
    const pending = reads.mock.results[1]!
    if (pending.type !== 'return') throw new Error('Reply read did not start')
    await user.click(screen.getByRole('button', { name: 'Close thread' }))
    await user.click(screen.getByRole('button', { name: 'Open thread' }))
    await waitFor(() => expect(state.current('community-post-1').loading).toBe(false))
    await act(async () => {
      delayed.resolve()
      await pending.value
    })
    expect(screen.queryByText('Original reply body.')).not.toBeInTheDocument()
    expect(state.current('community-post-1').replies.size).toBe(0)
  })

  it('keeps a reopened confirmed page when an older request returns 404', async () => {
    const older = deferred()
    let calls = 0
    useMswHandlers(
      http.get(`${base}/comments`, async () => {
        calls++
        if (calls === 1) {
          await older.promise
          return HttpResponse.json(
            { statusCode: 404, message: 'Community post not found.', error: 'Not Found' },
            { status: 404 }
          )
        }
        return HttpResponse.json(page())
      })
    )
    const user = userEvent.setup(),
      state = makeState(),
      reads = vi.spyOn(state, 'load')
    render(<Journey state={state} />)
    await waitFor(() => expect(calls).toBe(1))
    const stale = reads.mock.results[0]!
    if (stale.type !== 'return') throw new Error('First root read did not start')
    await user.click(screen.getByRole('button', { name: 'Close thread' }))
    await user.click(screen.getByRole('button', { name: 'Open thread' }))
    expect(await screen.findByText(root.body!)).toBeVisible()
    // Barrier: the older read has received its 404 and finished handling it,
    // so a 404 that evicted the reopened thread would already be rendered.
    await act(async () => {
      older.resolve()
      await stale.value
    })
    expect(calls).toBe(2)
    expect(screen.getByText(root.body!)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retains an edited draft and retry identity after closing an uncertain submission', async () => {
    const bodies: unknown[] = []
    let fail = true
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page([]))),
      http.post(`${base}/comments`, async ({ request }) => {
        bodies.push(await request.json())
        if (fail) return HttpResponse.error()
        return HttpResponse.json({
          data: createCommunityCommentSubmission({ body: 'First draft' }),
        })
      })
    )
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    const compose = await screen.findByLabelText('Add a comment')
    await user.type(compose, 'First draft')
    await user.click(screen.getByRole('button', { name: 'Send comment' }))
    await screen.findByRole('button', { name: 'Retry submission' })
    await user.clear(compose)
    await user.type(compose, 'Edited draft')
    await user.click(screen.getByRole('button', { name: 'Close thread' }))
    await user.click(screen.getByRole('button', { name: 'Open thread' }))
    expect(screen.getByLabelText('Add a comment')).toHaveValue('Edited draft')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry submission' }))
    await screen.findByText('First draft')
    expect(bodies[1]).toEqual(bodies[0])
    expect(screen.getByLabelText('Add a comment')).toHaveValue('Edited draft')
  })
  it('keeps loaded private pages when the thread refreshes', async () => {
    const first = createCommunityCommentSubmission({
      id: 'own-first',
      body: 'First private page',
    })
    const second = createCommunityCommentSubmission({
      id: 'own-second',
      body: 'Second private page',
    })
    const gate = deferred()
    let rootReads = 0,
      refreshStarted = false,
      refreshed = false
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page([]))),
      http.get(`${base}/comment-submissions`, async ({ request }) => {
        if (new URL(request.url).searchParams.has('cursor'))
          return HttpResponse.json(
            submissionsPage([
              refreshed ? { ...second, body: 'Updated second private page' } : second,
            ])
          )
        rootReads++
        if (rootReads > 1) {
          refreshStarted = true
          await gate.promise
          refreshed = true
        }
        return HttpResponse.json(submissionsPage([first], 'private-page-2'))
      })
    )
    const user = userEvent.setup()
    render(<Journey state={makeState()} />)
    await user.click(await screen.findByRole('button', { name: 'More submissions' }))
    expect(await screen.findByText('Second private page')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(refreshStarted).toBe(true))
    expect(screen.getByText('Second private page')).toBeVisible()
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    expect(await screen.findByText('Updated second private page')).toBeVisible()
  })
  it('counts canonical NFC characters while preserving an active composition', async () => {
    useMswHandlers(http.get(`${base}/comments`, () => HttpResponse.json(page([]))))
    render(<Journey state={makeState()} />)
    const compose = await screen.findByLabelText('Add a comment')
    fireEvent.compositionStart(compose)
    fireEvent.change(compose, {
      target: { value: 'e\u0301' },
      nativeEvent: { isComposing: true },
    })
    expect(screen.getByText('1 / 280 characters')).toBeVisible()
    fireEvent.compositionEnd(compose, { data: 'e\u0301' })
    expect(compose).toHaveValue('é')
  })

  it('moves focus to the private status region after deleting an own submission and paging private submissions', async () => {
    const held = createCommunityCommentSubmission({
      id: 'private-held',
      status: 'held_for_review',
      body: 'Held private body',
    })
    const later = createCommunityCommentSubmission({
      id: 'private-later',
      body: 'Later private body',
    })
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page([]))),
      http.get(`${base}/comment-submissions`, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('cursor')
            ? submissionsPage([later])
            : submissionsPage([held], 'private-next')
        )
      ),
      http.delete(`${base}/comments/private-held`, () =>
        HttpResponse.json({
          data: { ...held, status: 'author_deleted', body: null },
        })
      )
    )
    const close = vi.fn(),
      user = userEvent.setup()
    render(
      <AccessibleModal isOpen title="Look" titleId="private-look" onClose={close}>
        <CommunityComments postId="community-post-1" state={makeState()} />
      </AccessibleModal>
    )
    const region = screen.getByRole('region', {
      name: 'Your submissions. Only you can see these.',
    })
    await user.click(await screen.findByRole('button', { name: 'More submissions' }))
    expect(await screen.findByText('Later private body')).toBeVisible()
    // The pager unmounts after the final page, so focus must land on a stable target.
    expect(
      screen.queryByRole('button', { name: 'More submissions' })
    ).not.toBeInTheDocument()
    await waitFor(() => expect(region).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledOnce()

    const entry = within(screen.getByTestId('comment-submission-private-held'))
    await user.click(entry.getByRole('button', { name: 'Delete' }))
    expect(await entry.findByText('Deleted.')).toBeVisible()
    // The pressed Delete control is gone with the deleted status.
    expect(entry.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    await waitFor(() => expect(region).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['held_for_review', 'Held for review. Only you can see this.'],
    ['blocked', 'Withheld by screening. Only you can see this.'],
  ] as const)(
    'shows the private %s status with its recovery copy',
    async (status, statusCopy) => {
      useMswHandlers(
        http.get(`${base}/comments`, () => HttpResponse.json(page([]))),
        http.get(`${base}/comment-submissions`, () =>
          HttpResponse.json(
            submissionsPage([
              createCommunityCommentSubmission({
                id: 'withheld',
                status,
                body: 'Withheld private body',
              }),
            ])
          )
        )
      )
      render(<Journey state={makeState()} />)
      const entry = within(await screen.findByTestId('comment-submission-withheld'))
      expect(entry.getByText(statusCopy)).toBeVisible()
      expect(entry.getByText('Withheld private body')).toBeVisible()
      expect(
        entry.getByText('Delete this submission and try again with a new comment.')
      ).toBeVisible()
      expect(entry.getByRole('button', { name: 'Delete' })).toBeVisible()
    }
  )

  it('alerts a failed status poll once and clears it after the next successful poll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const pending = createCommunityCommentSubmission({
        id: 'polled',
        body: 'Polled private body',
      })
      let polls = 0
      useMswHandlers(
        http.get(`${base}/comments`, () => HttpResponse.json(page([]))),
        http.get(`${base}/comment-submissions`, () => {
          polls++
          return polls === 2 || polls === 3
            ? HttpResponse.error()
            : HttpResponse.json(submissionsPage([pending]))
        })
      )
      const state = makeState(),
        statuses = vi.spyOn(state, 'statuses'),
        reads = vi.spyOn(state, 'load')
      render(<Journey state={state} />)
      await settle(reads)
      await settle(statuses)
      expect(screen.getByTestId('comment-submission-polled')).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      // First poll fails: one assertive alert, nothing duplicated in the polite region.
      await act(() => vi.advanceTimersByTimeAsync(3000))
      await settle(statuses)
      expect(polls).toBe(2)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(/^Comments could not be updated\. Try again\.$/)
      expect(screen.getByRole('status')).toHaveTextContent(/^$/)

      // The backed-off retry fails the same way: the alert node stays mounted,
      // so assistive tech is not re-notified.
      await act(() => vi.advanceTimersByTimeAsync(6000))
      await settle(statuses)
      expect(polls).toBe(3)
      expect(screen.getByRole('alert')).toBe(alert)
      expect(screen.getByRole('status')).toHaveTextContent(/^$/)

      await act(() => vi.advanceTimersByTimeAsync(12_000))
      await settle(statuses)
      expect(polls).toBe(4)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByTestId('comment-submission-polled')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replay a consumed announcement after the thread closes and reopens', async () => {
    const announced = createCommunityCommentSubmission({
      id: 'announced',
      body: 'Announced once',
    })
    let submitted = false
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page([]))),
      http.get(`${base}/comment-submissions`, () =>
        HttpResponse.json(submissionsPage(submitted ? [announced] : []))
      ),
      http.post(`${base}/comments`, () => {
        submitted = true
        return HttpResponse.json({ data: announced })
      })
    )
    const user = userEvent.setup(),
      state = makeState(),
      reads = vi.spyOn(state, 'load'),
      statuses = vi.spyOn(state, 'statuses')
    render(<Journey state={state} />)
    await user.type(await screen.findByLabelText('Add a comment'), 'Announced once')
    await user.click(screen.getByRole('button', { name: 'Send comment' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /^Comment submitted for screening\.$/
      )
    )
    await user.click(screen.getByRole('button', { name: 'Close thread' }))
    await user.click(screen.getByRole('button', { name: 'Open thread' }))
    // Barrier: the reopened thread finished its reads, so the only status node
    // left is the live region.
    await settle(reads)
    await settle(statuses)
    expect(screen.getByTestId('comment-submission-announced')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(/^$/)
  })

  it('keeps a newer report form open and focused when an older report is accepted', async () => {
    const other = createCommunityComment({
      id: 'root-b',
      author: 'Style Explorer B2C3D4E5',
      body: 'A second layered look.',
      publicationSequence: 2,
    })
    const held = deferred()
    const reports: { id: string; body: unknown }[] = []
    useMswHandlers(
      http.get(`${base}/comments`, () => HttpResponse.json(page([root, other]))),
      http.post(`${base}/comments/:id/report`, async ({ params, request }) => {
        reports.push({ id: String(params.id), body: await request.json() })
        if (params.id === root.id) await held.promise
        return HttpResponse.json(reportReceipt())
      })
    )
    const user = userEvent.setup(),
      state = makeState(),
      sent = vi.spyOn(state, 'report')
    render(<Journey state={state} />)
    const reportA = await screen.findByRole('button', { name: `Report: ${rootContext}` })
    await user.click(reportA)
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(reports).toHaveLength(1))

    // While A is in flight the member moves on to B and picks a reason.
    await user.click(
      within(screen.getByTestId('comment-root-b')).getByRole('button', {
        name: `Report: ${other.author}. ${other.body}`,
      })
    )
    const reasonB = within(screen.getByTestId('comment-root-b')).getByRole('combobox', {
      name: 'Reason for the report',
    })
    await user.selectOptions(reasonB, 'harassment')
    expect(reasonB).toHaveFocus()

    // Barrier: A's report call has resolved and its acceptance handler has run.
    const accepted = sent.mock.results[0]!
    if (accepted.type !== 'return') throw new Error('Report A did not start')
    await act(async () => {
      held.resolve()
      await accepted.value
    })

    expect(screen.getByRole('status')).toHaveTextContent(/^Report received\.$/)
    expect(reports).toEqual([{ id: root.id, body: { reason: 'spam' } }])
    const formB = within(screen.getByTestId('comment-root-b'))
    expect(formB.getByRole('combobox', { name: 'Reason for the report' })).toHaveValue(
      'harassment'
    )
    expect(formB.getByRole('combobox', { name: 'Reason for the report' })).toHaveFocus()
    expect(reportA).not.toHaveFocus()
  })
})
