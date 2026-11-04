// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.11 test owner: C-WEB-D-PANEL, -MUTATION, -STATES, -KEEP-REASON, -CONFIRM, -ANNOUNCE, -RELOAD-ONE, -HOSTILE, -A11Y.
// Every journey runs through the real web transport against MSW, inside the real case view.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { delay, http, HttpResponse, type JsonBodyType } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ModerationCaseDetail,
  ModerationDecisionAction,
  ModerationDecisionInput,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import deDE from '../../i18n/locales/de-DE.json'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import {
  DECISION_PATH,
  MOVED_REVISION,
  decisionBody,
  detail,
  detailHandler,
  json,
  mutationHandler,
  signIn,
} from '../../test-utils/moderation-console'
import { ModerationCaseDetailView } from './moderation-case-detail'

const CANARY_URL = '/test-only/request-canary'
// The opt-in test latency can give a canary a shorter wait than an earlier request, so it also waits the longest one.
const longestTestLatencyMs = () =>
  typeof process === 'undefined' ? 0 : Number(process.env.MSW_TEST_DELAY_MS ?? 0)
const canaryHandler = http.post(`*${CANARY_URL}`, async ({ request }) => {
  await request.text()
  await delay(longestTestLatencyMs())
  return HttpResponse.json({})
})

const REASON = 'Harassing caption'
const ALL_ACTIONS: ModerationDecisionAction[] = [
  'resolve',
  'release',
  'takedown',
  'escalate',
  'ban',
]
const ACTION_NAME: Record<ModerationDecisionAction, RegExp> = {
  resolve: /^Resolve/,
  release: /^Release/,
  takedown: /^Take down/,
  escalate: /^Escalate/,
  ban: /^Ban the author/,
}

// Registered ahead of each test's own handlers, so MSW tries all of those first for a canary.
beforeEach(() => {
  signIn()
  mockApi(canaryHandler)
})
afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

type Overrides = Partial<ModerationCaseDetail>
type Respond = (
  body: ModerationDecisionInput,
  call: number
) => Response | Promise<Response>

/** The route the real API answers: one read per GET, and one body per POST. */
async function openCase(
  respond: Respond = () => json(decisionBody()),
  overrides: Overrides = {},
  afterRead: Overrides = {},
  strict = false
) {
  const reads: string[] = []
  const bodies: ModerationDecisionInput[] = []
  const first: Overrides = {
    allowedActions: ['resolve'],
    banKinds: [],
    ...overrides,
  }
  mockApi(
    detailHandler(
      (_id, call) =>
        json({ data: detail(call === 1 ? first : { ...first, ...afterRead }) }),
      reads
    ),
    mutationHandler<ModerationDecisionInput>(DECISION_PATH, respond, bodies)
  )
  const tree = <ModerationCaseDetailView caseId="post.p1" />
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await screen.findByRole('heading', { level: 1 })
  return { reads, bodies, ...view }
}

const reasonBox = () => screen.getByRole('textbox', { name: 'Reason (required)' })
const submitButton = () => screen.getByRole('button', { name: 'Apply decision' })
/** The in-page question. Its copy is the only group name holding a question mark. */
const confirmation = () => screen.queryByRole('group', { name: /\?/ })
const outcomeRegion = () => screen.getByTestId('moderation-decision-outcome')
const typeReason = (value: string = REASON) =>
  fireEvent.change(reasonBox(), { target: { value } })
const chooseAction = (action: ModerationDecisionAction) =>
  userEvent.click(screen.getByRole('radio', { name: ACTION_NAME[action] }))
const failWith = (status: number, body: JsonBodyType) => () => json(body, status)
const closed = (statusCode: number, code: string, extra: object = {}) =>
  failWith(statusCode, { statusCode, code, message: 'Closed message.', ...extra })
const offline = () => HttpResponse.error()
const conflict = closed(409, 'case_conflict', { currentRevision: MOVED_REVISION })

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

async function submitResolve() {
  typeReason()
  await userEvent.click(submitButton())
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
async function violations(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: TAGS },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return result.violations.map((violation) => `${violation.id}: ${violation.help}`)
}

