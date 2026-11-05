// Story 6.12 test owner: C-WEB-STATES, -NO-WRITE, -LINKS, -ANNOUNCE, -LABELS, -TIME, -A11Y.
// The page is read-only and every state it can reach renders on its own. Fixtures parse through the
// shipped contract, so a drifting field fails here first.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  moderationSlaAlertKinds,
  moderationSlaDeliveryStates,
  moderationSlaFailureCodes,
  moderationSlaResponseSchema,
  type ModerationSlaRecentAlert,
  type ModerationSlaSummary,
} from '@couture/api-client/contracts/http'
import enUS from '../../i18n/locales/en-US.json'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import { errorBody, json, signIn } from '../../test-utils/moderation-console'
import { ModerationSlaDashboard } from './moderation-sla-dashboard'
import { ModerationQueueView } from './moderation-queue'

const SLA_PATH = '*/api/v1/moderation/sla'
const NOW = '2026-11-05T12:00:00.000Z'
const labels = enUS.moderation.sla

function alert(
  overrides: Partial<ModerationSlaRecentAlert> = {}
): ModerationSlaRecentAlert {
  return {
    id: 'alert-1',
    kind: 'breached',
    caseId: 'post.abc',
    source: 'post',
    risk: 'high',
    slaDueAt: NOW,
    detectedAt: NOW,
    delivery: 'delivered',
    attempts: 1,
    lastErrorCode: null,
    deliveredAt: NOW,
    ...overrides,
  }
}

function summary(overrides: Partial<ModerationSlaSummary> = {}) {
  return moderationSlaResponseSchema.parse({
    data: {
      serverNow: NOW,
      monitor: { lastSweepAt: NOW, stale: false, channel: 'webhook' },
      queue: { onTrack: 4, atRisk: 3, breached: 2, escalated: 1, oldestDueAt: NOW },
      resolution: { windowDays: 7, resolved: 9, withinSla: 8, late: 1 },
      alerts: { pending: 5, failing: 2, consoleOnly: 6 },
      screening: { oldestPendingReviewAt: null },
      recentAlerts: [alert()],
      ...overrides,
    },
  })
}

function serve(...bodies: unknown[]) {
  const calls: Request[] = []
  let index = 0
  mockApi(
    http.get(SLA_PATH, ({ request }) => {
      calls.push(request)
      const body = bodies[Math.min(index, bodies.length - 1)]
      index += 1
      return body instanceof Response ? body.clone() : json(body as never)
    })
  )
  return calls
}

beforeEach(() => signIn())
afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
})

const metric = (label: string, region: HTMLElement) =>
  within(region).getByText(label).parentElement!.querySelector('dd')!.textContent

