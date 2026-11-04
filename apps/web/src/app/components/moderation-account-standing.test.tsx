// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.11 test owner: C-WEB-D-STANDING. The author's standing, the appeal steps per role,
// `firstDecisionAt` and the escalated marker on the detail and the queue row.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ModerationAppealInput,
  ModerationCaseDetail,
  ModerationSubjectStanding,
} from '@couture/api-client/contracts/http'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import {
  APPEAL_PATH,
  appealBody,
  detail,
  detailHandler,
  json,
  mutationHandler,
  page,
  queueHandler,
  signIn,
  summary,
} from '../../test-utils/moderation-console'
import { ModerationCaseDetailView } from './moderation-case-detail'
import { ModerationQueueView } from './moderation-queue'

const CANARY_URL = '/test-only/request-canary'
// The opt-in test latency can give a canary a shorter wait than an earlier request, so it also waits the longest one.
const longestTestLatencyMs = () =>
  typeof process === 'undefined' ? 0 : Number(process.env.MSW_TEST_DELAY_MS ?? 0)
const canaryHandler = http.post(`*${CANARY_URL}`, async ({ request }) => {
  await request.text()
  await delay(longestTestLatencyMs())
  return HttpResponse.json({})
})

// Registered ahead of each test's own handlers, so MSW tries all of those first for a canary.
beforeEach(() => {
  signIn()
  mockApi(canaryHandler)
})
afterEach(() => window.sessionStorage.clear())

const EXPIRES_AT = '2026-11-10T12:00:00.000Z'
const NOTE = 'Member wrote to support'
const dateFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function standing(
  overrides: Partial<ModerationSubjectStanding> = {}
): ModerationSubjectStanding {
  return {
    active: true,
    sanction: {
      sanctionId: 'sanction-1',
      kind: 'temporary',
      expiresAt: EXPIRES_AT,
      appealStatus: 'not_requested',
    },
    priorBanCount: 0,
    allowedAppealSteps: [],
    ...overrides,
  }
}

async function openCase(
  overrides: Partial<ModerationCaseDetail> = {},
  respond: (body: ModerationAppealInput, call: number) => Response = () =>
    json(appealBody())
) {
  const reads: string[] = []
  const bodies: ModerationAppealInput[] = []
  mockApi(
    detailHandler(() => json({ data: detail(overrides) }), reads),
    mutationHandler<ModerationAppealInput>(APPEAL_PATH, respond, bodies)
  )
  const view = render(<ModerationCaseDetailView caseId="post.p1" />)
  await screen.findByRole('heading', { level: 1 })
  return { reads, bodies, ...view }
}

const section = () => screen.getByRole('region', { name: 'Author standing' })
const noteBox = () => screen.getByRole('textbox', { name: 'Appeal note (required)' })
const typeNote = (value: string = NOTE) =>
  fireEvent.change(noteBox(), { target: { value } })
/**
 * Waits until every request sent so far has reached its handler, so a stray one has been counted.
 * A canary is the slowest route through MSW: it carries a body, and every other handler goes first.
 * The second round sees whatever the commits of the first round sent.
 * A request sent later than this is out of reach, and this client has no timer that would send one.
 */
const settle = async () => {
  for (let round = 0; round < 2; round += 1)
    await act(async () => {
      await fetch(CANARY_URL, { method: 'POST', body: 'canary' })
    })
}

/** The value beside a term in the standing list. */
function valueOf(term: string) {
  const dt = within(section()).getByText(term)
  return dt.nextElementSibling?.textContent
}

