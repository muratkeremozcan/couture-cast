// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Community grid journeys through the real web transport and MSW.
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  communityPostStatusSchema,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  REPORT_PATH,
  WITHDRAW_PATH,
  MERLOT,
  GOLD,
  item,
  authorState,
  feedBody,
  feedHandler,
  errorBody,
  signIn,
  renderGrid,
  STATUS_COPY,
  REMOVED_COPY,
  setupCommunityGridClock,
  setupCommunityGridSurface,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunityLookbookGrid (Story 6.1)', () => {
  setupCommunityGridSurface()

  describe('author states', () => {
    const states = [
      authorState({ id: 'as-pending', status: 'pending_review' }),
      authorState({
        id: 'as-flagged',
        status: 'flagged',
        moderationReason: 'Nudity detected by automated screening.',
        caption: 'A look that did not clear screening.',
      }),
      authorState({ id: 'as-review-failed', status: 'review_failed' }),
      authorState({ id: 'as-withdrawn', status: 'withdrawn' }),
      authorState({ id: 'as-consent', status: 'consent_suspended' }),
    ]

    it('6.1-WEB-018 renders the caller’s own posts in their own section, outside the grid', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()], authorStates: states }))
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(section).toHaveTextContent('Your looks in progress')
      expect(section).toHaveTextContent(
        'Only you can see these until screening finishes.'
      )

      // `items` is published rows only; author states never join the card grid.
      const grid = screen.getByTestId('community-card-grid')
      expect(within(grid).getAllByRole('article')).toHaveLength(1)
      for (const state of states) {
        expect(
          within(grid).queryByTestId(`author-state-${state.id}`)
        ).not.toBeInTheDocument()
        expect(
          within(section).getByTestId(`author-state-${state.id}`)
        ).toBeInTheDocument()
      }
    })

    it('6.1-WEB-019 gives every author state a localized status badge', async () => {
      signIn()
      useMswHandlers(feedHandler({ authorStates: states }))
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(within(section).getByTestId('status-badge-as-pending')).toHaveTextContent(
        STATUS_COPY.pending_review
      )
      expect(within(section).getByTestId('status-badge-as-flagged')).toHaveTextContent(
        STATUS_COPY.flagged
      )
      expect(
        within(section).getByTestId('status-badge-as-review-failed')
      ).toHaveTextContent(STATUS_COPY.review_failed)
      expect(within(section).getByTestId('status-badge-as-withdrawn')).toHaveTextContent(
        STATUS_COPY.withdrawn
      )
      expect(within(section).getByTestId('status-badge-as-consent')).toHaveTextContent(
        STATUS_COPY.consent_suspended
      )

      // The predecessor printed `status.replace('_', ' ')`, untranslated.
      for (const raw of ['review failed', 'consent suspended', 'pending review']) {
        expect(within(section).queryByText(raw)).not.toBeInTheDocument()
      }
    })

    it('6.1-WEB-020 explains each removed status and shows the moderation reason', async () => {
      signIn()
      useMswHandlers(feedHandler({ authorStates: states }))
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(
        within(section).getByTestId('author-state-explanation-as-flagged')
      ).toHaveTextContent(REMOVED_COPY.flagged)
      expect(
        within(section).getByTestId('author-state-explanation-as-review-failed')
      ).toHaveTextContent(REMOVED_COPY.review_failed)
      expect(
        within(section).getByTestId('author-state-explanation-as-withdrawn')
      ).toHaveTextContent(REMOVED_COPY.withdrawn)
      expect(
        within(section).getByTestId('author-state-explanation-as-consent')
      ).toHaveTextContent(REMOVED_COPY.consent_suspended)
      expect(
        within(section).getByTestId('author-state-reason-as-flagged')
      ).toHaveTextContent('Reason: Nudity detected by automated screening.')
      expect(
        within(section).getByTestId('author-state-caption-as-flagged')
      ).toHaveTextContent('A look that did not clear screening.')

      // `pending_review` is not a removal, so it carries no removal explanation.
      expect(
        within(section).queryByTestId('author-state-explanation-as-pending')
      ).not.toBeInTheDocument()
      expect(
        within(section).queryByTestId('author-state-reason-as-pending')
      ).not.toBeInTheDocument()
    })

    it('6.2-WEB-001 explains a stable screening code in words, never as the raw code', async () => {
      signIn()
      useMswHandlers(
        feedHandler({
          authorStates: [
            authorState({
              id: 'as-text',
              status: 'flagged',
              moderationReason: 'text_policy_match',
            }),
            authorState({
              id: 'as-joined',
              status: 'flagged',
              moderationReason: 'screening_unavailable, script_mixed',
            }),
            authorState({
              id: 'as-stalled',
              status: 'review_failed',
              moderationReason: 'moderation_stalled',
            }),
          ],
        })
      )
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(
        within(section).getByTestId('author-state-reason-as-text')
      ).toHaveTextContent(
        'Your caption or image description uses words the community guidelines do not allow. Change the wording before you share this look again.'
      )
      // A joined list reads as one sentence per category, in a fixed order.
      expect(
        within(section).getByTestId('author-state-reason-as-joined')
      ).toHaveTextContent(
        'Screening could not check all of your caption or image description. Keep it shorter and in one language before you share this look again. Screening could not finish checking this look.'
      )
      expect(
        within(section).getByTestId('author-state-reason-as-stalled')
      ).toHaveTextContent('Screening could not finish checking this look.')

      for (const raw of [
        'text_policy_match',
        'screening_unavailable',
        'script_mixed',
        'moderation_stalled',
        'Reason:',
      ]) {
        expect(section).not.toHaveTextContent(raw)
      }
    })

    it('6.2b-WEB-001 tells the author to upload again when the stored photo failed verification', async () => {
      // Story 6.2b review (RF12): the worker persists the validation code it
      // caught, and the five upload failures reached the author raw.
      signIn()
      useMswHandlers(
        feedHandler({
          authorStates: [
            authorState({
              id: 'as-checksum',
              status: 'review_failed',
              moderationReason: 'IMAGE_CHECKSUM_MISMATCH',
            }),
          ],
        })
      )
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(
        within(section).getByTestId('author-state-reason-as-checksum')
      ).toHaveTextContent(
        'This photo could not be processed as it was uploaded. Share this look again with a JPEG, PNG or WebP photo up to 10 MB and between 256 and 4096 pixels on each side.'
      )
      expect(section).not.toHaveTextContent('IMAGE_CHECKSUM_MISMATCH')
      expect(section).not.toHaveTextContent('Reason:')
    })

    it('6.1-WEB-021 renders flagged content in deep merlot rather than success gold', async () => {
      signIn()
      useMswHandlers(feedHandler({ authorStates: states }))
      renderGrid()

      const badge = await screen.findByTestId('status-badge-as-flagged')
      expect(badge).toHaveStyle({ color: MERLOT, borderColor: MERLOT })
      expect(badge).not.toHaveStyle({ color: GOLD })
      expect(screen.getByTestId('author-state-explanation-as-flagged')).toHaveStyle({
        color: MERLOT,
      })
      // Merlot is reserved for the destructive state, so a withdrawal is neutral.
      expect(screen.getByTestId('status-badge-as-withdrawn')).not.toHaveStyle({
        color: MERLOT,
      })
    })

    it('6.1-WEB-022 badges a non-published row inside the grid too', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item({ status: 'consent_suspended', climateBand: null })] })
      )
      renderGrid()

      expect(await screen.findByTestId('status-badge-post-1')).toHaveTextContent(
        STATUS_COPY.consent_suspended
      )
      expect(screen.getByTestId('climate-badge-post-1')).toHaveTextContent('All weather')
      expect(communityPostStatusSchema.options).toContain('consent_suspended')
    })
  })

  describe('report', () => {
    it('6.1-WEB-023 submits a report, settles the control and confirms visibly', async () => {
      signIn()
      let reportedId: string | undefined
      let reportPayload: unknown
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, async ({ request, params }) => {
          reportedId = String(params.postId)
          reportPayload = await request.json()
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.selectOptions(
        await screen.findByTestId('report-reason-select'),
        'harassment'
      )
      await user.type(
        screen.getByTestId('report-details-input'),
        'Targeted abuse in the caption.'
      )
      await user.click(screen.getByTestId('report-submit-button'))

      await waitFor(() =>
        expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      )
      const control = screen.getByTestId('report-button-post-1')
      expect(control).toBeDisabled()
      expect(control).toHaveTextContent('Reported')

      const notice = screen.getByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'success')
      expect(notice).toHaveTextContent('Thank you. A moderator will review this look.')
      // Visible, not only announced: the previous version put every one of these
      // into the sr-only region alone.
      expect(notice).not.toBe(screen.getByTestId('community-live-region'))
      expect(notice).not.toHaveClass('sr-only')
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Thank you. A moderator will review this look.'
      )

      expect(reportedId).toBe('post-1')
      expect(reportPayload).toEqual({
        reason: 'harassment',
        details: 'Targeted abuse in the caption.',
      })
    })

    /**
     * A duplicate report of the SAME reason is a 200, not a conflict:
     * `community.repository.ts` replays the stored row, and its P2002 race
     * resolves the same way. So the second submission settles exactly like the
     * first, and there is no `already_reported` state to render: the client
     * carried one until the constant behind it turned out to be thrown by
     * nothing. A CHANGED reason is the only 409 a reporter can provoke, and
     * `6.1-WEB-026` covers it.
     */
    it('6.1-WEB-024 settles the control when a duplicate report replays', async () => {
      signIn()
      let reportCalls = 0
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, () => {
          reportCalls += 1
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.click(await screen.findByTestId('report-submit-button'))

      await waitFor(() =>
        expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      )
      const control = screen.getByTestId('report-button-post-1')
      expect(control).toBeDisabled()
      expect(control).toHaveTextContent('Reported')
      expect(screen.getByTestId('community-action-notice')).toHaveAttribute(
        'data-tone',
        'success'
      )

      // The settled control is what makes a second submission impossible, so a
      // second click must reach no network at all.
      await user.click(control)
      expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      expect(reportCalls).toBe(1)
    })

    it('6.1-WEB-025 keeps the modal open on a rate limit and renders catalog copy', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, () =>
          errorBody(429, COMMUNITY_POST_RATE_LIMITED_MESSAGE, 'Too Many Requests')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.click(await screen.findByTestId('report-submit-button'))

      const error = await screen.findByTestId('report-error-message')
      expect(error).toHaveTextContent("You have reached today's limit of ten looks.")
      expect(error).not.toHaveTextContent('Try again after')
      // Never the server's own English.
      expect(error).not.toHaveTextContent(COMMUNITY_POST_RATE_LIMITED_MESSAGE)
      expect(screen.getByTestId('report-reason-select')).toBeInTheDocument()
      expect(screen.getByTestId('report-button-post-1')).toBeEnabled()
    })

    /**
     * The self-report row is 403, not 409, because `community.service.ts` throws
     * it as a `ForbiddenException`. The first draft of the client classified it
     * under 409, which left `self_report` and its catalog string unreachable and
     * made reporting your own post read "We could not send your report."
     * The unrecognised-status rows below hold the fallback in place, so a new
     * server message on either status surfaces as generic copy rather than as
     * the server's untranslated English.
     */
    it.each([
      [
        409,
        COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
        'Conflict',
        'You already reported this look for a different reason.',
      ],
      [
        403,
        COMMUNITY_SELF_REPORT_MESSAGE,
        'Forbidden',
        'You cannot report your own look.',
      ],
      [
        404,
        COMMUNITY_POST_NOT_FOUND_MESSAGE,
        'Not Found',
        'This look is no longer available.',
      ],
      [409, 'Some other conflict.', 'Conflict', 'We could not send your report.'],
      [403, 'Some other refusal.', 'Forbidden', 'We could not send your report.'],
    ])(
      '6.1-WEB-026 maps a %s report failure onto its own catalog string',
      async (status, message, error, expected) => {
        signIn()
        useMswHandlers(
          feedHandler({ items: [item()] }),
          http.post(REPORT_PATH, () => errorBody(status, message, error))
        )
        const user = userEvent.setup()
        renderGrid()

        await screen.findByTestId('lookbook-card-post-1')
        await user.click(screen.getByTestId('report-button-post-1'))
        await user.click(await screen.findByTestId('report-submit-button'))

        const banner = await screen.findByTestId('report-error-message')
        expect(banner).toHaveTextContent(expected)
        expect(banner).not.toHaveTextContent(message)
      }
    )

    it('6.1-WEB-027 closes the report modal without submitting', async () => {
      signIn()
      let reportCalls = 0
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, () => {
          reportCalls += 1
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      expect(reportCalls).toBe(0)
      expect(screen.getByTestId('report-button-post-1')).toBeEnabled()
    })
  })

  describe('withdraw', () => {
    const selfPost = item({
      id: 'self-post',
      author: { displayName: 'You', isSelf: true },
    })

    it('6.1-WEB-028 offers Withdraw and no Report on the caller’s own post', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [selfPost, item()] }))
      renderGrid()

      await screen.findByTestId('lookbook-card-self-post')
      expect(screen.getByTestId('withdraw-button-self-post')).toBeInTheDocument()
      // Reporting your own post is a 403 the server refuses; the CTA row shows
      // exactly one moderation affordance.
      expect(screen.queryByTestId('report-button-self-post')).not.toBeInTheDocument()
      // 'You' is three characters and a substring of plenty of display names, so the
      // substring-matching toHaveTextContent would still pass if the self-label regressed.
      expect(screen.getByTestId('author-name-self-post').textContent).toBe('You')

      expect(screen.getByTestId('report-button-post-1')).toBeInTheDocument()
      expect(screen.queryByTestId('withdraw-button-post-1')).not.toBeInTheDocument()
    })

    it('6.1-WEB-029 withdraws, confirms visibly and re-reads the feed', async () => {
      signIn()
      let feedCalls = 0
      let withdrawnId: string | undefined
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedCalls === 1
            ? feedBody({ items: [selfPost] })
            : feedBody({
                items: [],
                authorStates: [authorState({ id: 'self-post', status: 'withdrawn' })],
              })
        }),
        http.post(WITHDRAW_PATH, ({ params }) => {
          withdrawnId = String(params.postId)
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-self-post')
      await user.click(screen.getByTestId('withdraw-button-self-post'))

      const notice = await screen.findByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'success')
      expect(notice).toHaveTextContent(REMOVED_COPY.withdrawn)
      expect(withdrawnId).toBe('self-post')

      // No optimistic removal: the row moves to `authorStates` on the next read.
      await waitFor(() => expect(feedCalls).toBe(2))
      await waitFor(() =>
        expect(screen.queryByTestId('lookbook-card-self-post')).not.toBeInTheDocument()
      )
      expect(await screen.findByTestId('author-state-self-post')).toBeInTheDocument()
    })

    it('6.1-WEB-030 says the look is still in the feed when the withdraw fails', async () => {
      signIn()
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody({ items: [selfPost] })
        }),
        http.post(WITHDRAW_PATH, () =>
          errorBody(500, 'withdraw transaction rolled back', 'Internal Server Error')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-self-post')
      await user.click(screen.getByTestId('withdraw-button-self-post'))

      const notice = await screen.findByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'error')
      expect(notice).toHaveTextContent(
        'We could not withdraw this look. It is still in the feed.'
      )
      expect(notice).toHaveStyle({ color: MERLOT })
      expect(notice).not.toHaveTextContent('withdraw transaction rolled back')
      expect(screen.getByTestId('lookbook-card-self-post')).toBeInTheDocument()
      expect(feedCalls).toBe(1)
    })
  })
})