describe('C-WEB-STATES: every state renders on its own', () => {
  it('loading, then the counts of each panel', async () => {
    serve(summary())
    render(<ModerationSlaDashboard />)
    expect(screen.getByText(enUS.moderation.state.loading)).toHaveAttribute(
      'aria-busy',
      'true'
    )
    const queue = await screen.findByRole('region', { name: labels.queueTitle })
    expect(metric(enUS.moderation.slaState.on_track, queue)).toBe('4')
    expect(metric(enUS.moderation.slaState.at_risk, queue)).toBe('3')
    expect(metric(enUS.moderation.slaState.breached, queue)).toBe('2')
    expect(metric(labels.escalated, queue)).toBe('1')
    const resolution = screen.getByRole('region', { name: /Resolved in the last 7 days/ })
    expect(metric(labels.withinSla, resolution)).toBe('8')
    expect(metric(labels.late, resolution)).toBe('1')
    const delivery = screen.getByRole('region', { name: labels.deliveryTitle })
    expect(metric(labels.delivery.pending, delivery)).toBe('5')
    expect(metric(labels.failing, delivery)).toBe('2')
    expect(metric(labels.delivery.console_only, delivery)).toBe('6')
    expect(screen.queryByText(enUS.moderation.state.loading)).toBeNull()
  })

  it('empty: no open cases, no alerts, nothing waiting', async () => {
    serve(
      summary({
        queue: { onTrack: 0, atRisk: 0, breached: 0, escalated: 0, oldestDueAt: null },
        recentAlerts: [],
      })
    )
    render(<ModerationSlaDashboard />)
    expect(await screen.findByText(labels.noOpen)).toBeVisible()
    expect(screen.getByText(labels.recentEmpty)).toBeVisible()
    expect(screen.getByText(labels.screeningClear)).toBeVisible()
  })

  it('a monitor that never ran, with no channel notice', async () => {
    serve(summary({ monitor: { lastSweepAt: null, stale: true, channel: null } }))
    const { container } = render(<ModerationSlaDashboard />)
    const panel = await screen.findByRole('region', { name: labels.monitorTitle })
    expect(within(panel).getByText(labels.monitorNever)).toBeVisible()
    expect(container.querySelector('[data-channel]')).toBeNull()
  })

  it('a stale monitor shows a banner and keeps the rest of the page usable', async () => {
    serve(summary({ monitor: { lastSweepAt: NOW, stale: true, channel: 'webhook' } }))
    const { container } = render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    const banner = container.querySelector('[data-monitor-stale="true"]')
    expect(banner?.textContent).toContain('has not run since')
    expect(screen.getByRole('link', { name: labels.openCase })).toBeVisible()
  })

  it('a healthy monitor shows no stale banner', async () => {
    serve(summary())
    const { container } = render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    expect(container.querySelector('[data-monitor-stale="true"]')).toBeNull()
  })

  it('the console-only notice says nobody is notified', async () => {
    serve(summary({ monitor: { lastSweepAt: NOW, stale: false, channel: 'console' } }))
    render(<ModerationSlaDashboard />)
    expect(await screen.findByText(labels.channelConsole)).toBeVisible()
    expect(screen.queryByText(labels.channelWebhook)).toBeNull()
  })

  it('disabled: 503 moderation_sla_disabled shows the turned-off text and no data', async () => {
    serve(json({ statusCode: 503, code: 'moderation_sla_disabled', message: 'x' }, 503))
    render(<ModerationSlaDashboard />)
    expect(await screen.findByText(labels.disabled)).toBeVisible()
    expect(screen.queryByRole('region', { name: labels.queueTitle })).toBeNull()
    expect(screen.queryByRole('button', { name: /try again|retry/i })).toBeNull()
  })

  it('forbidden: a 403 shows no data and offers no retry', async () => {
    serve(json(errorBody(403, 'forbidden'), 403))
    render(<ModerationSlaDashboard />)
    expect(await screen.findByText(enUS.moderation.state.forbidden)).toBeVisible()
    expect(screen.queryByRole('region', { name: labels.queueTitle })).toBeNull()
  })

  it('error: a 500 offers a retry, and the retry recovers', async () => {
    const calls = serve(json({ message: 'boom' }, 500), summary())
    const user = userEvent.setup()
    render(<ModerationSlaDashboard />)
    expect(await screen.findByText(labels.unavailable)).toBeVisible()
    await user.click(screen.getByRole('button', { name: enUS.moderation.state.retry }))
    expect(await screen.findByRole('region', { name: labels.queueTitle })).toBeVisible()
    expect(calls).toHaveLength(2)
  })

  it('a refresh that fails keeps the last data and says it may be old', async () => {
    serve(summary(), json({ message: 'boom' }, 500))
    const user = userEvent.setup()
    render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    await user.click(screen.getByRole('button', { name: enUS.moderation.queue.refresh }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      enUS.moderation.state.stale
    )
    expect(screen.getByRole('region', { name: labels.queueTitle })).toBeVisible()
  })
})

describe('C-WEB-NO-WRITE: the page is read-only', () => {
  it('holds links and a refresh only, and sends only GETs', async () => {
    const methods: string[] = []
    mockApi(
      http.all('*/api/*', ({ request }) => {
        methods.push(request.method)
        return json(summary())
      })
    )
    render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    const refresh = screen.getByRole('button', { name: enUS.moderation.queue.refresh })
    expect(screen.getAllByRole('button')).toEqual([refresh])
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    await userEvent.click(refresh)
    await waitFor(() => expect(methods).toEqual(['GET', 'GET']))
  })

  it('sends the bearer the console holds', async () => {
    const calls = serve(summary())
    render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-token-moderator')
  })
})

describe('C-WEB-LINKS', () => {
  it('links an alert to its case, an orphan id included, and links back to the queue', async () => {
    serve(summary({ recentAlerts: [alert({ caseId: 'orphan-post.r_1-a' })] }))
    render(<ModerationSlaDashboard />)
    expect(await screen.findByRole('link', { name: labels.openCase })).toHaveAttribute(
      'href',
      '/moderation/cases/orphan-post.r_1-a'
    )
    expect(
      screen.getByRole('link', { name: enUS.moderation.backToQueue })
    ).toHaveAttribute('href', '/moderation')
  })

  it('the queue header links to the dashboard', async () => {
    mockApi(
      http.get('*/api/v1/moderation/cases', () =>
        json({ data: { items: [], nextCursor: null, serverNow: NOW } })
      )
    )
    render(<ModerationQueueView />)
    expect(
      await screen.findByRole('link', { name: labels.dashboardLink })
    ).toHaveAttribute('href', '/moderation/sla')
  })
})

describe('C-WEB-ANNOUNCE (D12): one polite announcement per change', () => {
  const REFRESH_MS = 60_000
  const liveText = () => screen.getByRole('status').textContent

  const withOnTrack = (onTrack: number, overrides: Partial<ModerationSlaSummary> = {}) =>
    summary({
      queue: { onTrack, atRisk: 3, breached: 2, escalated: 1, oldestDueAt: NOW },
      ...overrides,
    })
  const onTrackShown = () =>
    metric(
      enUS.moderation.slaState.on_track,
      screen.getByRole('region', { name: labels.queueTitle })
    )

  it('stays silent through an auto refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve(withOnTrack(4), withOnTrack(5))
    render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    const seen = new Set<string | null>([liveText()])
    const observer = new MutationObserver(() => seen.add(liveText()))
    observer.observe(screen.getByRole('status'), {
      childList: true,
      characterData: true,
      subtree: true,
    })
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS))
    // The rendered count proves the second answer landed before the silence is read.
    await waitFor(() => expect(onTrackShown()).toBe('5'))
    observer.disconnect()
    expect([...seen]).toEqual([''])
  })

  it('announces once when the monitor turns stale', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const monitor = { lastSweepAt: NOW, stale: true, channel: 'webhook' as const }
    serve(withOnTrack(4), withOnTrack(5, { monitor }), withOnTrack(6, { monitor }))
    render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    const announced: (string | null)[] = []
    const observer = new MutationObserver(() => announced.push(liveText()))
    observer.observe(screen.getByRole('status'), {
      childList: true,
      characterData: true,
      subtree: true,
    })
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS))
    await waitFor(() => expect(onTrackShown()).toBe('5'))
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS))
    await waitFor(() => expect(onTrackShown()).toBe('6'))
    observer.disconnect()
    expect(announced).toEqual([labels.monitorStaleShort])
  })
})

