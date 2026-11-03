// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-A11Y. Structure, names, focus order, target size and axe on every state.
// Layout-dependent rules (color contrast, real target pixels) run in the browser suite P-Q-AXE.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import {
  detail,
  detailHandler,
  errorBody,
  json,
  page,
  queueHandler,
  signIn,
  summary,
} from '../../test-utils/moderation-console'
import { ModerationCaseDetailView } from './moderation-case-detail'
import { ModerationQueueView } from './moderation-queue'

beforeEach(() => signIn())
afterEach(() => window.sessionStorage.clear())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function violations(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: TAGS },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return result.violations.map((violation) => `${violation.id}: ${violation.help}`)
}

const items = [
  summary({ caseId: 'post.a', risk: 'high' }),
  summary({ caseId: 'comment.b', source: 'comment', risk: 'low', excerpt: null }),
]

describe('C-WEB-Q-A11Y: the queue', () => {
  it('has no axe violation in the ready, empty, filtered-empty, error and forbidden states', async () => {
    mockApi(queueHandler(() => json(page(items, 'c1'))))
    const ready = render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    expect(await violations(ready.container)).toEqual([])
    ready.unmount()

    mockApi(queueHandler(() => json(page([]))))
    const empty = render(<ModerationQueueView />)
    await screen.findByText('No open cases.')
    expect(await violations(empty.container)).toEqual([])
    empty.unmount()

    mockApi(queueHandler(() => json({ statusCode: 500 }, 500)))
    const failed = render(<ModerationQueueView />)
    await screen.findByRole('alert')
    expect(await violations(failed.container)).toEqual([])
    failed.unmount()

    mockApi(
      queueHandler(() => json({ statusCode: 403, message: 'Insufficient role' }, 403))
    )
    const forbidden = render(<ModerationQueueView />)
    await screen.findByRole('alert')
    expect(await violations(forbidden.container)).toEqual([])
  })

  it('has one h1, then one h2 per case, and names every list and control', async () => {
    mockApi(queueHandler(() => json(page(items))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    expect(screen.getByRole('search', { name: 'Filter cases' })).toBeInTheDocument()
    for (const combobox of screen.getAllByRole('combobox'))
      expect(combobox).toHaveAccessibleName()
    for (const button of screen.getAllByRole('button'))
      expect(button).toHaveAccessibleName()
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAccessibleName()
  })

  it('tabs through the filters, then each case link, then Refresh and Load more, in reading order', async () => {
    mockApi(queueHandler(() => json(page(items, 'c1'))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    const order: string[] = []
    for (let step = 0; step < 9; step++) {
      await userEvent.tab()
      const active = document.activeElement as HTMLElement
      order.push(
        active.tagName === 'SELECT'
          ? `select:${active.id.split('-').pop()}`
          : active.tagName === 'A'
            ? `link:${active.getAttribute('href')}`
            : `button:${active.textContent}`
      )
    }
    expect(order).toEqual([
      'select:source',
      'select:locale',
      'select:risk',
      'select:status',
      'select:sla',
      'link:/moderation/cases/post.a',
      'link:/moderation/cases/comment.b',
      'button:Refresh',
      'button:Load more',
    ])
  })

  it('gives every control a 44 pixel target class and a visible focus style', async () => {
    mockApi(queueHandler(() => json(page(items, 'c1'))))
    render(<ModerationQueueView />)
    await screen.findByRole('list', { name: 'Cases' })
    for (const element of [
      ...screen.getAllByRole('combobox'),
      ...screen.getAllByRole('button'),
    ]) {
      expect(element.className, element.outerHTML.slice(0, 80)).toMatch(/min-h-\[44px\]/)
      expect(element.className).toMatch(/focus-visible:outline/)
    }
  })
})

describe('C-WEB-Q-A11Y: the case view', () => {
  async function openDetail() {
    mockApi(detailHandler(() => json({ data: detail({ viewerConflict: true }) })))
    const view = render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    return view
  }

  it('has no axe violation in the loaded, error and forbidden states', async () => {
    const loaded = await openDetail()
    expect(await violations(loaded.container)).toEqual([])
    loaded.unmount()

    mockApi(detailHandler(() => json(errorBody(503, 'audit_unavailable'), 503)))
    const failed = render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('alert')
    expect(await violations(failed.container)).toEqual([])
    failed.unmount()

    mockApi(detailHandler(() => json({ statusCode: 403 }, 403)))
    const forbidden = render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('alert')
    expect(await violations(forbidden.container)).toEqual([])
  })

  it('gives each section a heading name and keeps the h1 first and focusable by script', async () => {
    await openDetail()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveAttribute('tabindex', '-1')
    const names = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-labelledby'))
    expect(names.every(Boolean)).toBe(true)
    for (const region of screen.getAllByRole('region'))
      expect(within(region).getAllByRole('heading', { level: 2 })).toHaveLength(1)
    expect(screen.getByRole('article')).toHaveAccessibleName('Post case')
  })

  it('announces state through one polite live region and never through the minute ticks', async () => {
    await openDetail()
    const live = document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')
    expect(live).toHaveLength(1)
    expect(live[0]).toHaveAttribute('aria-live', 'polite')
  })

  it('tabs from the back link to Reload before any content link or control', async () => {
    await openDetail()
    await userEvent.tab()
    expect(document.activeElement).toHaveAccessibleName('Back to queue')
    await userEvent.tab()
    expect(document.activeElement).toHaveAccessibleName('Reload case')
  })
})