describe('C-WEB-D-PANEL', () => {
  it.each<[string, ModerationDecisionAction[]]>([
    ['one action', ['escalate']],
    ['a held post', ['resolve', 'release', 'escalate', 'ban']],
    ['every action', ALL_ACTIONS],
  ])('renders exactly allowedActions for %s', async (_label, allowedActions) => {
    await openCase(undefined, { allowedActions, banKinds: ['temporary'] })
    expect(screen.getAllByRole('radio')).toHaveLength(allowedActions.length)
    for (const action of ALL_ACTIONS) {
      const radio = screen.queryByRole('radio', { name: ACTION_NAME[action] })
      if (allowedActions.includes(action)) expect(radio).toBeInTheDocument()
      else expect(radio).not.toBeInTheDocument()
    }
  })

  it('renders no form and no heading when nothing is allowed', async () => {
    await openCase(undefined, { allowedActions: [] })
    expect(screen.queryByRole('region', { name: 'Decision' })).not.toBeInTheDocument()
    expect(document.querySelector('form')).toBeNull()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('offers no ban fields until ban is chosen', async () => {
    await openCase(undefined, {
      allowedActions: ['resolve', 'ban'],
      banKinds: ['temporary'],
    })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await chooseAction('ban')
    expect(screen.getByRole('combobox', { name: 'Ban type' })).toBeInTheDocument()
    await chooseAction('resolve')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers a moderator no permanent ban, because banKinds does not list it', async () => {
    await openCase(undefined, { allowedActions: ['ban'], banKinds: ['temporary'] })
    const kinds = within(screen.getByRole('combobox', { name: 'Ban type' }))
    expect(kinds.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Temporary',
    ])
    expect(document.body.textContent).not.toContain('Permanent')
  })

  it('offers an admin both ban kinds, and only the upgrade once a temporary ban is active', async () => {
    const both = await openCase(undefined, {
      allowedActions: ['ban'],
      banKinds: ['temporary', 'permanent'],
    })
    expect(
      within(screen.getByRole('combobox', { name: 'Ban type' }))
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Temporary', 'Permanent'])
    both.unmount()

    await openCase(undefined, { allowedActions: ['ban'], banKinds: ['permanent'] })
    expect(screen.getByRole('combobox', { name: 'Ban type' })).toHaveValue('permanent')
    expect(screen.queryByRole('combobox', { name: 'Duration' })).not.toBeInTheDocument()
  })

  it('offers the durations 1, 7, 30 and 90, and drops them for a permanent ban', async () => {
    await openCase(undefined, {
      allowedActions: ['ban'],
      banKinds: ['temporary', 'permanent'],
    })
    const duration = screen.getByRole('combobox', { name: 'Duration' })
    expect(
      within(duration)
        .getAllByRole('option')
        .map((option) => [option.getAttribute('value'), option.textContent])
    ).toEqual([
      ['1', '1 day'],
      ['7', '7 days'],
      ['30', '30 days'],
      ['90', '90 days'],
    ])
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Ban type' }),
      'permanent'
    )
    expect(screen.queryByRole('combobox', { name: 'Duration' })).not.toBeInTheDocument()
  })

  it('counts trimmed characters live and allows a submit only from 3 to 1000', async () => {
    const { bodies } = await openCase()
    const count = () => document.getElementById('moderation-decision-count')?.textContent
    expect(count()).toBe('0 of 1000 characters, at least 3')
    expect(reasonBox()).toHaveAttribute('aria-describedby', 'moderation-decision-count')

    const cases: [string, number, boolean][] = [
      ['', 0, false],
      ['ab', 2, false],
      ['   ab   ', 2, false],
      ['abc', 3, true],
      ['x'.repeat(1000), 1000, true],
      ['x'.repeat(1001), 1001, false],
    ]
    for (const [value, length, allowed] of cases) {
      typeReason(value)
      expect(count()).toBe(`${length} of 1000 characters, at least 3`)
      expect(submitButton()).toHaveAttribute('aria-disabled', String(!allowed))
      // Focusable either way, as the 6.10 controls are.
      expect(submitButton()).not.toBeDisabled()
      if (!allowed) {
        fireEvent.click(submitButton())
        await settle()
        expect(bodies).toEqual([])
      }
    }
  })
})

describe('C-WEB-D-PANEL: a reload that narrows what the API allows', () => {
  it.each<[string, Overrides]>([
    ['with the same revision', {}],
    ['with a new revision', { revision: MOVED_REVISION }],
  ])('sends no action the API stopped listing, %s', async (_label, moved) => {
    const { bodies, reads } = await openCase(
      undefined,
      { allowedActions: ['resolve', 'escalate'] },
      { ...moved, allowedActions: ['escalate'] }
    )
    typeReason()
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: ACTION_NAME.escalate })).toBeChecked()
    typeReason()
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]?.action).toBe('escalate')
  })

  it('removes the form when the reload leaves nothing allowed', async () => {
    const { reads } = await openCase(undefined, undefined, { allowedActions: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })
})

