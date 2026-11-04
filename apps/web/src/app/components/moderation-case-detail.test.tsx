// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-DETAIL, -DETAIL-ONE-READ, -STATES, -NO-ACTIONS, -CONFLICT-NOTICE, -HOSTILE-TEXT.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import {
  detail,
  detailHandler,
  errorBody,
  json,
  signIn,
} from '../../test-utils/moderation-console'
import { ModerationCaseDetailView } from './moderation-case-detail'

const RLO = String.fromCodePoint(0x202e)
const PDF = String.fromCodePoint(0x202c)
const ZWSP = String.fromCodePoint(0x200b)
beforeEach(() => signIn())
afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
})

async function openCase(
  overrides: Parameters<typeof detail>[0] = {},
  caseId = 'post.p1'
) {
  const reads: string[] = []
  mockApi(detailHandler(() => json({ data: detail(overrides) }), reads))
  const view = render(<ModerationCaseDetailView caseId={caseId} />)
  await screen.findByRole('heading', { level: 1 })
  return { reads, ...view }
}

describe('C-WEB-Q-DETAIL', () => {
  it('labels what the reporter saw and the current state apart, with the reporter context', async () => {
    await openCase()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Post case' })
    ).toBeInTheDocument()
    const content = screen.getByRole('region', { name: 'Reported content' })
    expect(within(content).getByText('Author')).toBeInTheDocument()
    expect(within(content).getByText('quiet-fox-1234')).toBeInTheDocument()
    expect(within(content).getByText('What the reporter saw')).toBeInTheDocument()
    expect(
      within(content).getByText('Alt the reporter saw', { selector: 'bdi' })
    ).toBeInTheDocument()
    expect(within(content).getByText('Current state')).toBeInTheDocument()
    expect(within(content).getByText('published')).toBeInTheDocument()

    const reporters = screen.getByRole('region', { name: 'Reporters' })
    expect(within(reporters).getByText('brave-owl-9876')).toBeInTheDocument()
    expect(within(reporters).getByText(/Harassment/)).toBeInTheDocument()
    expect(within(reporters).getByText('Reporter typed this')).toBeInTheDocument()

    expect(screen.getByText('Risk: High')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b(at_risk|on_track|harassment)\b/)
    expect(screen.getByRole('link', { name: 'Back to queue' })).toHaveAttribute(
      'href',
      '/moderation'
    )
  })

  it('shows the time remaining on the server clock and the SLA state', async () => {
    await openCase()
    const badge = document.querySelector('[data-sla-state]')
    expect(badge).toHaveAttribute('data-sla-state', 'at_risk')
    expect(screen.getAllByText(/left/).length).toBeGreaterThan(0)
  })

  it('renders machine findings with category, code and engine version', async () => {
    await openCase({
      findings: {
        codes: ['text_policy_match', 'unsafe_class'],
        categories: ['language', 'photo'],
        engineVersion: '1.2.0',
        operatorNote: null,
      },
    })
    const findings = screen.getByRole('region', { name: 'Machine findings' })
    expect(within(findings).getByText('Language, Photo')).toBeInTheDocument()
    expect(
      within(findings).getByText('text_policy_match, unsafe_class')
    ).toBeInTheDocument()
    expect(within(findings).getByText('1.2.0')).toBeInTheDocument()
  })

  it('says so when there is no finding, when a hold has no code, and shows an operator note as text', async () => {
    const { unmount } = await openCase({ findings: null })
    expect(screen.getByText('No machine findings.')).toBeInTheDocument()
    unmount()

    const held = await openCase({
      findings: { codes: [], categories: [], engineVersion: null, operatorNote: null },
    })
    expect(
      screen.getByText('Held for review without a recorded code.')
    ).toBeInTheDocument()
    held.unmount()

    await openCase({
      findings: {
        codes: [],
        categories: [],
        engineVersion: '1.0.0',
        operatorNote: 'Removed for doxxing',
      },
    })
    expect(screen.getByText('Operator note')).toBeInTheDocument()
    expect(screen.getByText('Removed for doxxing')).toBeInTheDocument()
  })

  it('names erased and unknown members without an id and marks resolved reports', async () => {
    await openCase({
      subject: { state: 'erased', alias: null },
      reporters: [
        {
          identity: { state: 'unknown', alias: null },
          reason: 'spam',
          details: null,
          reportedAt: '2026-11-03T10:00:00.000Z',
          resolved: true,
        },
        {
          identity: { state: 'erased', alias: null },
          reason: 'violence',
          details: null,
          reportedAt: '2026-11-03T10:30:00.000Z',
          resolved: false,
        },
      ],
      reportCount: 2,
    })
    expect(screen.getAllByText('Erased member')).toHaveLength(2)
    expect(screen.getByText('Unnamed member')).toBeInTheDocument()
    const reporters = screen.getByRole('region', { name: 'Reporters' })
    expect(within(reporters).getAllByText(/Resolved/)).toHaveLength(1)
  })

  it('shows prior actions with the actor, the action and the time, or says there are none', async () => {
    const none = await openCase({ priorActions: [] })
    expect(screen.getByText('No prior actions.')).toBeInTheDocument()
    none.unmount()

    await openCase({
      priorActions: [
        {
          actorKind: 'screening',
          action: 'flagged',
          reason: 'text_policy_match',
          occurredAt: '2026-11-03T08:00:00.000Z',
        },
        {
          actorKind: 'operator',
          action: 'released_by_operator',
          reason: 'Looks fine',
          occurredAt: '2026-11-03T09:00:00.000Z',
        },
      ],
    })
    const actions = screen.getByRole('region', { name: 'Prior actions' })
    const items = within(actions).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText(/Screening/)).toBeInTheDocument()
    expect(within(items[0]!).getByText('flagged')).toBeInTheDocument()
    expect(within(items[1]!).getByText(/Operator/)).toBeInTheDocument()
    expect(within(items[1]!).getByText('Looks fine')).toBeInTheDocument()
  })

  it('handles a snapshot that is unavailable, empty, or a comment with a parent', async () => {
    const unavailable = await openCase({
      snapshot: {
        available: false,
        caption: null,
        altText: null,
        body: null,
        climateBand: null,
        capturedAt: null,
      },
    })
    expect(
      screen.getByText('The content of this report is not available.')
    ).toBeInTheDocument()
    unavailable.unmount()

    const empty = await openCase({
      snapshot: {
        available: true,
        caption: null,
        altText: null,
        body: null,
        climateBand: null,
        capturedAt: null,
      },
    })
    expect(screen.getByText('The report holds no text.')).toBeInTheDocument()
    empty.unmount()

    await openCase(
      {
        source: 'comment',
        caseId: 'comment.c1',
        snapshot: {
          available: true,
          caption: null,
          altText: null,
          body: 'Reported comment body',
          climateBand: null,
          capturedAt: null,
        },
        target: {
          state: 'live',
          status: 'published',
          publishedAt: null,
          parentBody: 'The parent comment',
        },
        media: { state: 'unavailable', reason: 'no_image' },
      },
      'comment.c1'
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Comment case' })
    ).toBeInTheDocument()
    expect(screen.getByText('Reported comment body')).toBeInTheDocument()
    expect(screen.getByText('The parent comment')).toBeInTheDocument()
    expect(screen.getByText('This case has no image.')).toBeInTheDocument()
  })

  it('says the content is gone when the target was erased', async () => {
    await openCase({
      target: { state: 'erased', status: null, publishedAt: null, parentBody: null },
      media: { state: 'unavailable', reason: 'target_erased' },
    })
    expect(screen.getByText('The content has been erased.')).toBeInTheDocument()
    expect(
      screen.getByText('The post was erased, so its image is gone.')
    ).toBeInTheDocument()
  })

  it('names a resolved case as resolved', async () => {
    await openCase({ status: 'resolved', slaState: 'resolved' })
    expect(document.querySelector('[data-sla-state]')).toHaveAttribute(
      'data-sla-state',
      'resolved'
    )
    expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0)
  })
})

