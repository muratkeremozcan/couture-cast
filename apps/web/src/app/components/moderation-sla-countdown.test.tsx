// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-COUNTDOWN. The DOM ticks on the minute and at each state boundary,
// assistive technology hears only a change of SLA state, and the browser clock never decides the answer.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOUNDARY_SLACK_MS,
  SlaCountdown,
  formatDuration,
} from './moderation-sla-countdown'

const SERVER = Date.parse('2026-11-03T12:00:00.000Z')
const iso = (offsetMs: number) => new Date(SERVER + offsetMs).toISOString()
const HOUR = 3_600_000
const MINUTE = 60_000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(SERVER))
})
afterEach(() => vi.useRealTimers())

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe('C-WEB-Q-COUNTDOWN: the readout', () => {
  it.each([
    [90 * MINUTE, '1 h 30 min left', 'At risk'],
    [5 * HOUR + 59 * MINUTE, '5 h 59 min left', 'At risk'],
    [7 * HOUR, '7 h 0 min left', 'On track'],
    [30 * HOUR, '1 d 6 h left', 'On track'],
    [45 * 1000, '0 min left', 'At risk'],
  ])('shows %i ms as %s', (offset, text, state) => {
    render(<SlaCountdown dueAt={iso(offset)} clockOffsetMs={0} resolved={false} />)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByText(state)).toBeInTheDocument()
  })

  it('shows overdue time and the breached state after the due time', () => {
    render(<SlaCountdown dueAt={iso(-95 * MINUTE)} clockOffsetMs={0} resolved={false} />)
    expect(screen.getByText('Overdue by 1 h 35 min')).toBeInTheDocument()
    expect(screen.getByText('Breached')).toBeInTheDocument()
    expect(document.querySelector('[data-sla-state]')).toHaveAttribute(
      'data-sla-state',
      'breached'
    )
  })

  it('shows a resolved case as resolved with no clock and starts no timer', () => {
    render(<SlaCountdown dueAt={iso(-HOUR)} clockOffsetMs={0} resolved />)
    expect(screen.getAllByText('Resolved')).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('formats whole minutes and never a negative duration', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}:${JSON.stringify(options)}`
    expect(formatDuration(-5000, t)).toBe('moderation.duration.m:{"minutes":0}')
    expect(formatDuration(59_999, t)).toBe('moderation.duration.m:{"minutes":0}')
    expect(formatDuration(HOUR, t)).toBe('moderation.duration.hm:{"hours":1,"minutes":0}')
    expect(formatDuration(25 * HOUR, t)).toBe(
      'moderation.duration.dh:{"days":1,"hours":1}'
    )
  })
})

describe('C-WEB-Q-COUNTDOWN: the server clock', () => {
  it('shows the true remaining time when the browser clock runs ten minutes ahead', () => {
    vi.setSystemTime(new Date(SERVER + 10 * MINUTE))
    render(
      <SlaCountdown dueAt={iso(3 * HOUR)} clockOffsetMs={-10 * MINUTE} resolved={false} />
    )
    expect(screen.getByText('3 h 0 min left')).toBeInTheDocument()
  })

  it('reads the state from the server clock too: ten browser minutes ahead do not breach a case', () => {
    vi.setSystemTime(new Date(SERVER + 10 * MINUTE))
    render(
      <SlaCountdown
        dueAt={iso(5 * MINUTE)}
        clockOffsetMs={-10 * MINUTE}
        resolved={false}
      />
    )
    expect(screen.getByText('At risk')).toBeInTheDocument()
    expect(screen.queryByText('Breached')).not.toBeInTheDocument()
  })
})

describe('C-WEB-Q-COUNTDOWN: ticking and announcing', () => {
  it('changes the DOM text once per minute and not between minutes', async () => {
    render(<SlaCountdown dueAt={iso(90 * MINUTE)} clockOffsetMs={0} resolved={false} />)
    const readout = screen.getByText('1 h 30 min left')
    const mutations: string[] = []
    const observer = new MutationObserver(() => mutations.push(readout.textContent ?? ''))
    observer.observe(readout, { childList: true, characterData: true, subtree: true })
    // The shown minute is a floor, so an exact minute is stale a millisecond later and the first tick is immediate.
    await advance(BOUNDARY_SLACK_MS)
    expect(readout.textContent).toBe('1 h 29 min left')
    await advance(59_000)
    expect(readout.textContent).toBe('1 h 29 min left')
    await advance(1_000)
    expect(readout.textContent).toBe('1 h 28 min left')
    await advance(3 * MINUTE)
    expect(readout.textContent).toBe('1 h 25 min left')
    await Promise.resolve()
    // One change per minute at most: 29, 28, 27, 26, 25.
    expect(mutations.length).toBeLessThanOrEqual(5)
    observer.disconnect()
  })

  it('stays silent in the queue and announces only the state label in the case view', async () => {
    const { rerender } = render(
      <SlaCountdown
        dueAt={iso(6 * HOUR + 2 * MINUTE)}
        clockOffsetMs={0}
        resolved={false}
      />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(
      <SlaCountdown
        dueAt={iso(6 * HOUR + 2 * MINUTE)}
        clockOffsetMs={0}
        resolved={false}
        announce
      />
    )
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('On track')
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(region.textContent ?? ''))
    observer.observe(region, { childList: true, characterData: true, subtree: true })

    // Ten minutes of ticks inside one state: the live region does not change.
    await advance(2 * MINUTE + BOUNDARY_SLACK_MS)
    expect(region).toHaveTextContent('At risk')
    const afterTransition = seen.length
    await advance(3 * MINUTE)
    expect(seen.length).toBe(afterTransition)
    // The minute-by-minute readout is not the live region.
    expect(region.textContent).not.toMatch(/min/)
    observer.disconnect()
  })

  it('announces breach exactly once when the due time passes', async () => {
    render(
      <SlaCountdown dueAt={iso(2 * MINUTE)} clockOffsetMs={0} resolved={false} announce />
    )
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('At risk')
    await advance(2 * MINUTE + BOUNDARY_SLACK_MS)
    expect(region).toHaveTextContent('Breached')
    await advance(5 * MINUTE)
    expect(region).toHaveTextContent('Breached')
  })

  it('clears its timer on unmount', () => {
    const { unmount } = render(
      <SlaCountdown dueAt={iso(HOUR)} clockOffsetMs={0} resolved={false} />
    )
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flips to at risk at the boundary, not at the next minute tick', async () => {
    render(
      <SlaCountdown
        dueAt={iso(6 * HOUR + 30_000)}
        clockOffsetMs={0}
        resolved={false}
        announce
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('On track')
    await advance(30_000 + BOUNDARY_SLACK_MS)
    expect(screen.getByRole('status')).toHaveTextContent('At risk')
  })

  it('resyncs at once when a throttled tab becomes visible again', () => {
    render(<SlaCountdown dueAt={iso(HOUR)} clockOffsetMs={0} resolved={false} />)
    expect(screen.getByText('1 h 0 min left')).toBeInTheDocument()
    // A background tab never ran its timers: the clock moved, nothing fired.
    vi.setSystemTime(new Date(SERVER + 30 * MINUTE))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByText('30 min left')).toBeInTheDocument()
  })

  it('honors reduced motion by animating nothing', () => {
    const { container } = render(
      <SlaCountdown dueAt={iso(HOUR)} clockOffsetMs={0} resolved={false} announce />
    )
    expect(container.innerHTML).not.toMatch(/animate-|transition|motion-/)
  })
})