describe('C-WEB-D-MUTATION', () => {
  it('sends the action, the trimmed reason, one UUID and the revision of the read, and nothing else', async () => {
    const { bodies } = await openCase(undefined, { revision: 'cccccccccccccccc' })
    typeReason(`  ${REASON}  `)
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      action: 'resolve',
      reason: REASON,
      mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      expectedRevision: 'cccccccccccccccc',
    })
  })

  it.each([
    ['a temporary ban', ['temporary'], { kind: 'temporary', durationDays: 30 }],
    ['a permanent ban', ['permanent'], { kind: 'permanent' }],
  ] as const)('sends the terms of %s', async (_label, banKinds, ban) => {
    const { bodies } = await openCase(() => json(decisionBody({ action: 'ban' })), {
      allowedActions: ['ban'],
      banKinds: [...banKinds],
    })
    if (ban.kind === 'temporary')
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Duration' }),
        '30'
      )
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]?.action === 'ban' ? bodies[0].ban : null).toEqual(ban)
  })

  it('reuses the id when the same payload is retried', async () => {
    const { bodies } = await openCase((_body, call) =>
      call === 1 ? offline() : json(decisionBody())
    )
    await submitResolve()
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).toBe(bodies[0]?.mutationId)
  })

  it('reuses the id for a lost response retried after a Reload that found nothing new (TEA-12)', async () => {
    const { bodies, reads } = await openCase((_body, call) =>
      call === 1 ? offline() : json(decisionBody())
    )
    await submitResolve()
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).toBe(bodies[0]?.mutationId)
  })

  it('mints a new id when the reason is edited', async () => {
    const { bodies } = await openCase((_body, call) =>
      call === 1 ? offline() : json(decisionBody())
    )
    await submitResolve()
    await screen.findByRole('alert')
    typeReason(`${REASON} and spam`)
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).not.toBe(bodies[0]?.mutationId)
  })

  it('mints a new id when the action changes', async () => {
    const { bodies } = await openCase(
      (_body, call) =>
        call === 1 ? offline() : json(decisionBody({ action: 'escalate' })),
      { allowedActions: ['resolve', 'escalate'] }
    )
    await submitResolve()
    await screen.findByRole('alert')
    await chooseAction('escalate')
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).not.toBe(bodies[0]?.mutationId)
    expect(bodies[1]?.action).toBe('escalate')
  })

  it('mints a new id when the ban terms change', async () => {
    const { bodies } = await openCase(
      (_body, call) => (call === 1 ? offline() : json(decisionBody({ action: 'ban' }))),
      { allowedActions: ['ban'], banKinds: ['temporary'] }
    )
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await screen.findByRole('alert')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Duration' }),
      '90'
    )
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).not.toBe(bodies[0]?.mutationId)
  })

  it('mints a new id for the next decision once one has applied', async () => {
    const { bodies } = await openCase(undefined, undefined, {
      revision: MOVED_REVISION,
    })
    await submitResolve()
    await waitFor(() => expect(document.activeElement).toBe(outcomeRegion()))
    await submitResolve()
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).not.toBe(bodies[0]?.mutationId)
  })

  it('sends once for a double click, on submit and on the confirmation', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const held = async () => {
      await gate
      return json(decisionBody())
    }
    const direct = await openCase(held)
    typeReason()
    await userEvent.dblClick(submitButton())
    await waitFor(() => expect(direct.bodies).toHaveLength(1))
    await settle()
    expect(direct.bodies).toHaveLength(1)
    act(() => release())
    await waitFor(() => expect(direct.reads).toHaveLength(2))
    direct.unmount()

    let releaseSecond: () => void = () => undefined
    const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve))
    const confirmed = await openCase(
      async () => {
        await secondGate
        return json(decisionBody({ action: 'takedown' }))
      },
      { allowedActions: ['takedown'] }
    )
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.dblClick(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() => expect(confirmed.bodies).toHaveLength(1))
    await settle()
    expect(confirmed.bodies).toHaveLength(1)
    act(() => releaseSecond())
    await waitFor(() => expect(confirmed.reads).toHaveLength(2))
  })

  it('takes expectedRevision from the last read', async () => {
    const { bodies, reads } = await openCase(undefined, undefined, {
      revision: MOVED_REVISION,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    await submitResolve()
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]?.expectedRevision).toBe(MOVED_REVISION)
  })

  it('mints a new id after idempotency_mismatch, since its copy says to reload and try again', async () => {
    const { bodies, reads } = await openCase((_body, call) =>
      call === 1 ? closed(409, 'idempotency_mismatch')() : json(decisionBody())
    )
    await submitResolve()
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.mutationId).not.toBe(bodies[0]?.mutationId)
  })
})