describe('C-WEB-Q-CONFLICT-NOTICE', () => {
  it('shows a note when the viewer wrote the content or filed a report, and not otherwise', async () => {
    const without = await openCase({ viewerConflict: false })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    without.unmount()
    await openCase({ viewerConflict: true })
    expect(screen.getByRole('note')).toHaveTextContent(
      'You wrote this content or filed one of its reports.'
    )
  })
})

describe('C-WEB-Q-DETAIL-ONE-READ: every read writes one audit row', () => {
  it('reads once on mount, including under strict mode', async () => {
    const reads: string[] = []
    mockApi(detailHandler(() => json({ data: detail() }), reads))
    render(
      <StrictMode>
        <ModerationCaseDetailView caseId="post.p1" />
      </StrictMode>
    )
    await screen.findByRole('heading', { level: 1 })
    expect(reads).toEqual(['post.p1'])
  })

  it('does not read again on focus, visibility, online, storage or a ten-minute timer', async () => {
    const { reads } = await openCase()
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'Date'] })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('pageshow'))
      document.dispatchEvent(new Event('visibilitychange'))
      fireEvent.focus(document.body)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    vi.useRealTimers()
    expect(reads).toHaveLength(1)
  })

  it('reads again only when the moderator presses Reload, and keeps the case on screen meanwhile', async () => {
    const { reads } = await openCase()
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Post case' })
    ).toBeInTheDocument()
  })

  it('reads once per case when navigating to another case id', async () => {
    const reads: string[] = []
    mockApi(detailHandler((caseId) => json({ data: detail({ caseId }) }), reads))
    const { rerender } = render(<ModerationCaseDetailView caseId="post.a" />)
    await screen.findByRole('heading', { level: 1 })
    rerender(<ModerationCaseDetailView caseId="post.b" />)
    await waitFor(() => expect(reads).toEqual(['post.a', 'post.b']))
  })
})

