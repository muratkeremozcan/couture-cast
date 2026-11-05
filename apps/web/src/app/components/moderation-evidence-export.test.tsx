// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: W-EXPORT-CONTROL, W-RANGE-FORM, W-REMOVED-LABEL, W-FLAG-OFF, W-LOCALES, W-A11Y, W-CLIENT.
// Layout-dependent checks (contrast, real target pixels, widths and themes) run in the browser, M-VISUAL.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModerationEvidenceBundle } from '@couture/api-client/contracts/http'
import { useMswHandlers as mockApi } from '../../test-utils/msw/runtime'
import {
  detail,
  detailHandler,
  errorBody,
  json,
  queueHandler,
  page as queuePage,
  signIn,
  summary,
} from '../../test-utils/moderation-console'
import enUS from '../../i18n/locales/en-US.json'
import { ModerationCaseDetailView } from './moderation-case-detail'
import {
  ModerationEvidenceExport,
  ModerationEvidenceLink,
  ModerationEvidenceRange,
} from './moderation-evidence-export'
import { ModerationQueueView } from './moderation-queue'

const AVAILABILITY = '*/api/v1/moderation/evidence-exports/availability'
const EXPORT = '*/api/v1/moderation/evidence-exports'
const AT = '2026-11-05T12:00:00.000Z'
const copy = enUS.moderation.evidence

const bundle = (
  overrides: Partial<ModerationEvidenceBundle> = {}
): ModerationEvidenceBundle => ({
  schemaVersion: 1,
  exportId: '6f1d8c0a-6c9a-4f43-9a55-7a2a8d4d2c11',
  generatedAt: AT,
  scope: { scope: 'case', caseId: 'post.p1' },
  sha256: 'a'.repeat(64),
  counts: { decisions: 1, reports: 2, auditEvents: 3, alerts: 4, withheldForConflict: 0 },
  decisions: [],
  reports: [],
  auditEvents: [],
  alerts: [],
  ...overrides,
})

const available = (rangeExport = false) =>
  http.get(AVAILABILITY, () => json({ data: { rangeExport } }))
const closed = () =>
  http.get(AVAILABILITY, () => json(errorBody(503, 'moderation_history_disabled'), 503))

function exportHandler(answer: () => Response, bodies: unknown[] = []) {
  return http.post(EXPORT, async ({ request }) => {
    bodies.push(await request.json())
    return answer()
  })
}

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let clickedDownloads: string[]