describe('C-WEB-D-STANDING: what the section states', () => {
  it('renders no section when the author is gone', async () => {
    await openCase({ subjectStanding: null })
    expect(
      screen.queryByRole('region', { name: 'Author standing' })
    ).not.toBeInTheDocument()
  })

  it('says there is no ban on record, with no list and no appeal control', async () => {
    await openCase({
      subjectStanding: standing({ active: false, sanction: null }),
    })
    expect(within(section()).getByText('No bans on record.')).toBeInTheDocument()
    expect(section().querySelector('dl')).toBeNull()
    expect(within(section()).queryByRole('button')).not.toBeInTheDocument()
    expect(within(section()).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('states a temporary sanction with its expiry, appeal status and prior ban count', async () => {
    await openCase({ subjectStanding: standing({ priorBanCount: 2 }) })
    expect(valueOf('Ban')).toBe('Active')
    expect(valueOf('Type')).toBe('Temporary')
    expect(valueOf('Ends')).toBe(dateFormat.format(new Date(EXPIRES_AT)))
    expect(valueOf('Appeal')).toBe('None recorded')
    expect(valueOf('Earlier bans')).toBe('2')
  })

  it('states a permanent sanction with no expiry row', async () => {
    await openCase({
      subjectStanding: standing({
        sanction: {
          sanctionId: 'sanction-1',
          kind: 'permanent',
          expiresAt: null,
          appealStatus: 'not_requested',
        },
      }),
    })
    expect(valueOf('Type')).toBe('Permanent')
    expect(within(section()).queryByText('Ends')).not.toBeInTheDocument()
  })

  it('states an expired or lifted sanction as ended, with no appeal control', async () => {
    await openCase({ subjectStanding: standing({ active: false }) })
    expect(valueOf('Ban')).toBe('Ended')
    expect(within(section()).queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    ['not_requested', 'None recorded'],
    ['requested', 'Waiting for a decision'],
    ['upheld', 'Ban upheld'],
    ['overturned', 'Ban overturned'],
  ] as const)('labels the appeal status %s', async (appealStatus, text) => {
    await openCase({
      subjectStanding: standing({
        sanction: {
          sanctionId: 'sanction-1',
          kind: 'temporary',
          expiresAt: EXPIRES_AT,
          appealStatus,
        },
      }),
    })
    expect(valueOf('Appeal')).toBe(text)
  })

  it('counts zero as a value and shows no reason or moderator for a sanction', async () => {
    await openCase({ subjectStanding: standing() })
    expect(valueOf('Earlier bans')).toBe('0')
    expect(section().textContent).not.toMatch(/sanction-1|moderator/i)
  })
})

describe('C-WEB-D-STANDING: appeal controls per role', () => {
  it('renders exactly the steps the API allows a moderator', async () => {
    await openCase({ subjectStanding: standing({ allowedAppealSteps: ['requested'] }) })
    expect(
      within(section())
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Record an appeal'])
  })

  it('renders the two closing steps for an admin', async () => {
    await openCase({
      subjectStanding: standing({ allowedAppealSteps: ['upheld', 'overturned'] }),
    })
    expect(
      within(section())
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Uphold the ban', 'Overturn the ban'])
  })

  it('renders no appeal form when the API allows no step', async () => {
    await openCase({ subjectStanding: standing({ allowedAppealSteps: [] }) })
    expect(within(section()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(section()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('holds a step closed outside the reason range and sends nothing', async () => {
    const { bodies } = await openCase({
      subjectStanding: standing({ allowedAppealSteps: ['requested'] }),
    })
    const button = within(section()).getByRole('button', { name: 'Record an appeal' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    typeNote('ab')
    fireEvent.click(button)
    await settle()
    expect(bodies).toEqual([])
    typeNote('abc')
    expect(button).toHaveAttribute('aria-disabled', 'false')
    typeNote('x'.repeat(1001))
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('sends the step, the trimmed note and one UUID, announces the outcome, and reads once', async () => {
    const { bodies, reads } = await openCase({
      subjectStanding: standing({ allowedAppealSteps: ['requested'] }),
    })
    typeNote(`  ${NOTE}  `)
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Record an appeal' })
    )
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reads).toHaveLength(2)
    expect(bodies).toEqual([
      {
        status: 'requested',
        reason: NOTE,
        mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      },
    ])
    const outcome = screen.getByTestId('moderation-decision-outcome')
    expect(outcome).toHaveTextContent('The appeal is recorded.')
    await waitFor(() => expect(document.activeElement).toBe(outcome))
    expect(noteBox()).toHaveValue('')
  })

  it.each([
    ['Uphold the ban', 'upheld', 'The ban stays in place.'],
    [
      'Overturn the ban',
      'overturned',
      "The ban is lifted. The member's content returned where they are still eligible.",
    ],
  ] as const)(
    '%s reaches the sanction route with its step',
    async (name, status, text) => {
      const paths: string[] = []
      const { bodies } = await openCase(
        { subjectStanding: standing({ allowedAppealSteps: ['upheld', 'overturned'] }) },
        (_body) => {
          paths.push('appeal')
          return json(appealBody())
        }
      )
      typeNote()
      await userEvent.click(within(section()).getByRole('button', { name }))
      await waitFor(() =>
        expect(screen.getByTestId('moderation-decision-outcome')).toHaveTextContent(text)
      )
      expect(paths).toHaveLength(1)
      expect(bodies[0]?.status).toBe(status)
    }
  )

  it('reuses the id on a retry and keeps the note', async () => {
    const { bodies } = await openCase(
      { subjectStanding: standing({ allowedAppealSteps: ['requested'] }) },
      (_body, call) => (call === 1 ? HttpResponse.error() : json(appealBody()))
    )
    typeNote()
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Record an appeal' })
    )
    const alert = await within(section()).findByRole('alert')
    expect(bodies).toHaveLength(1)
    expect(noteBox()).toHaveValue(NOTE)
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).toBe(bodies[0]?.mutationId)
  })

  it('drops the retry when the note changes, since the edited note is a new request', async () => {
    const { bodies } = await openCase(
      { subjectStanding: standing({ allowedAppealSteps: ['requested'] }) },
      () => HttpResponse.error()
    )
    typeNote()
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Record an appeal' })
    )
    const alert = await within(section()).findByRole('alert')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    typeNote(`${NOTE} and more`)
    expect(within(section()).queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(bodies).toHaveLength(1)
  })

  it('sends once for a double click while the request is out', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const reads: string[] = []
    const bodies: ModerationAppealInput[] = []
    mockApi(
      detailHandler(
        () =>
          json({
            data: detail({
              subjectStanding: standing({ allowedAppealSteps: ['requested'] }),
            }),
          }),
        reads
      ),
      mutationHandler<ModerationAppealInput>(
        APPEAL_PATH,
        async () => {
          await gate
          return json(appealBody())
        },
        bodies
      )
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    typeNote()
    await userEvent.dblClick(
      within(section()).getByRole('button', { name: 'Record an appeal' })
    )
    await waitFor(() => expect(bodies).toHaveLength(1))
    await settle()
    expect(bodies).toHaveLength(1)
    act(() => release())
    await waitFor(() => expect(reads).toHaveLength(2))
  })

  it('mints a new id when the step changes', async () => {
    const { bodies } = await openCase(
      { subjectStanding: standing({ allowedAppealSteps: ['upheld', 'overturned'] }) },
      (_body, call) => (call === 1 ? HttpResponse.error() : json(appealBody()))
    )
    typeNote()
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Uphold the ban' })
    )
    await within(section()).findByRole('alert')
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Overturn the ban' })
    )
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).not.toBe(bodies[0]?.mutationId)
  })

  it.each([
    [
      409,
      'appeal_transition_invalid',
      'That appeal step does not apply to this sanction now.',
    ],
    [404, 'sanction_not_found', 'This sanction no longer exists.'],
    [
      403,
      'self_review_refused',
      'You wrote this content or filed one of its reports, so another moderator must decide.',
    ],
    [
      403,
      'admin_required',
      'This decision needs an admin. Escalate the case to hand it over.',
    ],
  ])('states a %i %s with a reload and keeps the note', async (status, code, text) => {
    const { reads } = await openCase(
      { subjectStanding: standing({ allowedAppealSteps: ['requested'] }) },
      () => json({ statusCode: status, code, message: 'Closed message.' }, status)
    )
    typeNote()
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Record an appeal' })
    )
    const alert = await within(section()).findByRole('alert')
    expect(alert).toHaveTextContent(text)
    expect(within(alert).getByRole('button', { name: 'Reload case' })).toBeInTheDocument()
    expect(noteBox()).toHaveValue(NOTE)
    await settle()
    expect(reads).toHaveLength(1)
  })

  it('clears a refusal once the reload it offers has run', async () => {
    const { reads } = await openCase(
      { subjectStanding: standing({ allowedAppealSteps: ['requested'] }) },
      () =>
        json(
          { statusCode: 409, code: 'appeal_transition_invalid', message: 'Closed.' },
          409
        )
    )
    typeNote()
    await userEvent.click(
      within(section()).getByRole('button', { name: 'Record an appeal' })
    )
    const alert = await within(section()).findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(within(section()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('marks the appeal note as required and gives every control a 44 pixel target', async () => {
    await openCase({
      subjectStanding: standing({ allowedAppealSteps: ['upheld', 'overturned'] }),
    })
    expect(noteBox()).toBeRequired()
    for (const button of within(section()).getAllByRole('button'))
      expect(button.className).toMatch(/min-h-\[44px\]/)
  })
})

describe('C-WEB-D-STANDING: the first decision and the escalated marker', () => {
  const FIRST = '2026-11-03T09:00:00.000Z'

  it('shows firstDecisionAt in the case header, only once a decision exists', async () => {
    const without = await openCase({ firstDecisionAt: null })
    expect(document.body.textContent).not.toContain('First decision')
    without.unmount()
    await openCase({ firstDecisionAt: FIRST })
    expect(
      screen.getByText(new RegExp(`First decision ${dateFormat.format(new Date(FIRST))}`))
    ).toBeInTheDocument()
  })

  it('shows the escalated marker on the case view, only for an escalated case', async () => {
    const copy = 'This case is waiting for an admin. Only an admin can close it.'
    const without = await openCase({ escalated: false })
    expect(screen.queryByText(copy)).not.toBeInTheDocument()
    without.unmount()
    await openCase({ escalated: true })
    expect(screen.getByRole('note')).toHaveTextContent(copy)
  })

  it('shows the escalated marker on the queue row, only for an escalated case', async () => {
    mockApi(
      queueHandler(() =>
        json(
          page([
            summary({ caseId: 'post.a', escalated: true }),
            summary({ caseId: 'post.b', escalated: false }),
          ])
        )
      )
    )
    render(<ModerationQueueView />)
    const list = await screen.findByRole('list', { name: 'Cases' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Escalated')
    expect(rows[1]).not.toHaveTextContent('Escalated')
    expect(document.body.textContent).not.toContain('moderation.queue')
  })
})
