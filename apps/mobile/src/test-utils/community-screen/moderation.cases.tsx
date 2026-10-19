/* eslint-disable @typescript-eslint/await-thenable */
import {
  SDK_ERROR_MESSAGE,
  item,
  authorState,
  feedJson,
  errorEnvelope,
  feedUrls,
  serveFeed,
} from './harness'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it } from 'vitest'
import { COMMUNITY_SELF_REPORT_MESSAGE } from '@couture/api-client/contracts/http'
import { CommunityScreen } from '@/src/features/community/community-screen'
import enUS from '@/assets/locales/en-US.json'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'

export function registerCommunityModerationCases() {
  // --- Author states --------------------------------------------------------

  it('6.2-MOB-001 explains a stable screening code in words, never as the raw code', async () => {
    serveFeed(() =>
      feedJson({
        authorStates: [
          authorState('flagged', { moderationReason: 'text_policy_match' }),
          authorState('review_failed', {
            moderationReason: 'inference_timeout, low_confidence',
          }),
        ],
      })
    )

    await render(<CommunityScreen />)

    await screen.findByTestId('community-author-states')
    expect(
      screen.getByTestId('community-author-state-reason-own-flagged').textContent
    ).toBe(enUS.community.moderationReason.language)
    // A joined list reads as one sentence per category, in schema order.
    expect(
      screen.getByTestId('community-author-state-reason-own-review_failed').textContent
    ).toBe(
      `${enUS.community.moderationReason.photoUnconfirmed} ${enUS.community.moderationReason.incomplete}`
    )
  })

  it('6.2b-MOB-001 tells the author to upload again when the stored photo failed verification', async () => {
    // Story 6.2b review (RF12): the worker persists the validation code it
    // caught, and the five upload failures reached the author raw.
    serveFeed(() =>
      feedJson({
        authorStates: [
          authorState('review_failed', { moderationReason: 'IMAGE_DECODE_FAILED' }),
        ],
      })
    )

    await render(<CommunityScreen />)

    const section = await screen.findByTestId('community-author-states')
    expect(
      screen.getByTestId('community-author-state-reason-own-review_failed').textContent
    ).toBe(enUS.community.moderationReason.upload)
    expect(section.textContent).not.toContain('IMAGE_DECODE_FAILED')
  })

  it('6.1-MOB-010 renders author states in their own section, never in the grid', async () => {
    const explained = [
      'flagged',
      'review_failed',
      'withdrawn',
      'consent_suspended',
    ] as const
    serveFeed(() =>
      feedJson({
        authorStates: [
          ...explained.map((status) =>
            authorState(status, { moderationReason: `${status} reason` })
          ),
          authorState('pending_review'),
        ],
      })
    )

    await render(<CommunityScreen />)

    const section = await screen.findByTestId('community-author-states')
    expect(section.textContent).toContain(enUS.community.feed.yourPostsTitle)

    for (const status of explained) {
      const id = `own-${status}`
      expect(screen.getByTestId(`community-author-state-status-${id}`).textContent).toBe(
        enUS.community.status[status]
      )
      expect(
        screen.getByTestId(`community-author-state-explanation-${id}`).textContent
      ).toBe(enUS.community.removed[status])
      expect(screen.getByTestId(`community-author-state-reason-${id}`).textContent).toBe(
        `Reason: ${status} reason`
      )
      // `items` is published rows only; an author state never joins the grid.
      expect(screen.queryByTestId(`community-post-card-${id}`)).toBeNull()
    }

    expect(
      screen.getByTestId('community-author-state-status-own-pending_review').textContent
    ).toBe(enUS.community.status.pending_review)
    expect(
      screen.queryByTestId('community-author-state-explanation-own-pending_review')
    ).toBeNull()
    expect(
      screen.queryByTestId('community-author-state-reason-own-pending_review')
    ).toBeNull()
  })

  // --- Report ---------------------------------------------------------------

  it('6.1-MOB-011 offers Withdraw on own looks and Report on everyone else’s', async () => {
    serveFeed(() =>
      feedJson({
        items: [
          item(),
          item({ id: 'post-self', author: { displayName: 'You', isSelf: true } }),
        ],
      })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-self')

    expect(screen.getByTestId('community-card-report-post-a')).toBeTruthy()
    expect(screen.queryByTestId('community-card-withdraw-post-a')).toBeNull()
    expect(screen.getByTestId('community-card-withdraw-post-self')).toBeTruthy()
    expect(screen.queryByTestId('community-card-report-post-self')).toBeNull()
  })

  it('6.1-MOB-012 submits a report and settles the control into Reported and disabled', async () => {
    let body: unknown = null
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ tracked: true })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-spam'))
    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: 'Reposted stock photography.' },
    })
    press(screen.getByTestId('submit-report-button'))

    await waitFor(() =>
      expect(body).toEqual({ reason: 'spam', details: 'Reposted stock photography.' })
    )
    await waitFor(() => expect(screen.queryByTestId('community-report-modal')).toBeNull())

    const control = screen.getByTestId('community-card-report-post-a')
    expect(control.textContent).toBe(enUS.community.card.reported)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.report.success
    )
  })

  /**
   * A duplicate report of the SAME reason answers 200: `community.repository.ts`
   * replays the stored row and its P2002 race resolves the same way. The settled
   * control is what makes the second tap impossible; the client carried an
   * `already_reported` reason until the constant behind it turned out to be thrown by
   * nothing.
   */
  it('6.1-MOB-013 settles the control on a replayed report so a second tap is impossible', async () => {
    let reportCalls = 0
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () => {
        reportCalls += 1
        return HttpResponse.json({ tracked: true })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-harassment'))
    press(screen.getByTestId('submit-report-button'))

    await waitFor(() => expect(screen.queryByTestId('community-report-modal')).toBeNull())

    const control = screen.getByTestId('community-card-report-post-a')
    expect(control.textContent).toBe(enUS.community.card.reported)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.report.success
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)

    press(control)
    expect(screen.queryByTestId('community-report-modal')).toBeNull()
    expect(reportCalls).toBe(1)
  })

  it('6.1-MOB-072 says why a self-report was refused, from the 403 the service sends', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () =>
        errorEnvelope(403, COMMUNITY_SELF_REPORT_MESSAGE)
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-spam'))
    press(screen.getByTestId('submit-report-button'))

    // The refusal is a ForbiddenException, so reading it as a conflict left this
    // string unreachable and the reader saw the generic report failure instead.
    expect((await screen.findByTestId('report-error-message')).textContent).toBe(
      enUS.community.error.selfReport
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-014 renders the plain rate-limit copy for a 429 with no Retry-After', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () =>
        errorEnvelope(429, 'Too many reports.')
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-other'))
    press(screen.getByTestId('submit-report-button'))

    const message = await screen.findByTestId('report-error-message')
    expect(message.textContent).toBe(enUS.community.error.rateLimited)
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-015 folds the Retry-After time into the rate-limit copy', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () =>
        errorEnvelope(429, 'Too many reports.', { 'Retry-After': '900' })
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-violence'))
    press(screen.getByTestId('submit-report-button'))

    const message = await screen.findByTestId('report-error-message')
    const [prefix] = enUS.community.error.rateLimitedUntil.split('{{time}}')
    // Asserted as a prefix plus a clock time rather than an exact string: the
    // wall-clock minute can roll over between the render and this assertion.
    expect(message.textContent?.startsWith(prefix ?? '')).toBe(true)
    expect(message.textContent).toMatch(/\d{1,2}:\d{2}/)
    expect(message.textContent).not.toBe(enUS.community.error.rateLimited)
  })

  // --- Withdraw -------------------------------------------------------------

  it('6.1-MOB-016 withdraws a look, then re-reads the feed rather than guessing', async () => {
    let withdrawnPostId: string | null = null
    serveFeed((_url, index) =>
      index === 0
        ? feedJson({
            items: [
              item({ id: 'post-self', author: { displayName: 'You', isSelf: true } }),
            ],
          })
        : feedJson({ items: [], authorStates: [authorState('withdrawn')] })
    )
    server.use(
      http.post('*/api/v1/community/posts/:postId/withdraw', ({ params }) => {
        withdrawnPostId = params.postId as string
        return HttpResponse.json({ tracked: true })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-withdraw-post-self'))

    await waitFor(() => expect(withdrawnPostId).toBe('post-self'))
    await screen.findByTestId('community-author-state-own-withdrawn')
    expect(screen.queryByTestId('community-post-card-post-self')).toBeNull()
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.removed.withdrawn
    )
    expect(feedUrls).toHaveLength(2)
  })

  it('6.1-MOB-017 says a withdraw failed and leaves the look in the feed', async () => {
    serveFeed(() =>
      feedJson({
        items: [item({ id: 'post-self', author: { displayName: 'You', isSelf: true } })],
      })
    )
    server.use(
      http.post('*/api/v1/community/posts/:postId/withdraw', () =>
        errorEnvelope(500, 'Internal server error.')
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-withdraw-post-self'))

    const panel = await screen.findByTestId('community-action-error')
    expect(panel.textContent).toBe(enUS.community.error.withdraw)
    // The success notice must not fire on a failure, and the look stays put.
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    expect(screen.getByTestId('community-post-card-post-self')).toBeTruthy()
    expect(feedUrls).toHaveLength(1)
  })
}