beforeEach(() => {
  signIn()
  clickedDownloads = []
  createObjectURL = vi.fn(() => 'blob:evidence')
  revokeObjectURL = vi.fn()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clickedDownloads.push(this.download)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

const pressExport = async () => {
  const button = await screen.findByRole('button', { name: copy.exportCase })
  await userEvent.click(button)
  return button
}

describe('W-EXPORT-CONTROL', () => {
  it('downloads the bundle, names the file from exportId, and announces counts and digest once', async () => {
    const bodies: unknown[] = []
    mockApi(
      available(),
      exportHandler(() => HttpResponse.json(bundle()), bodies)
    )
    render(<ModerationEvidenceExport caseId="post.p1" />)
    await pressExport()
    const status = await screen.findByText(/Evidence file downloaded/)
    expect(status.textContent).toContain('Decisions: 1. Reports: 2')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status').textContent).toContain('a'.repeat(64))
    expect(bodies).toEqual([{ scope: 'case', caseId: 'post.p1' }])
    expect(clickedDownloads).toEqual([
      'moderation-evidence-6f1d8c0a-6c9a-4f43-9a55-7a2a8d4d2c11.json',
    ])
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('saves the response bytes as sent, so the digest describes the file', async () => {
    const raw = JSON.stringify(bundle(), null, 2)
    let saved: Blob | undefined
    createObjectURL.mockImplementation((blob: Blob) => {
      saved = blob
      return 'blob:evidence'
    })
    mockApi(
      available(),
      exportHandler(
        () =>
          new HttpResponse(raw, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    )
    render(<ModerationEvidenceExport caseId="post.p1" />)
    await pressExport()
    await screen.findByText(/Evidence file downloaded/)
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(saved!)
    })
    expect(text).toBe(raw)
  })

  it('shows working, blocks a second press, and sends one request', async () => {
    let release: (() => void) | undefined
    const bodies: unknown[] = []
    mockApi(
      available(),
      http.post(EXPORT, async ({ request }) => {
        bodies.push(await request.json())
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(bundle())
      })
    )
    render(<ModerationEvidenceExport caseId="post.p1" />)
    const button = await pressExport()
    await screen.findByText(copy.working)
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    await waitFor(() => expect(release).toBeDefined())
    release!()
    await screen.findByText(/Evidence file downloaded/)
    expect(bodies).toHaveLength(1)
  })

  it.each([
    [403, 'self_review_refused', copy.failure.self_review_refused],
    [503, 'audit_unavailable', copy.failure.audit_unavailable],
    [413, 'export_too_large', copy.failure.export_too_large],
    [404, 'case_not_found', copy.failure.case_not_found],
    [503, 'moderation_history_disabled', copy.failure.moderation_history_disabled],
  ])(
    'shows the sentence for %i %s, and downloads nothing',
    async (status, code, sentence) => {
      mockApi(
        available(),
        exportHandler(() => json(errorBody(status, code), status))
      )
      render(<ModerationEvidenceExport caseId="post.p1" />)
      await pressExport()
      expect(await screen.findByText(sentence)).toBeInTheDocument()
      expect(clickedDownloads).toEqual([])
    }
  )

  it.each([
    [401, copy.failure.signed_out],
    [403, copy.failure.forbidden],
    [429, copy.failure.rate_limited],
    [500, copy.failure.unavailable],
  ])('falls back on the status for a bare %i', async (status, sentence) => {
    mockApi(
      available(),
      exportHandler(() => json({ statusCode: status }, status))
    )
    render(<ModerationEvidenceExport caseId="post.p1" />)
    await pressExport()
    expect(await screen.findByText(sentence)).toBeInTheDocument()
  })

  it('refuses a body the strict schema rejects, and saves nothing', async () => {
    mockApi(
      available(),
      exportHandler(() =>
        HttpResponse.json({ ...bundle(), reporter_id: 'member-1' } as unknown as object)
      )
    )
    render(<ModerationEvidenceExport caseId="post.p1" />)
    await pressExport()
    expect(await screen.findByText(copy.failure.unavailable)).toBeInTheDocument()
    expect(clickedDownloads).toEqual([])
  })
})

describe('W-RANGE-FORM', () => {
  const fill = async (from: string, to: string) => {
    await userEvent.type(await screen.findByLabelText(copy.from), from)
    await userEvent.type(screen.getByLabelText(copy.to), to)
    await userEvent.click(screen.getByRole('button', { name: copy.exportRange }))
  }

  it('sends whole UTC days and reports what was withheld', async () => {
    const bodies: unknown[] = []
    mockApi(
      available(true),
      exportHandler(
        () =>
          HttpResponse.json(
            bundle({
              scope: {
                scope: 'range',
                from: '2026-10-01T00:00:00.000Z',
                to: '2026-10-02T23:59:59.999Z',
              },
              counts: {
                decisions: 1,
                reports: 0,
                auditEvents: 0,
                alerts: 0,
                withheldForConflict: 2,
              },
            })
          ),
        bodies
      )
    )
    render(<ModerationEvidenceRange />)
    await fill('2026-10-01', '2026-10-02')
    expect(
      await screen.findByText(
        /Decisions left out because you wrote or reported those cases: 2/
      )
    ).toBeInTheDocument()
    expect(bodies).toEqual([
      {
        scope: 'range',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T23:59:59.999Z',
      },
    ])
  })

  it.each([
    ['more than 90 days', '2026-01-01', '2026-06-01'],
    ['an end before the start', '2026-10-02', '2026-10-01'],
  ])('refuses %s in the browser, with no request', async (_name, from, to) => {
    const bodies: unknown[] = []
    mockApi(
      available(true),
      exportHandler(() => HttpResponse.json(bundle()), bodies)
    )
    render(<ModerationEvidenceRange />)
    await fill(from, to)
    expect(await screen.findByText(copy.failure.invalid_range)).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('refuses an empty form, with no request', async () => {
    const bodies: unknown[] = []
    mockApi(
      available(true),
      exportHandler(() => HttpResponse.json(bundle()), bodies)
    )
    render(<ModerationEvidenceRange />)
    await userEvent.click(await screen.findByRole('button', { name: copy.exportRange }))
    expect(await screen.findByText(copy.failure.invalid_range)).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('shows export_too_large from the route', async () => {
    mockApi(
      available(true),
      exportHandler(() => json(errorBody(413, 'export_too_large'), 413))
    )
    render(<ModerationEvidenceRange />)
    await fill('2026-10-01', '2026-10-02')
    expect(await screen.findByText(copy.failure.export_too_large)).toBeInTheDocument()
  })

  it('tells a moderator only an admin can use it, with no form', async () => {
    mockApi(available(false))
    render(<ModerationEvidenceRange />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.failure.admin_required
    )
    expect(screen.queryByRole('button', { name: copy.exportRange })).toBeNull()
  })
})

describe('W-REMOVED-LABEL', () => {
  it('renders the localized label, and the constant never reaches the page', async () => {
    mockApi(
      available(),
      detailHandler(() =>
        json({
          data: detail({
            priorActions: [
              {
                actorKind: 'operator',
                action: 'ban',
                reason: null,
                reasonRemoved: true,
                occurredAt: AT,
              },
              {
                actorKind: 'operator',
                action: 'escalate',
                reason: 'A kept rationale.',
                reasonRemoved: false,
                occurredAt: AT,
              },
            ],
          }),
        })
      )
    )
    const { container } = render(<ModerationCaseDetailView caseId="post.p1" />)
    expect(
      await screen.findByText(enUS.moderation.detail.reasonRemoved)
    ).toBeInTheDocument()
    expect(screen.getByText('A kept rationale.')).toBeInTheDocument()
    expect(container.textContent).not.toContain('[erased]')
  })
})

describe('W-FLAG-OFF', () => {
  it('renders no case control', async () => {
    let answered = false
    mockApi(
      http.get(AVAILABILITY, () => {
        answered = true
        return json(errorBody(503, 'moderation_history_disabled'), 503)
      })
    )
    const { container } = render(<ModerationEvidenceExport caseId="post.p1" />)
    await waitFor(() => expect(answered).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders no queue link, for a moderator or with the flag off', async () => {
    for (const handler of [available(false), closed()]) {
      mockApi(handler)
      const view = render(<ModerationEvidenceLink />)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(view.container).toBeEmptyDOMElement()
      view.unmount()
    }
  })

  it('offers the queue link to an admin', async () => {
    mockApi(
      available(true),
      queueHandler(() => json(queuePage([summary()])))
    )
    render(<ModerationQueueView />)
    expect(await screen.findByRole('link', { name: copy.link })).toHaveAttribute(
      'href',
      '/moderation/evidence'
    )
  })

  it('closes the page', async () => {
    mockApi(closed())
    render(<ModerationEvidenceRange />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.failure.moderation_history_disabled
    )
    expect(screen.queryByRole('button', { name: copy.exportRange })).toBeNull()
  })
})

describe('W-LOCALES', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) =>
          flatten(child, prefix ? `${prefix}.${key}` : key)
        )
      : [prefix]
  const dir = join(__dirname, '../../i18n/locales')
  const locales = readdirSync(dir).filter((name) => name.endsWith('.json'))
  const load = (name: string) =>
    JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
      moderation: { evidence: object; detail: { reasonRemoved?: string } }
    }

  it('covers all ten web locales', () => {
    expect(locales).toHaveLength(10)
  })

  it.each(locales)('%s holds every evidence key, translated where it must be', (name) => {
    const catalog = load(name)
    expect(flatten(catalog.moderation.evidence, 'evidence').sort()).toEqual(
      flatten(enUS.moderation.evidence, 'evidence').sort()
    )
    expect(catalog.moderation.detail.reasonRemoved).toEqual(expect.any(String))
    expect(catalog.moderation.detail.reasonRemoved).not.toContain('[erased]')
    if (!name.startsWith('en-'))
      expect(catalog.moderation.detail.reasonRemoved).not.toBe(
        enUS.moderation.detail.reasonRemoved
      )
  })
})

describe('W-A11Y', () => {
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  const violations = async (container: HTMLElement) => {
    const result = await axe.run(container, {
      runOnly: { type: 'tag', values: TAGS },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`)
  }

  it('passes axe on the case control, in each state', async () => {
    mockApi(
      available(),
      exportHandler(() => HttpResponse.json(bundle()))
    )
    const { container } = render(<ModerationEvidenceExport caseId="post.p1" />)
    const button = await screen.findByRole('button', { name: copy.exportCase })
    expect(await violations(container)).toEqual([])
    await userEvent.click(button)
    await screen.findByText(/Evidence file downloaded/)
    expect(await violations(container)).toEqual([])
    expect(button).toHaveFocus()
    expect(button.className).toMatch(/min-h-\[44px\]/)
  })

  it('passes axe on the range form, with labelled dates', async () => {
    mockApi(available(true))
    const { container } = render(<ModerationEvidenceRange />)
    const form = await screen.findByRole('button', { name: copy.exportRange })
    expect(within(form.closest('form')!).getByLabelText(copy.from)).toHaveAttribute(
      'type',
      'date'
    )
    expect(screen.getByLabelText(copy.to).className).toMatch(/min-h-\[44px\]/)
    expect(await violations(container)).toEqual([])
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title)
  })
})