describe('C-WEB-Q-STATES', () => {
  it('shows the loading state first', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi(
      detailHandler(async () => {
        await held
        return json({ data: detail() })
      })
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    expect(await screen.findByText('Loading')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('link', { name: 'Back to queue' })).toBeInTheDocument()
    release()
    await screen.findByRole('heading', { level: 1 })
  })

  it.each([
    [
      403,
      { statusCode: 403, message: 'Insufficient role' },
      'This account cannot open the moderation console.',
      false,
    ],
    [
      503,
      errorBody(503, 'moderation_console_disabled'),
      'The moderation console is turned off.',
      false,
    ],
    [404, errorBody(404, 'case_not_found'), 'This case no longer exists.', false],
    [401, { statusCode: 401 }, 'Sign in again to continue.', false],
    [
      503,
      errorBody(503, 'audit_unavailable'),
      'The case view could not be recorded, so it was not opened.',
      true,
    ],
    [500, { statusCode: 500 }, 'This case could not be opened. Try again.', true],
  ])(
    'renders the closed state for %s with no case data and the right retry',
    async (status, body, message, retry) => {
      mockApi(detailHandler(() => json(body, status)))
      render(<ModerationCaseDetailView caseId="post.p1" />)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(within(alert).queryAllByRole('button')).toHaveLength(retry ? 1 : 0)
      expect(screen.getByRole('link', { name: 'Back to queue' })).toHaveAttribute(
        'href',
        '/moderation'
      )
      expect(document.body.textContent).not.toMatch(
        /What the reporter saw|Reporters|quiet-fox/
      )
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    }
  )

  it('never calls an audit failure the disabled state, and a retry reads once more and recovers', async () => {
    const reads: string[] = []
    mockApi(
      detailHandler(
        (_id, call) =>
          call === 1
            ? json(errorBody(503, 'audit_unavailable'), 503)
            : json({ data: detail() }),
        reads
      )
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('turned off')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { level: 1, name: 'Post case' })
    expect(reads).toHaveLength(2)
  })

  it('keeps the last good case and marks it stale when a user-initiated reload fails', async () => {
    mockApi(
      detailHandler((_id, call) =>
        call === 1 ? json({ data: detail() }) : json({ statusCode: 500 }, 500)
      )
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh. Showing the last result.'
    )
    expect(screen.getByText('quiet-fox-1234')).toBeInTheDocument()
  })
})

describe('C-WEB-Q-NO-ACTIONS: the detail view decides nothing', () => {
  it('offers only navigation and reload, with no decision control or placeholder', async () => {
    await openCase()
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['Reload case'])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(document.body.textContent?.toLowerCase()).not.toMatch(
      /\b(resolve case|release|take ?down|escalate|ban|sanction|decision)\b/
    )
    expect(document.querySelectorAll('button[disabled]')).toHaveLength(0)
  })
})

