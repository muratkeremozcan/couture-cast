// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-QUEUE, -STATES, -FORBIDDEN-NO-DATA, -DEDUPE, -FILTERS, -HOSTILE-TEXT, -NO-ACTIONS.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import {
  errorBody,
  json,
  page,
  queueHandler,
  signIn,
  summary,
  type RecordedQuery,
} from '../../test-utils/moderation-console'
import { ModerationQueueView } from './moderation-queue'

const RLO = String.fromCodePoint(0x202e)
beforeEach(() => signIn())
afterEach(() => window.sessionStorage.clear())

const three = [
  summary({
    caseId: 'orphan-post.r9',
    risk: 'high',
    slaState: 'breached',
    slaDueAt: '2026-11-03T11:00:00.000Z',
    reasons: ['violence'],
    excerpt: 'Orphan caption',
    locale: 'de-DE',
  }),
  summary({
    caseId: 'comment.c1',
    source: 'comment',
    risk: 'medium',
    reasons: ['spam', 'harassment'],
    reportCount: 3,
    excerpt: null,
    locale: null,
    hasFinding: true,
  }),
  summary({ caseId: 'post.p3', risk: 'low', reasons: ['other'] }),
]

async function openQueue(items = three, nextCursor: string | null = null) {
  const seen: RecordedQuery[] = []
  mockApi(queueHandler(() => json(page(items, nextCursor)), seen))
  render(<ModerationQueueView />)
  await screen.findByRole('list', { name: 'Cases' })
  return seen
}

describe('C-WEB-Q-QUEUE', () => {
  it('renders the cases in the order the API returned them, with localized labels', async () => {
    await openQueue()
    const rows = within(screen.getByRole('list', { name: 'Cases' })).getAllByRole(
      'listitem'
    )
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('Risk: High')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Risk: Medium')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Risk: Low')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Breached')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Comment case')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Reports: 3/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Spam, Harassment/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Screening finding/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/de-DE/)).toBeInTheDocument()
    // No raw enum value leaks into the page. The case id is the one raw token, and only in the link name.
    expect(document.body.textContent).not.toMatch(
      /\b(on_track|at_risk|hate_speech|inappropriate_content)\b/
    )
  })

  it('links each case to its detail with an encoded id and gives the link an accessible name', async () => {
    await openQueue()
    const links = screen.getAllByRole('link', { name: /^(Post|Comment) case/ })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/moderation/cases/orphan-post.r9',
      '/moderation/cases/comment.c1',
      '/moderation/cases/post.p3',
    ])
  })

  it('announces the result count in one polite live region', async () => {
    await openQueue()
    const regions = screen.getAllByRole('status')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toHaveAttribute('aria-live', 'polite')
    expect(regions[0]).toHaveTextContent('Cases shown: 3')
  })

  it('offers refresh and load more only, and no decision control (C-WEB-Q-NO-ACTIONS)', async () => {
    await openQueue(three, 'next.cursor')
    const names = screen.getAllByRole('button').map((button) => button.textContent)
    expect(names).toEqual(['Refresh', 'Load more'])
    expect(document.body.textContent?.toLowerCase()).not.toMatch(
      /\b(resolve|release|take ?down|escalate|ban|suspend)\b/
    )
  })

  it('pages with the signed cursor verbatim and appends the next page', async () => {
    const seen: RecordedQuery[] = []
    mockApi(
      queueHandler((query) => {
        return query.cursor
          ? json(page([summary({ caseId: 'post.p9', excerpt: 'Second page' })], null))
          : json(page(three, 'sig.cursor-1_x'))
      }, seen)
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Second page')
    expect(seen.at(-1)).toMatchObject({ status: 'open', cursor: 'sig.cursor-1_x' })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Cases shown: 4')
  })
})