describe('C-WEB-D-STATES', () => {
  it('idles with a closed submit, no alert and an empty outcome', async () => {
    await openCase()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Decision' })
    ).toBeInTheDocument()
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(outcomeRegion()).toBeEmptyDOMElement()
  })

  it('shows submitting on the same control while the request is out', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    await openCase(async () => {
      await gate
      return json(decisionBody())
    })
    typeReason()
    const button = submitButton()
    await userEvent.click(button)
    expect(await screen.findByRole('button', { name: 'Applying' })).toBe(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    act(() => release())
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent('The reports are resolved.')
    )
  })

  it.each<[ModerationDecisionAction, string]>([
    ['resolve', 'The reports are resolved.'],
    ['release', 'The content is published and the reports are resolved.'],
    ['escalate', 'The case is escalated to an admin.'],
  ])('announces the applied %s', async (action, text) => {
    await openCase(() => json(decisionBody({ action })), { allowedActions: [action] })
    typeReason()
    await userEvent.click(submitButton())
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(text))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces a takedown, a temporary ban with its date, and a permanent ban without one', async () => {
    const takedown = await openCase(() => json(decisionBody({ action: 'takedown' })), {
      allowedActions: ['takedown'],
    })
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent(
        'The content is down and the reports are resolved.'
      )
    )
    takedown.unmount()

    const expiresAt = '2026-11-10T12:00:00.000Z'
    const until = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(expiresAt))
    const temporary = await openCase(
      () =>
        json(
          decisionBody({
            action: 'ban',
            sanction: {
              sanctionId: 's1',
              kind: 'temporary',
              expiresAt,
              appealStatus: 'not_requested',
            },
          })
        ),
      { allowedActions: ['ban'], banKinds: ['temporary'] }
    )
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent(`The author is banned until ${until}.`)
    )
    temporary.unmount()

    await openCase(
      () =>
        json(
          decisionBody({
            action: 'ban',
            sanction: {
              sanctionId: 's2',
              kind: 'permanent',
              expiresAt: null,
              appealStatus: 'not_requested',
            },
          })
        ),
      { allowedActions: ['ban'], banKinds: ['permanent'] }
    )
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent('The author is permanently banned.')
    )
  })

  it('adds the deferred sentence only when the public caches were not refreshed', async () => {
    const deferredText = 'Some public pages may take a moment to catch up.'
    const later = await openCase(() =>
      json(decisionBody({ cacheInvalidation: 'deferred' }))
    )
    await submitResolve()
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent(
        `The reports are resolved. ${deferredText}`
      )
    )
    later.unmount()

    await openCase()
    await submitResolve()
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent('The reports are resolved.')
    )
    expect(outcomeRegion()).not.toHaveTextContent(deferredText)
  })

  const RELOAD = 'Reload case'
  const RETRY = 'Try again'
  it.each<[string, () => Response, string, string]>([
    [
      'conflict',
      conflict,
      'This case changed since you opened it. Reload to see what changed. Your reason stays here.',
      RELOAD,
    ],
    [
      'not applicable with no detail',
      closed(409, 'action_not_applicable'),
      'That action does not apply to the case as it stands.',
      RELOAD,
    ],
    [
      'not applicable, no_open_reports',
      closed(409, 'action_not_applicable', { detail: 'no_open_reports' }),
      'This case has no open reports.',
      RELOAD,
    ],
    [
      'not applicable, target_not_held',
      closed(409, 'action_not_applicable', { detail: 'target_not_held' }),
      'This content is not being held, so it cannot be released.',
      RELOAD,
    ],
    [
      'not applicable, target_not_published',
      closed(409, 'action_not_applicable', { detail: 'target_not_published' }),
      'This content is not published, so it cannot be taken down.',
      RELOAD,
    ],
    [
      'not applicable, already_escalated',
      closed(409, 'action_not_applicable', { detail: 'already_escalated' }),
      'This case is already escalated.',
      RELOAD,
    ],
    [
      'not applicable, target_erased',
      closed(409, 'action_not_applicable', { detail: 'target_erased' }),
      'The content or its author has been erased, so this action no longer applies.',
      RELOAD,
    ],
    [
      'not applicable, subject_banned',
      closed(409, 'action_not_applicable', { detail: 'subject_banned' }),
      'The author is banned, so this content cannot be released.',
      RELOAD,
    ],
    [
      'not applicable, already_banned',
      closed(409, 'action_not_applicable', { detail: 'already_banned' }),
      'The author already has a ban that covers this.',
      RELOAD,
    ],
    [
      'not applicable, author_ineligible',
      closed(409, 'action_not_applicable', { detail: 'author_ineligible' }),
      'The author cannot take part in the community right now, so this content cannot be released.',
      RELOAD,
    ],
    [
      'not applicable, community_writes_closed',
      closed(409, 'action_not_applicable', { detail: 'community_writes_closed' }),
      'Community publishing is closed for this author, so this content cannot be released yet.',
      RELOAD,
    ],
    [
      'forbidden with no code',
      failWith(403, { statusCode: 403, message: 'Insufficient role' }),
      'This account cannot apply moderation decisions.',
      RELOAD,
    ],
    [
      'admin required',
      closed(403, 'admin_required'),
      'This decision needs an admin. Escalate the case to hand it over.',
      RELOAD,
    ],
    [
      'self review',
      closed(403, 'self_review_refused'),
      'You wrote this content or filed one of its reports, so another moderator must decide.',
      RELOAD,
    ],
    [
      'operator sanctioned',
      closed(403, 'operator_sanctioned'),
      'This account has an active community ban, so it cannot apply decisions.',
      RELOAD,
    ],
    [
      'decisions disabled',
      closed(503, 'moderation_decisions_disabled'),
      'Moderation decisions are turned off. Cases stay readable.',
      RELOAD,
    ],
    [
      'console disabled',
      closed(503, 'moderation_console_disabled'),
      'The moderation console is turned off.',
      RELOAD,
    ],
    [
      'idempotency mismatch',
      closed(409, 'idempotency_mismatch'),
      'This request was already used for a different decision. Reload and try again.',
      RELOAD,
    ],
    [
      'case not found',
      closed(404, 'case_not_found'),
      'This case no longer exists. It may have been re-keyed after an erasure.',
      RELOAD,
    ],
    [
      'invalid decision',
      closed(400, 'invalid_decision'),
      'The decision could not be read. Check the reason and try again.',
      RELOAD,
    ],
    [
      'signed out',
      failWith(401, { statusCode: 401, message: 'Unauthorized' }),
      'Sign in again to continue.',
      RELOAD,
    ],
    [
      'audit unavailable',
      closed(503, 'audit_unavailable'),
      'The decision could not be recorded, so nothing changed. Try again.',
      RETRY,
    ],
    [
      'rate limited',
      failWith(429, { statusCode: 429, message: 'slow down' }),
      'Too many requests. Wait a moment, then try again.',
      RETRY,
    ],
    [
      'a 500',
      failWith(500, { statusCode: 500, message: 'boom' }),
      'The decision could not be applied right now. Try again.',
      RETRY,
    ],
    [
      'offline',
      offline,
      'The decision may not have reached the server. Try again: it will not apply twice.',
      RETRY,
    ],
  ])('states %s with its recovery control', async (_label, respond, text, control) => {
    await openCase(respond)
    await submitResolve()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(text)
    expect(
      within(alert)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([control])
    expect(outcomeRegion()).toBeEmptyDOMElement()
    // The form is still there, with the moderator's words.
    expect(reasonBox()).toHaveValue(REASON)
    expect(document.body.textContent).not.toMatch(
      /moderation\.decision|case_conflict|action_not_applicable|Closed message/
    )
  })

  it('never shows a server message, and a retry that succeeds clears the failure', async () => {
    await openCase((_body, call) =>
      call === 1 ? closed(503, 'audit_unavailable')() : json(decisionBody())
    )
    await submitResolve()
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('Closed message.')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent('The reports are resolved.')
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the panel and a refusal in the viewer locale', async () => {
    const i18n = getI18n()
    const before = i18n.language
    await act(async () => {
      await i18n.changeLanguage('de-DE')
    })
    try {
      await openCase(conflict)
      const copy = deDE.moderation.decision
      expect(
        screen.getByRole('heading', { level: 2, name: copy.title })
      ).toBeInTheDocument()
      fireEvent.change(screen.getByRole('textbox', { name: copy.reason }), {
        target: { value: REASON },
      })
      await userEvent.click(screen.getByRole('button', { name: copy.submit }))
      expect(await screen.findByRole('alert')).toHaveTextContent(copy.error.case_conflict)
    } finally {
      await act(async () => {
        await i18n.changeLanguage(before)
      })
    }
  })
})