describe('C-WEB-Q-HOSTILE-TEXT: every user-authored string is inert', () => {
  const hostile = (label: string) =>
    `<script>window.__pwn_${label}=1</script><img src=x onerror=alert(1)> [click](javascript:alert(1)) **bold** ${RLO}evil${PDF} zero${ZWSP}width`

  it('renders caption, alt text, body, details, operator note, alias, reason and parent as text', async () => {
    await openCase({
      subject: { state: 'alias', alias: hostile('alias').slice(0, 64) },
      snapshot: {
        available: true,
        caption: hostile('caption'),
        altText: hostile('alt'),
        body: hostile('body'),
        climateBand: null,
        capturedAt: null,
      },
      target: {
        state: 'live',
        status: 'published',
        publishedAt: null,
        parentBody: hostile('parent'),
      },
      findings: {
        codes: [],
        categories: [],
        engineVersion: null,
        operatorNote: hostile('note'),
      },
      reporters: [
        {
          identity: { state: 'alias', alias: hostile('reporter').slice(0, 64) },
          reason: 'other',
          details: hostile('details').slice(0, 500),
          reportedAt: '2026-11-03T10:00:00.000Z',
          resolved: false,
        },
      ],
      priorActions: [
        {
          actorKind: 'operator',
          action: 'noted',
          reason: hostile('action'),
          occurredAt: '2026-11-03T10:00:00.000Z',
        },
      ],
      media: { state: 'unavailable', reason: 'no_image' },
    })
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('main img, article img')).toBeNull()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
    expect(document.querySelector('strong, b')).toBeNull()
    expect(Object.keys(window).filter((key) => key.startsWith('__pwn_'))).toEqual([])
    // Every hostile string is on screen as its literal characters.
    for (const label of ['caption', 'alt', 'body', 'parent', 'note', 'details', 'action'])
      expect(document.body.textContent).toContain(
        `<script>window.__pwn_${label}=1</script>`
      )
    expect(document.body.textContent).toContain('**bold**')
    expect(document.body.textContent).toContain('[click](javascript:alert(1))')
  })

  it('wraps long unbroken text and isolates bidi in every user-text wrapper', async () => {
    await openCase({
      snapshot: {
        available: true,
        caption: 'x'.repeat(500),
        altText: null,
        body: null,
        climateBand: null,
        capturedAt: null,
      },
    })
    const holder = screen.getByText('x'.repeat(500)).closest('[dir]')!
    expect(holder.className).toContain('[overflow-wrap:anywhere]')
    expect(holder.className).toContain('whitespace-pre-wrap')
    expect(holder).toHaveAttribute('dir', 'auto')
    expect(holder).toHaveStyle({ unicodeBidi: 'isolate' })
  })
})