describe('C-WEB-Q-DEDUPE', () => {
  it('renders a case once when it comes back on the next page', async () => {
    mockApi(
      queueHandler((query) =>
        query.cursor
          ? json(
              page([three[2]!, summary({ caseId: 'post.p10', excerpt: 'Fresh' })], null)
            )
          : json(page(three, 'c1'))
      )
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Fresh')
    const hrefs = screen
      .getAllByRole('link', { name: /^(Post|Comment) case/ })
      .map((a) => a.getAttribute('href'))
    expect(hrefs.filter((href) => href === '/moderation/cases/post.p3')).toHaveLength(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })
})

describe('C-WEB-Q-STATES', () => {
  it('shows the loading state while the first page is in flight', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi(
      queueHandler(async () => {
        await held
        return json(page(three))
      })
    )
    render(<ModerationQueueView />)
    expect(await screen.findByText('Loading')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('list', { name: 'Cases' })).not.toBeInTheDocument()
    release()
    await screen.findByRole('list', { name: 'Cases' })
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  it('shows the empty state when nothing is open', async () => {
    mockApi(queueHandler(() => json(page([]))))
    render(<ModerationQueueView />)
    expect(await screen.findByText('No open cases.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Cases' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Cases shown: 0')
  })

  it('shows the filtered-empty state when a filter matches nothing', async () => {
    mockApi(queueHandler((query) => json(page(query.risk === 'low' ? [] : three))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.selectOptions(screen.getByLabelText('Risk'), 'low')
    expect(await screen.findByText('No cases match these filters.')).toBeInTheDocument()
    expect(screen.queryByText('No open cases.')).not.toBeInTheDocument()
  })

  it('shows a retryable error when the first load fails, then recovers', async () => {
    let attempts = 0
    mockApi(
      queueHandler(() =>
        ++attempts === 1 ? json({ statusCode: 500 }, 500) : json(page(three))
      )
    )
    render(<ModerationQueueView />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The moderation queue is unavailable. Try again.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('list', { name: 'Cases' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the list and marks it stale when a refresh fails after a good load', async () => {
    let attempts = 0
    mockApi(
      queueHandler(() =>
        ++attempts === 1 ? json(page(three)) : json({ statusCode: 500 }, 500)
      )
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not refresh. Showing the last result.')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('keeps the list and marks it stale when load more fails', async () => {
    mockApi(
      queueHandler((query) =>
        query.cursor ? json({ statusCode: 500 }, 500) : json(page(three, 'c1'))
      )
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last result')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('shows the closed message for an invalid cursor and an invalid filter', async () => {
    mockApi(queueHandler(() => json(errorBody(400, 'invalid_cursor'), 400)))
    render(<ModerationQueueView />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The page link is no longer valid. Refresh the queue.'
    )
  })
})

describe('C-WEB-Q-FORBIDDEN-NO-DATA', () => {
  it.each([
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
    [401, { statusCode: 401, message: 'Unauthorized' }, 'Sign in again to continue.'],
  ])(
    'renders a neutral state for %s with no case data and no further request',
    async (status, body, message) => {
      const seen: RecordedQuery[] = []
      mockApi(queueHandler(() => json(body, status), seen))
      render(<ModerationQueueView />)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(seen).toHaveLength(1)
      // Nothing a case could put on screen: no list, no filters, no retry loop, no excerpt.
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(screen.queryByRole('search')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(/Caption|Reports:|Risk:/)
    }
  )

  it('signs out of the page when the session is gone, without calling the API', async () => {
    signIn(null)
    const seen: RecordedQuery[] = []
    mockApi(queueHandler(() => json(page(three)), seen))
    render(<ModerationQueueView />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign in again to continue.'
    )
    expect(seen).toHaveLength(0)
  })
})

describe('C-WEB-Q-FILTERS', () => {
  it('labels every control and sends one value per filter, resetting the cursor on change', async () => {
    const seen: RecordedQuery[] = []
    mockApi(queueHandler((query) => json(page(three, query.cursor ? null : 'c1')), seen))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    expect(screen.getByRole('search', { name: 'Filter cases' })).toBeInTheDocument()
    for (const label of ['Source', 'Locale', 'Risk', 'Status', 'Time'])
      expect(screen.getByLabelText(label)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(seen.at(-1)?.cursor).toBe('c1'))

    await userEvent.selectOptions(screen.getByLabelText('Source'), 'comment')
    await waitFor(() =>
      expect(seen.at(-1)).toEqual({ status: 'open', source: 'comment' })
    )
    await userEvent.selectOptions(screen.getByLabelText('Locale'), 'es-419')
    await waitFor(() =>
      expect(seen.at(-1)).toEqual({ status: 'open', source: 'comment', locale: 'es-419' })
    )
    await userEvent.selectOptions(screen.getByLabelText('Locale'), 'unknown')
    await waitFor(() => expect(seen.at(-1)?.locale).toBe('unknown'))
    await userEvent.selectOptions(screen.getByLabelText('Time'), 'breached')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'resolved')
    await waitFor(() =>
      expect(seen.at(-1)).toMatchObject({
        status: 'resolved',
        sla: 'breached',
        source: 'comment',
      })
    )
    expect(seen.at(-1)).not.toHaveProperty('cursor')

    await userEvent.selectOptions(screen.getByLabelText('Source'), '')
    await waitFor(() => expect(seen.at(-1)).not.toHaveProperty('source'))
  })

  it('keeps every locale label readable and never shows a raw key', async () => {
    await openQueue()
    const options = within(screen.getByLabelText('Locale')).getAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(12)
    expect(options.map((option) => option.textContent)).toContain('No locale')
    expect(document.body.textContent).not.toContain('moderation.')
  })
})

describe('C-WEB-Q-HOSTILE-TEXT: the excerpt', () => {
  it('renders markup, links and bidi controls as inert text', async () => {
    const hostile = `<img src=x onerror=alert(1)><script>alert(1)</script> [x](javascript:alert(1)) ${RLO}evil`
    await openQueue([summary({ excerpt: hostile })])
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    // The only link is the case link; the excerpt's markdown link is text.
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/moderation/cases/post.p1',
    ])
    expect(screen.getByText(/alert\(1\)/)).toBeInTheDocument()
    const holder = screen.getByText(/alert\(1\)/).closest('[dir]')
    expect(holder).toHaveAttribute('dir', 'auto')
    expect(holder).toHaveStyle({ unicodeBidi: 'isolate' })
  })
})

describe('review findings: a failed refresh never keeps data the viewer may no longer see', () => {
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
  ])(
    'a %i on Refresh clears every case and shows the terminal state',
    async (status, body, text) => {
      let attempts = 0
      mockApi(
        queueHandler(() => (++attempts === 1 ? json(page(three)) : json(body, status)))
      )
      render(<ModerationQueueView />)
      await screen.findByRole('list', { name: 'Cases' })
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(text)
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(screen.queryByText('Orphan caption')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(
        screen.queryByText('Could not refresh. Showing the last result.')
      ).not.toBeInTheDocument()
    }
  )

  it('a 404 on a queue read is a server fault, never the re-keyed copy', async () => {
    mockApi(queueHandler(() => json({ statusCode: 404 }, 404)))
    render(<ModerationQueueView />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The moderation queue is unavailable. Try again.')
    expect(alert).not.toHaveTextContent('re-keyed')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('offers a sign-in link when the session is gone', async () => {
    mockApi(queueHandler(() => json({ statusCode: 401, message: 'Unauthorized' }, 401)))
    render(<ModerationQueueView />)
    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/signin')
  })
})

describe('review findings: closed error states', () => {
  it('429 on the first read says to wait and offers Try again', async () => {
    let attempts = 0
    mockApi(
      queueHandler(() =>
        ++attempts === 1 ? json({ statusCode: 429 }, 429) : json(page(three))
      )
    )
    render(<ModerationQueueView />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many requests. Wait a moment, then try again.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await screen.findByRole('list', { name: 'Cases' })
  })

  it('an invalid filter on the first page keeps the filters visible and offers no pointless retry', async () => {
    mockApi(queueHandler(() => json(errorBody(400, 'invalid_filter'), 400)))
    render(<ModerationQueueView />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That filter is not valid.')
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Source' })).toBeInTheDocument()
  })

  it('an invalid cursor on Load more keeps the list and offers a refresh from the first page', async () => {
    const seen: RecordedQuery[] = []
    mockApi(
      queueHandler(
        (query) =>
          query.cursor
            ? json(errorBody(400, 'invalid_cursor'), 400)
            : json(page(three, 'c1')),
        seen
      )
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'The page link is no longer valid. Refresh the queue.'
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(seen.at(-1)?.cursor).toBeUndefined())
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('review findings: focus and busy feedback', () => {
  it('moves focus to the first new case after Load more, even when Load more goes away', async () => {
    const more = [summary({ caseId: 'post.p4' }), summary({ caseId: 'post.p5' })]
    mockApi(
      queueHandler((query) => (query.cursor ? json(page(more)) : json(page(three, 'c1'))))
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(document.getElementById('case-link-post.p4'))
  })

  it('Load more stays focusable and inert while it loads, and sends one request', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const seen: RecordedQuery[] = []
    mockApi(
      queueHandler(async (query) => {
        if (!query.cursor) return json(page(three, 'c1'))
        await gate
        return json(page([summary({ caseId: 'post.p4' })]))
      }, seen)
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    const button = screen.getByRole('button', { name: 'Load more' })
    button.focus()
    await userEvent.click(button)
    const busy = await screen.findByRole('button', { name: 'Loading more' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
    expect(document.activeElement).toBe(busy)
    await userEvent.click(busy)
    act(() => release())
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4))
    expect(seen.filter((query) => query.cursor)).toHaveLength(1)
  })

  it('Refresh shows it is busy, ignores a second click, and says the list restarted', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const seen: RecordedQuery[] = []
    mockApi(
      queueHandler(async (query, call) => {
        if (call > 1) await gate
        return query.cursor
          ? json(page([summary({ caseId: 'post.p4' })]))
          : json(page(three, 'c1'))
      }, seen)
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    const busy = await screen.findByRole('button', { name: 'Refreshing' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(busy)
    expect(seen).toHaveLength(2)
    act(() => release())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Refreshed from the first page. Cases shown: 3'
    )
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})

describe('round 2: retry feedback and focus at the end of the list', () => {
  it('the Try again of a failed first load shows it is busy and ignores a second click', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const seen: RecordedQuery[] = []
    mockApi(
      queueHandler(async (_query, call) => {
        if (call === 1) return json({ statusCode: 500 }, 500)
        await gate
        return json(page(three))
      }, seen)
    )
    render(<ModerationQueueView />)
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    const busy = await screen.findByRole('button', { name: 'Trying again' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(busy)
    expect(seen).toHaveLength(2)
    act(() => release())
    await screen.findByRole('list', { name: 'Cases' })
  })

  it('moves focus to Refresh when Load more returns only known cases and the list ends', async () => {
    mockApi(queueHandler((query) => json(page(three, query.cursor ? null : 'c1'))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Refresh' }))
  })

  it('leaves focus on Load more when a page adds nothing but more pages remain', async () => {
    mockApi(queueHandler(() => json(page(three, 'c1'))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    const more = screen.getByRole('button', { name: 'Load more' })
    more.focus()
    await userEvent.click(more)
    await waitFor(() => expect(more).toHaveAttribute('aria-disabled', 'false'))
    expect(document.activeElement).toBe(more)
  })
})

describe('CodeRabbit review: empty state, retry and link names', () => {
  it('says no cases match when the Resolved status is chosen and nothing is resolved', async () => {
    mockApi(queueHandler((query) => json(page(query.status === 'resolved' ? [] : three))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'resolved')
    expect(await screen.findByText('No cases match these filters.')).toBeInTheDocument()
    expect(screen.queryByText('No open cases.')).not.toBeInTheDocument()
  })

  it('keeps Refresh on an empty queue so a new report can be picked up', async () => {
    let calls = 0
    mockApi(queueHandler(() => json(page(++calls === 1 ? [] : three))))
    render(<ModerationQueueView />)
    expect(await screen.findByText('No open cases.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('list', { name: 'Cases' })
    expect(screen.queryByText('No open cases.')).not.toBeInTheDocument()
  })

  it('retries a failed Load more with the same cursor and keeps the loaded cases', async () => {
    const more = [summary({ caseId: 'post.p4' })]
    const seen: RecordedQuery[] = []
    let failedOnce = false
    mockApi(
      queueHandler((query) => {
        if (!query.cursor) return json(page(three, 'c1'))
        if (!failedOnce) {
          failedOnce = true
          return json({ statusCode: 500 }, 500)
        }
        return json(page(more))
      }, seen)
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4))
    expect(seen.map((query) => query.cursor)).toEqual([undefined, 'c1', 'c1'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('gives two cases from one source different link names', async () => {
    await openQueue([
      summary({ caseId: 'post.a', excerpt: 'First caption' }),
      summary({ caseId: 'post.b', excerpt: 'Second caption' }),
      summary({ caseId: 'post.c', excerpt: null }),
    ])
    expect(
      screen.getByRole('link', { name: 'Post case First caption Case post.a' })
    ).toHaveAttribute('href', '/moderation/cases/post.a')
    expect(
      screen.getByRole('link', { name: 'Post case Second caption Case post.b' })
    ).toBeVisible()
    // With no excerpt the case id tells the case apart.
    expect(screen.getByRole('link', { name: 'Post case Case post.c' })).toBeVisible()
  })

  it('keeps two cases with the same caption apart by their case id', async () => {
    await openQueue([
      summary({ caseId: 'post.a', excerpt: 'Same caption' }),
      summary({ caseId: 'post.b', excerpt: 'Same caption' }),
    ])
    const names = screen.getAllByRole('link').map((link) => link.textContent)
    expect(
      screen.getByRole('link', { name: 'Post case Same caption Case post.a' })
    ).toHaveAttribute('href', '/moderation/cases/post.a')
    expect(
      screen.getByRole('link', { name: 'Post case Same caption Case post.b' })
    ).toHaveAttribute('href', '/moderation/cases/post.b')
    expect(names).toHaveLength(2)
  })

  it('drops the stale notice when a filter change starts a new query that also fails', async () => {
    mockApi(
      queueHandler((query) => {
        if (query.risk === 'low') return json({ statusCode: 500 }, 500)
        if (query.cursor) return json({ statusCode: 500 }, 500)
        return json(page(three, 'c1'))
      })
    )
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last result')
    await userEvent.selectOptions(screen.getByLabelText('Risk'), 'low')
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The moderation queue is unavailable. Try again.'
    )
    expect(screen.queryByText(/Showing the last result/)).not.toBeInTheDocument()
  })
})