describe('C-WEB-D-KEEP-REASON', () => {
  it.each<[string, () => Response]>([
    ['conflict', conflict],
    ['offline', offline],
    ['audit unavailable', closed(503, 'audit_unavailable')],
    ['a 500', failWith(500, { statusCode: 500 })],
    ['a 503 with no code', failWith(503, { statusCode: 503 })],
  ])('keeps the typed reason through %s', async (_label, respond) => {
    await openCase(respond)
    await submitResolve()
    await screen.findByRole('alert')
    expect(reasonBox()).toHaveValue(REASON)
  })

  it('keeps the typed reason through a takedown that fails at its confirmation', async () => {
    await openCase(offline, { allowedActions: ['takedown'] })
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await screen.findByRole('alert')
    expect(reasonBox()).toHaveValue(REASON)
  })

  it('keeps the reason through the one read that a conflict reload makes, when the case really moved', async () => {
    // A conflict means the revision moved, so the reload always brings a new one.
    const { reads, bodies } = await openCase(
      (_body, call) => (call === 1 ? conflict() : json(decisionBody())),
      undefined,
      { revision: MOVED_REVISION }
    )
    await submitResolve()
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reads).toHaveLength(2)
    expect(reasonBox()).toHaveValue(REASON)
    // The next try carries the same words and the revision the reload brought.
    await userEvent.click(submitButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.reason).toBe(REASON)
    expect(bodies[1]?.expectedRevision).toBe(MOVED_REVISION)
  })

  it('keeps the action and ban terms chosen through a conflict reload', async () => {
    const { reads } = await openCase(
      closed(409, 'case_conflict'),
      { allowedActions: ['resolve', 'ban'], banKinds: ['temporary'] },
      { revision: MOVED_REVISION }
    )
    await chooseAction('ban')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Duration' }),
      '90'
    )
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(screen.getByRole('radio', { name: ACTION_NAME.ban })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('90')
  })

  it('clears the reason once a decision applied, even when the revision did not move', async () => {
    const { reads } = await openCase()
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    await waitFor(() => expect(reasonBox()).toHaveValue(''))
  })

  it('clears the reason once a decision applied and the revision moved', async () => {
    const { reads } = await openCase(undefined, undefined, { revision: MOVED_REVISION })
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reasonBox()).toHaveValue('')
  })
})