describe('review findings: a failed reload never keeps data the viewer may no longer see', () => {
  async function loadThenFail(status: number, body: unknown) {
    mockApi(
      detailHandler((_id, call) =>
        call === 1 ? json({ data: detail() }) : json(body as never, status)
      )
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    expect(document.querySelector('img')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    return screen.findByRole('alert')
  }
  const gone = () => {
    expect(screen.queryByText('quiet-fox-1234')).not.toBeInTheDocument()
    expect(screen.queryByText('brave-owl-9876')).not.toBeInTheDocument()
    expect(screen.queryByText('Reporter typed this')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to queue' })).toBeInTheDocument()
  }

  it.each([
    [401, { statusCode: 401, message: 'Unauthorized' }, 'Sign in again to continue.'],
    [
      403,
      { statusCode: 403, message: 'Insufficient role' },
      'This account cannot open the moderation console.',
    ],
    [
      503,
      errorBody(503, 'moderation_console_disabled'),
      'The moderation console is turned off.',
    ],
    [
      404,
      errorBody(404, 'case_not_found'),
      'This case no longer exists. It may have been re-keyed after an erasure.',
    ],
  ])(
    'a %i on Reload removes the case and shows the terminal state',
    async (status, body, text) => {
      const alert = await loadThenFail(status, body)
      expect(alert).toHaveTextContent(text)
      expect(
        screen.queryByText('Could not refresh. Showing the last result.')
      ).not.toBeInTheDocument()
      gone()
    }
  )

  it('an audit failure on Reload keeps the case, marked stale, with a working Reload', async () => {
    const alert = await loadThenFail(503, errorBody(503, 'audit_unavailable'))
    expect(alert).toHaveTextContent('Could not refresh. Showing the last result.')
    expect(screen.getByText('quiet-fox-1234')).toBeInTheDocument()
  })

  it('shows a sign-in link when the session is gone', async () => {
    mockApi(detailHandler(() => json({ statusCode: 401, message: 'Unauthorized' }, 401)))
    render(<ModerationCaseDetailView caseId="post.p1" />)
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/signin'
    )
  })

  it('429 asks the moderator to wait and offers Try again', async () => {
    let call = 0
    mockApi(
      detailHandler(() =>
        ++call === 1 ? json({ statusCode: 429 }, 429) : json({ data: detail() })
      )
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many requests. Wait a moment, then try again.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { level: 1, name: 'Post case' })
  })

  it('a 400 on a case read is a server fault, never "That filter is not valid."', async () => {
    mockApi(detailHandler(() => json(errorBody(400, 'invalid_filter'), 400)))
    render(<ModerationCaseDetailView caseId="post.p1" />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This case could not be opened. Try again.')
    expect(alert).not.toHaveTextContent('filter')
  })
})

describe('review findings: reload feedback and a changing case', () => {
  it('Reload stays focusable and inert while it reads, and sends one read', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const reads: string[] = []
    mockApi(
      detailHandler(async (_id, call) => {
        if (call > 1) await gate
        return json({ data: detail() })
      }, reads)
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    const reload = screen.getByRole('button', { name: 'Reload case' })
    reload.focus()
    await userEvent.click(reload)
    expect(reload).toHaveAttribute('aria-disabled', 'true')
    expect(reload).not.toBeDisabled()
    expect(document.activeElement).toBe(reload)
    await userEvent.click(reload)
    expect(reads).toHaveLength(2)
    act(() => release())
    await waitFor(() => expect(reload).toHaveAttribute('aria-disabled', 'false'))
  })

  it('a new case id clears the old case at once and shows only the new one', async () => {
    mockApi(
      detailHandler((id) =>
        json({
          data: detail({
            caseId: id as never,
            subject: { state: 'alias', alias: `alias-of-${id}` },
          }),
        })
      )
    )
    const view = render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByText('alias-of-post.p1')
    view.rerender(<ModerationCaseDetailView caseId="post.p2" />)
    expect(screen.queryByText('alias-of-post.p1')).not.toBeInTheDocument()
    expect(await screen.findByText('alias-of-post.p2')).toBeInTheDocument()
  })

  it('an answer for the old case that arrives late never overwrites the new case', async () => {
    let releaseOld: () => void = () => undefined
    const oldGate = new Promise<void>((resolve) => (releaseOld = resolve))
    mockApi(
      detailHandler(async (id) => {
        if (id === 'post.p1') await oldGate
        return json({
          data: detail({ subject: { state: 'alias', alias: `alias-of-${id}` } }),
        })
      })
    )
    const view = render(<ModerationCaseDetailView caseId="post.p1" />)
    view.rerender(<ModerationCaseDetailView caseId="post.p2" />)
    await screen.findByText('alias-of-post.p2')
    act(() => releaseOld())
    expect(screen.getByText('alias-of-post.p2')).toBeInTheDocument()
    expect(screen.queryByText('alias-of-post.p1')).not.toBeInTheDocument()
  })
})

describe('review findings: findings that a newer server may send', () => {
  it('shows a neutral label for a category it does not know, never the raw key', async () => {
    mockApi(
      detailHandler(() =>
        json({
          data: detail({
            findings: {
              codes: [],
              categories: ['somethingNew', 'language'],
              engineVersion: null,
              operatorNote: null,
            },
          }),
        })
      )
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText('Other finding, Language')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('moderation.category')
  })

  it('says the case was held with no recorded code, outside any definition list', async () => {
    mockApi(
      detailHandler(() =>
        json({
          data: detail({
            findings: {
              codes: [],
              categories: [],
              engineVersion: null,
              operatorNote: null,
            },
          }),
        })
      )
    )
    const { container } = render(<ModerationCaseDetailView caseId="post.p1" />)
    const text = await screen.findByText('Held for review without a recorded code.')
    expect(text.closest('dl')).toBeNull()
    expect(container.querySelectorAll('dl > p')).toHaveLength(0)
  })
})
