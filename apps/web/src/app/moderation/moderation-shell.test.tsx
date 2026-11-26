// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: the staff console routes sit in the one app shell (D6, D7). Each route
// renders one page surface, the shared top bar whose title is the page's only h1, a back control
// to the parent route, and the skip-link target under the bar.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the top bar's history-aware back reads the router (D11).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render, screen, within } from '@testing-library/react'
import { http, type RequestHandler } from 'msw'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enUS from '../../i18n/locales/en-US.json'
import {
  detail,
  detailHandler,
  errorBody,
  json,
  page,
  queueHandler,
  signIn,
} from '../../test-utils/moderation-console'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import ModerationCasePage from './cases/[caseId]/page'
import ModerationEvidencePage from './evidence/page'
import ModerationPage from './page'
import ModerationSlaPage from './sla/page'

const navigation = vi.hoisted(() => ({ pathname: '/moderation' }))
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}))

const copy = enUS.moderation

// Every read answers at once, so each route settles on a known state before the test ends.
const evidenceOff = http.get('*/api/v1/moderation/evidence-exports/availability', () =>
  json(errorBody(503, 'moderation_history_disabled'), 503)
)
const slaOff = http.get('*/api/v1/moderation/sla', () =>
  json({ statusCode: 503, code: 'moderation_sla_disabled', message: 'off' }, 503)
)

beforeEach(() => signIn())
afterEach(() => window.sessionStorage.clear())

function expectShell(title: string, backHref: string) {
  expect(document.querySelectorAll('[data-surface="page"]')).toHaveLength(1)
  const header = screen.getByTestId('app-header')
  const h1 = within(header).getByRole('heading', { level: 1 })
  expect(h1).toHaveTextContent(title)
  expect(screen.getAllByRole('heading', { level: 1 })).toEqual([h1])
  expect(screen.getByTestId('app-top-bar-back')).toHaveAttribute('href', backHref)
  const main = document.getElementById('main-content')
  expect(main?.tagName).toBe('MAIN')
  expect(main).toHaveAttribute('tabindex', '-1')
  expect(
    header.compareDocumentPosition(main!) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
}

describe('CC-7.9 moderation routes in the app shell', () => {
  it.each([
    {
      route: '/moderation',
      view: () => <ModerationPage />,
      handlers: [queueHandler(() => json(page([]))), evidenceOff],
      title: copy.title,
      back: '/',
      settled: () => screen.findByText(copy.queue.empty),
    },
    {
      route: '/moderation/sla',
      view: () => <ModerationSlaPage />,
      handlers: [slaOff],
      title: copy.sla.title,
      back: '/moderation',
      settled: () => screen.findByText(copy.sla.disabled),
    },
    {
      route: '/moderation/evidence',
      view: () => <ModerationEvidencePage />,
      handlers: [evidenceOff],
      title: copy.evidence.title,
      back: '/moderation',
      settled: () => screen.findByText(copy.evidence.failure.moderation_history_disabled),
    },
  ] satisfies {
    route: string
    view: () => ReactElement
    handlers: RequestHandler[]
    title: string
    back: string
    settled: () => Promise<HTMLElement>
  }[])('$route has one page surface and the top bar owns its only h1', async (row) => {
    navigation.pathname = row.route
    mockApi(...row.handlers)
    render(row.view())
    await row.settled()
    expectShell(row.title, row.back)
  })

  it('/moderation/cases/[caseId] titles the bar and keeps the case title as the first h2', async () => {
    navigation.pathname = '/moderation/cases/post.p1'
    mockApi(
      detailHandler(() => json({ data: detail() })),
      evidenceOff
    )
    render(await ModerationCasePage({ params: Promise.resolve({ caseId: 'post.p1' }) }))
    const caseTitle = await screen.findByRole('heading', { level: 2, name: 'Post case' })
    expectShell(copy.detail.screenTitle, '/moderation')
    const main = document.getElementById('main-content')!
    expect(within(main).getAllByRole('heading')[0]).toBe(caseTitle)
  })

  it('/moderation/cases/[caseId] keeps a programmatic focus target for a client navigation', async () => {
    // Next focuses a segment's first element after a client navigation. Before CC-7.9 that was
    // the case page's `main` (tabIndex -1); now it is the page surface, and both stay focusable,
    // so the first Tab after opening a case lands on the top bar Back.
    navigation.pathname = '/moderation/cases/post.p1'
    mockApi(
      detailHandler(() => json({ data: detail() })),
      evidenceOff
    )
    const { container } = render(
      await ModerationCasePage({ params: Promise.resolve({ caseId: 'post.p1' }) })
    )
    await screen.findByRole('heading', { level: 2, name: 'Post case' })

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('data-surface', 'page')
    expect(root).toHaveAttribute('tabindex', '-1')
    root.focus()
    expect(root).toHaveFocus()
    const main = document.getElementById('main-content')!
    expect(main).toHaveAttribute('tabindex', '-1')
    main.focus()
    expect(main).toHaveFocus()
  })
})