describe('C-WEB-D-CONFIRM', () => {
  const dialogs = () => [
    vi.spyOn(window, 'alert'),
    vi.spyOn(window, 'confirm'),
    vi.spyOn(window, 'prompt'),
  ]

  it.each<[ModerationDecisionAction, string]>([
    ['takedown', 'Take this content down now? Readers lose it on their next read.'],
    [
      'ban',
      'Ban this author for the chosen time? Their community access closes at once.',
    ],
  ])('asks in the page before %s, and sends after Yes', async (action, copy) => {
    const spies = dialogs()
    const { bodies } = await openCase(() => json(decisionBody({ action })), {
      allowedActions: [action],
      banKinds: ['temporary'],
    })
    typeReason()
    await userEvent.click(submitButton())
    const group = screen.getByRole('group', { name: copy })
    expect(group).toBeInTheDocument()
    await settle()
    expect(bodies).toEqual([])
    const yes = within(group).getByRole('button', { name: 'Yes, apply it' })
    expect(document.activeElement).toBe(yes)
    await userEvent.click(yes)
    await waitFor(() => expect(bodies).toHaveLength(1))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('warns of the wider effect of a permanent ban', async () => {
    await openCase(undefined, { allowedActions: ['ban'], banKinds: ['permanent'] })
    typeReason()
    await userEvent.click(submitButton())
    expect(
      screen.getByRole('group', {
        name: 'Ban this author permanently? All their community content is hidden and their reactions are withdrawn.',
      })
    ).toBeInTheDocument()
  })

  it('sends nothing on Cancel, keeps the reason and returns focus to the submit control', async () => {
    const { bodies } = await openCase(undefined, { allowedActions: ['takedown'] })
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(confirmation()).not.toBeInTheDocument()
    expect(bodies).toEqual([])
    expect(reasonBox()).toHaveValue(REASON)
    expect(document.activeElement).toBe(submitButton())
  })

  it.each<ModerationDecisionAction>(['resolve', 'release', 'escalate'])(
    'applies %s with no confirmation',
    async (action) => {
      const spies = dialogs()
      const { bodies } = await openCase(() => json(decisionBody({ action })), {
        allowedActions: [action],
      })
      typeReason()
      await userEvent.click(submitButton())
      expect(confirmation()).not.toBeInTheDocument()
      await waitFor(() => expect(bodies).toHaveLength(1))
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    }
  )

  it('closes the confirmation when the moderator picks another action', async () => {
    const { bodies } = await openCase(undefined, {
      allowedActions: ['takedown', 'resolve'],
    })
    typeReason()
    await userEvent.click(submitButton())
    expect(confirmation()).toBeInTheDocument()
    await chooseAction('resolve')
    expect(confirmation()).not.toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('never opens the confirmation for a reason outside the range', async () => {
    await openCase(undefined, { allowedActions: ['takedown'] })
    typeReason('ab')
    fireEvent.click(submitButton())
    expect(confirmation()).not.toBeInTheDocument()
  })
})

describe('C-WEB-D-ANNOUNCE', () => {
  const TEXT = 'The reports are resolved.'

  /** Records every change a screen reader would hear, in any live region on the page. */
  function watchLiveRegions() {
    const heard: string[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const node =
          record.target instanceof Element ? record.target : record.target.parentElement
        const region = node?.closest('[aria-live], [role="status"], [role="alert"]')
        if (region) heard.push(region.textContent ?? '')
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    return {
      heard,
      stop: () => {
        const late = observer.takeRecords()
        observer.disconnect()
        return late.length
      },
    }
  }

  it('announces once under strict mode, through one region that survives the reload', async () => {
    const { reads } = await openCase(
      () => json(decisionBody({ action: 'escalate' })),
      { allowedActions: ['escalate'] },
      { revision: MOVED_REVISION, escalated: true, allowedActions: [] },
      true
    )
    const region = outcomeRegion()
    const live = watchLiveRegions()
    typeReason()
    await userEvent.click(submitButton())
    await waitFor(() => expect(reads).toHaveLength(2))
    await waitFor(() => expect(document.activeElement).toBe(region))
    await settle()
    live.stop()
    const escalated = 'The case is escalated to an admin.'
    expect(live.heard).toEqual([escalated])
    expect(region.isConnected).toBe(true)
    expect(screen.getAllByText(escalated)).toHaveLength(1)
    expect(region).toHaveTextContent(escalated)
  })

  it('stays one announcement when the reload also moves the SLA state to resolved', async () => {
    const { reads } = await openCase(
      undefined,
      undefined,
      {
        revision: MOVED_REVISION,
        status: 'resolved',
        slaState: 'resolved',
        allowedActions: [],
      },
      true
    )
    const live = watchLiveRegions()
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    live.stop()
    expect(live.heard).toEqual([TEXT])
  })

  it('announces nothing politely for a failure, which has its one alert', async () => {
    await openCase(conflict)
    await submitResolve()
    await screen.findByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(outcomeRegion()).toBeEmptyDOMElement()
  })

  it('drops the outcome of the old case when the view moves to another case', async () => {
    const reads: string[] = []
    mockApi(
      detailHandler(
        (caseId) => json({ data: detail({ caseId, allowedActions: ['resolve'] }) }),
        reads
      ),
      mutationHandler<ModerationDecisionInput>(DECISION_PATH, () => json(decisionBody()))
    )
    const view = render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    await submitResolve()
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(TEXT))
    await waitFor(() => expect(reads).toHaveLength(2))
    view.rerender(<ModerationCaseDetailView caseId="post.p2" />)
    await waitFor(() => expect(reads).toEqual(['post.p1', 'post.p1', 'post.p2']))
    await screen.findByRole('heading', { level: 1 })
    expect(outcomeRegion()).toBeEmptyDOMElement()
  })
})

describe('C-WEB-D-RELOAD-ONE: each read writes one audit row', () => {
  it.each<[string, boolean]>([
    ['applied', false],
    ['applied under strict mode', true],
  ])('reads once after %s', async (_label, strict) => {
    const { reads } = await openCase(
      undefined,
      undefined,
      { revision: MOVED_REVISION },
      strict
    )
    expect(reads).toHaveLength(1)
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reads).toEqual(['post.p1', 'post.p1'])
  })

  it('reads once after a replay', async () => {
    const { reads } = await openCase(() => json(decisionBody({ replayed: true })))
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reads).toHaveLength(2)
    expect(outcomeRegion()).toHaveTextContent('The reports are resolved.')
  })

  it('reads nothing after a conflict until the moderator asks, then once', async () => {
    const { reads } = await openCase(conflict, undefined, { revision: MOVED_REVISION })
    await submitResolve()
    const alert = await screen.findByRole('alert')
    await settle()
    expect(reads).toHaveLength(1)
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(reads).toHaveLength(2)
  })

  it.each<[string, () => Response]>([
    ['offline', offline],
    ['audit unavailable', closed(503, 'audit_unavailable')],
    [
      'not applicable',
      closed(409, 'action_not_applicable', { detail: 'no_open_reports' }),
    ],
    ['forbidden', closed(403, 'admin_required')],
  ])('reads nothing after %s', async (_label, respond) => {
    const { reads } = await openCase(respond)
    await submitResolve()
    await screen.findByRole('alert')
    await settle()
    expect(reads).toHaveLength(1)
  })

  it('keeps the outcome, focused, when the one read after it fails', async () => {
    const reads: string[] = []
    mockApi(
      detailHandler(
        (_id, call) =>
          call === 1
            ? json({ data: detail({ allowedActions: ['resolve'] }) })
            : json({ statusCode: 500 }, 500),
        reads
      ),
      mutationHandler<ModerationDecisionInput>(DECISION_PATH, () => json(decisionBody()))
    )
    render(<ModerationCaseDetailView caseId="post.p1" />)
    await screen.findByRole('heading', { level: 1 })
    await submitResolve()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh. Showing the last result.'
    )
    expect(reads).toHaveLength(2)
    expect(outcomeRegion()).toHaveTextContent('The reports are resolved.')
    await waitFor(() => expect(document.activeElement).toBe(outcomeRegion()))
  })

  it('reads nothing on focus, online or visibility after an outcome', async () => {
    const { reads } = await openCase()
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(reads).toHaveLength(2)
  })
})

describe('C-WEB-D-HOSTILE', () => {
  const RLO = String.fromCodePoint(0x202e)
  const PDF = String.fromCodePoint(0x202c)
  const ZWSP = String.fromCodePoint(0x200b)
  const hostile = (label: string) =>
    `<script>window.__pwn_${label}=1</script><img src=x onerror=alert(1)> [click](javascript:alert(1)) **bold** ${RLO}evil${PDF} zero${ZWSP}width`
  const inert = () => {
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
    expect(document.querySelector('strong, b')).toBeNull()
    expect(document.querySelector('[onerror]')).toBeNull()
    expect(Object.keys(window).filter((key) => key.startsWith('__pwn_'))).toEqual([])
  }

  it('renders prior actions and the subject alias through PlainText, inert and wrapped', async () => {
    const alias = hostile('alias').slice(0, 64)
    await openCase(undefined, {
      subject: { state: 'alias', alias },
      priorActions: [
        {
          actorKind: 'operator',
          action: 'taken_down_by_operator',
          reason: hostile('action'),
          occurredAt: '2026-11-03T10:00:00.000Z',
        },
        {
          actorKind: 'operator',
          action: '<b>not-a-closed-action</b>',
          reason: 'x'.repeat(500),
          occurredAt: '2026-11-03T11:00:00.000Z',
        },
      ],
      media: { state: 'unavailable', reason: 'no_image' },
    })
    inert()
    const prior = screen.getByRole('region', { name: 'Prior actions' })
    expect(prior.textContent).toContain('<script>window.__pwn_action=1</script>')
    expect(prior.textContent).toContain('**bold**')
    // The bidi control reads as a visible marker and never reorders the line.
    expect(prior.textContent).toContain('<U+202E>evil<U+202C>')
    expect(prior.textContent).not.toContain(RLO)
    // A label the catalog does not know reads neutrally, never as the raw value.
    expect(prior.textContent).toContain('Other action')
    expect(prior.textContent).not.toContain('not-a-closed-action')

    const content = screen.getByRole('region', { name: 'Reported content' })
    expect(content.textContent).toContain('<script>window.__pwn_alias=')

    const long = screen.getByText('x'.repeat(500)).closest('[dir]')
    expect(long?.className).toContain('[overflow-wrap:anywhere]')
    expect(long).toHaveAttribute('dir', 'auto')
  })

  it('keeps a hostile typed reason as text in the field, in the failure and in the body sent', async () => {
    const { bodies } = await openCase(conflict)
    const typed = hostile('reason')
    typeReason(typed)
    await userEvent.click(submitButton())
    await screen.findByRole('alert')
    inert()
    expect(reasonBox()).toHaveValue(typed)
    expect(bodies[0]?.reason).toBe(typed)
    expect(screen.getByRole('alert').textContent).not.toContain('__pwn_')
  })

  it('never echoes the typed reason into the announced outcome', async () => {
    const { reads } = await openCase()
    typeReason(hostile('outcome'))
    await userEvent.click(submitButton())
    await waitFor(() => expect(reads).toHaveLength(2))
    inert()
    expect(outcomeRegion().textContent).toBe('The reports are resolved.')
  })
})

describe('C-WEB-D-A11Y', () => {
  it('names the reason, the kind, the duration and the action group', async () => {
    await openCase(undefined, {
      allowedActions: ['resolve', 'ban'],
      banKinds: ['temporary'],
    })
    await chooseAction('ban')
    expect(screen.getByRole('region', { name: 'Decision' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Action' })).toBeInTheDocument()
    expect(reasonBox()).toBeRequired()
    expect(reasonBox()).toHaveAccessibleDescription('0 of 1000 characters, at least 3')
    expect(screen.getByRole('combobox', { name: 'Ban type' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Duration' })).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAccessibleName()
  })

  it('tabs from the header through the action, the terms, the reason and the submit, in reading order', async () => {
    await openCase(undefined, {
      allowedActions: ['ban'],
      banKinds: ['temporary', 'permanent'],
    })
    const order: string[] = []
    for (let step = 0; step < 7; step++) {
      await userEvent.tab()
      const active = document.activeElement as HTMLElement
      order.push(
        active.getAttribute('aria-label') ??
          (active.tagName === 'SELECT'
            ? `select:${(active as HTMLSelectElement).value}`
            : active.tagName === 'TEXTAREA'
              ? 'reason'
              : active.tagName === 'INPUT'
                ? 'radio'
                : (active.textContent ?? ''))
      )
    }
    expect(order).toEqual([
      'Back to queue',
      'Reload case',
      'radio',
      'select:temporary',
      'select:7',
      'reason',
      'Apply decision',
    ])
  })

  it('gives every control a 44 pixel target and a visible focus style', async () => {
    await openCase(undefined, {
      allowedActions: ['resolve', 'ban'],
      banKinds: ['temporary'],
    })
    await chooseAction('ban')
    typeReason()
    await userEvent.click(submitButton())
    const panel = screen.getByRole('region', { name: 'Decision' })
    for (const control of [
      ...within(panel).getAllByRole('combobox'),
      ...within(panel).getAllByRole('button'),
      reasonBox(),
    ]) {
      expect(control.className, control.outerHTML.slice(0, 80)).toMatch(/min-h-\[44px\]/)
      expect(control.className).toMatch(/focus-visible:outline/)
    }
    // The whole label row is the target of a radio.
    for (const radio of within(panel).getAllByRole('radio'))
      expect(radio.closest('label')?.className).toMatch(/min-h-\[44px\]/)
  })

  it('moves focus to the outcome after the reload, when the panel has remounted', async () => {
    const { reads } = await openCase(undefined, undefined, {
      revision: MOVED_REVISION,
      allowedActions: [],
    })
    await submitResolve()
    await waitFor(() => expect(reads).toHaveLength(2))
    await waitFor(() => expect(document.activeElement).toBe(outcomeRegion()))
    expect(outcomeRegion()).toHaveAttribute('tabindex', '-1')
  })

  it('holds one outcome region and at most one alert in every state', async () => {
    await openCase(offline)
    expect(
      document.querySelectorAll('[data-testid="moderation-decision-outcome"]')
    ).toHaveLength(1)
    await submitResolve()
    await screen.findByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(
      document.querySelectorAll('[data-testid="moderation-decision-outcome"]')
    ).toHaveLength(1)
  })

  it('keeps focus on the page when a confirmed decision fails', async () => {
    await openCase(offline, { allowedActions: ['takedown'] })
    typeReason()
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await screen.findByRole('alert')
    await settle()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps focus on the page after a conflict reload brings a new revision', async () => {
    const { reads } = await openCase(conflict, undefined, { revision: MOVED_REVISION })
    await submitResolve()
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload case' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await settle()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('has no axe violation idle, with ban terms, confirming, failed or applied', async () => {
    const standing = {
      subjectStanding: {
        active: true,
        sanction: {
          sanctionId: 's1',
          kind: 'temporary' as const,
          expiresAt: '2026-11-10T12:00:00.000Z',
          appealStatus: 'not_requested' as const,
        },
        priorBanCount: 1,
        allowedAppealSteps: ['requested' as const],
      },
    }
    const view = await openCase(
      (_body, call) =>
        call === 1
          ? closed(409, 'action_not_applicable', { detail: 'target_erased' })()
          : json(decisionBody({ action: 'ban' })),
      {
        ...standing,
        escalated: true,
        firstDecisionAt: '2026-11-03T09:00:00.000Z',
        allowedActions: ['resolve', 'ban'],
        banKinds: ['temporary', 'permanent'],
      }
    )
    expect(await violations(view.container)).toEqual([])
    await chooseAction('ban')
    expect(await violations(view.container)).toEqual([])
    typeReason()
    await userEvent.click(submitButton())
    expect(await violations(view.container)).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await screen.findByRole('alert')
    expect(await violations(view.container)).toEqual([])
    await userEvent.click(submitButton())
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply it' }))
    await waitFor(() => expect(view.reads).toHaveLength(2))
    await settle()
    expect(await violations(view.container)).toEqual([])
  })
})