describe('C-WEB-LABELS: every enum renders a human label', () => {
  it.each(moderationSlaAlertKinds)('kind %s', async (kind) => {
    serve(summary({ recentAlerts: [alert({ kind })] }))
    render(<ModerationSlaDashboard />)
    const article = await screen.findByRole('article')
    expect(within(article).getByText(labels.alertKind[kind])).toBeVisible()
    expect(article.textContent).not.toContain(kind === 'at_risk' ? 'at_risk' : `${kind}_`)
  })

  it.each(moderationSlaDeliveryStates)('delivery %s', async (delivery) => {
    serve(summary({ recentAlerts: [alert({ delivery })] }))
    render(<ModerationSlaDashboard />)
    const article = await screen.findByRole('article')
    expect(within(article).getByText(labels.delivery[delivery])).toBeVisible()
    expect(article.textContent).not.toContain(
      delivery === 'console_only' ? 'console_only' : `${delivery}_`
    )
  })

  it.each(moderationSlaFailureCodes)(
    'failure %s, with the attempts',
    async (lastErrorCode) => {
      serve(
        summary({
          recentAlerts: [
            alert({ lastErrorCode, attempts: 3, delivery: 'pending', deliveredAt: null }),
          ],
        })
      )
      render(<ModerationSlaDashboard />)
      const article = await screen.findByRole('article')
      expect(article.textContent).toContain(labels.failure[lastErrorCode])
      expect(article.textContent).toContain('3 attempts')
      expect(article.textContent).not.toContain(lastErrorCode)
    }
  )
})

describe('C-WEB-TIME', () => {
  it('renders a due time inside the repeated hour of 2026-11-01 once, as its own instant', async () => {
    const first = '2026-11-01T06:30:00.000Z'
    const second = '2026-11-01T07:30:00.000Z'
    serve(
      summary({
        recentAlerts: [
          alert({ id: 'a', slaDueAt: first, detectedAt: first, deliveredAt: null }),
          alert({ id: 'b', slaDueAt: second, detectedAt: second, deliveredAt: null }),
        ],
      })
    )
    const zone = process.env.TZ
    process.env.TZ = 'America/Chicago'
    try {
      render(<ModerationSlaDashboard />)
      const articles = await screen.findAllByRole('article')
      expect(articles[0]!.textContent).toContain('Nov 1, 2026, 1:30 AM CDT')
      expect(articles[1]!.textContent).toContain('Nov 1, 2026, 1:30 AM CST')
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})

describe('C-WEB-A11Y', () => {
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  const violations = async (container: HTMLElement) =>
    (
      await axe.run(container, {
        runOnly: { type: 'tag', values: TAGS },
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      })
    ).violations.map((violation) => violation.id)

  it.each([
    ['healthy', summary()],
    [
      'stale',
      summary({ monitor: { lastSweepAt: NOW, stale: true, channel: 'console' } }),
    ],
    ['empty', summary({ recentAlerts: [] })],
  ])('%s has no violation, and headings run in order', async (_name, body) => {
    serve(body)
    const { container } = render(<ModerationSlaDashboard />)
    await screen.findByRole('region', { name: labels.queueTitle })
    expect(await violations(container)).toEqual([])
    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName[1]))
    expect(levels[0]).toBe(1)
    for (const level of levels.slice(1)) expect(level).toBe(2)
  })

  it('disabled has no violation', async () => {
    serve(json({ statusCode: 503, code: 'moderation_sla_disabled', message: 'x' }, 503))
    const { container } = render(<ModerationSlaDashboard />)
    await screen.findByText(labels.disabled)
    expect(await violations(container)).toEqual([])
  })
})
