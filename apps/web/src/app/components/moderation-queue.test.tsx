// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-QUEUE, -STATES, -FORBIDDEN-NO-DATA, -DEDUPE, -FILTERS, -HOSTILE-TEXT, -NO-ACTIONS.
import { render, screen, waitFor, within } from '@testing-library/react'
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
    // No raw enum value leaks into the page.
    expect(document.body.textContent).not.toMatch(
      /\b(on_track|at_risk|hate_speech|inappropriate_content|orphan-post)\b/
    )
  })

  it('links each case to its detail with an encoded id and gives the link an accessible name', async () => {
    await openQueue()
    const links = screen.getAllByRole('link', { name: /case$/ })
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
      .getAllByRole('link', { name: /case$/ })
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
    expect(screen.queryByRole('link', { name: /x/ })).toBeNull()
    expect(screen.getByText(/alert\(1\)/)).toBeInTheDocument()
    const holder = screen.getByText(/alert\(1\)/).closest('[dir]')
    expect(holder).toHaveAttribute('dir', 'auto')
    expect(holder).toHaveStyle({ unicodeBidi: 'isolate' })
  })
})
