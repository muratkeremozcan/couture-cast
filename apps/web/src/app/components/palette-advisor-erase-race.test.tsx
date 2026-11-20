// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// PR 259 round 3 (CodeRabbit, palette-advisor-panel.tsx `refresh`): erasing the member's palette
// data must stick. When a wardrobe write is refused because an analysis already runs, the panel
// reads the server's state again (`refresh`). If that read is still out when the member erases
// their data, its answer is the profile the server held before the erase, and it used to land
// after the erase's own answer: the consent state and the analysis came back on screen.
// A recovery read is accepted only while no newer write has changed the profile since it started;
// a write that only failed (nothing changed) leaves it valid.
//
// Each case holds the recovery read, releases it only after the transition before it showed, and
// awaits the production client's own promise inside `act` before asserting: the assertion follows
// the client consuming the answer, not a count of timers.
import { http, HttpResponse } from 'msw'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADVISOR_RULES,
  PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import type * as PaletteAdvisor from '../../lib/palette-advisor'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { signInFixtureMember } from '../../test-utils/member-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  PALETTE_PATH,
  card,
  errorBody,
  profile,
  readyAnalysis,
  renderPanel,
} from '../../test-utils/palette-advisor-panel'
import { settle } from '../../test-utils/request-barrier'

/** Every call the panel makes through the production client, so a test can await its result. */
const client = vi.hoisted(() => ({
  get: [] as Promise<unknown>[],
  erase: [] as Promise<unknown>[],
  consent: [] as Promise<unknown>[],
  update: [] as Promise<unknown>[],
}))
vi.mock('../../lib/palette-advisor', async (importOriginal) => {
  const actual = await importOriginal<typeof PaletteAdvisor>()
  const record =
    <Args extends unknown[], Result extends Promise<unknown>>(
      list: Promise<unknown>[],
      call: (...args: Args) => Result
    ) =>
    (...args: Args): Result => {
      const pending = call(...args)
      list.push(pending)
      return pending
    }
  return {
    ...actual,
    getPaletteAdvisorFromWeb: record(client.get, actual.getPaletteAdvisorFromWeb),
    erasePaletteAdvisorFromWeb: record(client.erase, actual.erasePaletteAdvisorFromWeb),
    setPaletteConsentFromWeb: record(client.consent, actual.setPaletteConsentFromWeb),
    updateAdvisorRecommendationFromWeb: record(
      client.update,
      actual.updateAdvisorRecommendationFromWeb
    ),
  }
})

/** The production client call has answered and the panel has applied it. */
const consumed = (pending: Promise<unknown> | undefined) =>
  act(async () => {
    await Promise.allSettled([pending])
    await Promise.resolve()
  })

const FOUNDATION = ADVISOR_RULES.warm.foundation.withDepth.medium
const DENIED = { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' }
/** What the server held before the erase: consent given, a ready analysis. */
const BEFORE_ERASE = () => profile({ hasConsent: true, analysis: readyAnalysis(null) })
const ERASED = () => profile({ hasConsent: false, analysis: null })
/** A profile no other answer in these tests returns: its status line is its own evidence. */
const RUNNING = () =>
  profile({
    hasConsent: true,
    analysis: {
      status: 'processing',
      failureReason: null,
      source: 'wardrobe',
      undertone: null,
      depth: null,
      confidence: null,
      analysisVersion: null,
      analyzedAt: null,
    },
  } as Parameters<typeof profile>[0])
const RUNNING_TEXT = 'Analyzing your palette…'

function hold() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

const open = (gate: { release: () => void }) =>
  act(async () => {
    gate.release()
    await Promise.resolve()
  })

/** The bridge installs the member's next bearer (a fixture bearer keeps the same owner). */
function rotateBearer(token: string) {
  act(() => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/**
 * The handlers of a panel whose recovery read (the second GET, from `refresh` after a refused
 * wardrobe write) is held until `recovery` opens. `answer` decides what it returns then.
 */
function useRecoveryHandlers(answer: (bearer: string | null) => Response) {
  signInFixtureMember('test-token-a')
  const recovery = hold()
  const reads: (string | null)[] = []
  useMswHandlers(
    http.get(PALETTE_PATH, async ({ request }) => {
      const bearer = request.headers.get('authorization')
      reads.push(bearer)
      // The first read is the panel's own; the second is the recovery read, held.
      if (reads.length === 1)
        return HttpResponse.json({
          data: {
            ...BEFORE_ERASE(),
            analysis: readyAnalysis('medium'),
            recommendations: [card(FOUNDATION)],
          },
        })
      await recovery.gate
      return answer(bearer)
    }),
    http.post(`${PALETTE_PATH}/analyze`, () =>
      errorBody(409, PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE, 'Conflict')
    ),
    http.put(`${PALETTE_PATH}/recommendations`, () =>
      errorBody(500, 'Internal error', 'Internal Server Error')
    ),
    http.delete(PALETTE_PATH, () => HttpResponse.json({ data: ERASED() }))
  )
  return { reads, recovery }
}

/** Renders the panel and refuses one wardrobe write: the recovery read is out and held. */
async function startRecovery(reads: (string | null)[]) {
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByTestId('palette-advisor-source-wardrobe'))
  await waitFor(() => expect(reads).toHaveLength(2))
  expect(client.get).toHaveLength(2)
  return user
}

/** The erase answers and the panel shows the consent gate before the test goes on. */
async function eraseData(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('palette-advisor-consent-revoke'))
  await user.click(screen.getByTestId('palette-advisor-erase-confirm-yes'))
  await consumed(client.erase.at(-1))
  await screen.findByTestId('palette-advisor-consent-grant')
}

function expectPanelErased() {
  expect(screen.getByTestId('palette-advisor-consent-grant')).toBeInTheDocument()
  expect(screen.queryByTestId('palette-advisor-consent-revoke')).toBeNull()
  expect(screen.queryByTestId('palette-advisor-sources')).toBeNull()
  expect(screen.queryByTestId('palette-advisor-status')).toBeNull()
}

describe('the palette advisor after an erase', () => {
  beforeEach(async () => {
    window.sessionStorage.clear()
    client.get.length = 0
    client.erase.length = 0
    client.consent.length = 0
    client.update.length = 0
    await getI18n().changeLanguage('en-US')
  })

  it('ERASE-RACE-01 a recovery read retried after a bearer rotation never restores the erased profile', async () => {
    const { reads, recovery } = useRecoveryHandlers((bearer) =>
      // The held read belongs to the replaced bearer; the retry gets what the server held
      // before the erase.
      bearer === 'Bearer test-token-a'
        ? HttpResponse.json(DENIED, { status: 401 })
        : HttpResponse.json({ data: BEFORE_ERASE() })
    )
    const user = await startRecovery(reads)
    rotateBearer('test-token-b')
    await eraseData(user)

    await open(recovery)
    await consumed(client.get[1])
    // The denied read is read again with the fresh bearer, and that answer is the old profile.
    await waitFor(() => expect(client.get).toHaveLength(3))
    await consumed(client.get[2])
    await settle()

    expect(reads[2]).toBe('Bearer test-token-b')
    expectPanelErased()
  })

  it('ERASE-RACE-02 a recovery read that answers after the erase, with no rotation, does not restore it', async () => {
    const { reads, recovery } = useRecoveryHandlers(() =>
      HttpResponse.json({ data: BEFORE_ERASE() })
    )
    const user = await startRecovery(reads)
    await eraseData(user)

    await open(recovery)
    await consumed(client.get[1])
    await settle()

    expect(reads).toHaveLength(2)
    expectPanelErased()
  })

  it('ERASE-RACE-03 control: with no newer write, the recovery read retried after a rotation is accepted', async () => {
    const { reads, recovery } = useRecoveryHandlers((bearer) =>
      bearer === 'Bearer test-token-a'
        ? HttpResponse.json(DENIED, { status: 401 })
        : HttpResponse.json({ data: RUNNING() })
    )
    await startRecovery(reads)
    rotateBearer('test-token-b')

    await open(recovery)
    await consumed(client.get[1])
    await waitFor(() => expect(client.get).toHaveLength(3))
    await consumed(client.get[2])

    expect(await screen.findByTestId('palette-advisor-status')).toHaveTextContent(
      RUNNING_TEXT
    )
    await settle()
    expect(reads).toEqual([
      'Bearer test-token-a',
      'Bearer test-token-a',
      'Bearer test-token-b',
    ])
  })

  it('ERASE-RACE-04 control: a recovery read that starts after the erase and the next consent is accepted', async () => {
    signInFixtureMember('test-token-a')
    let reads = 0
    useMswHandlers(
      http.get(PALETTE_PATH, () => {
        reads += 1
        // The panel's own read, then the recovery read after the erase and a new consent:
        // the only answer in this test that is a running analysis.
        return HttpResponse.json({ data: reads === 1 ? BEFORE_ERASE() : RUNNING() })
      }),
      http.delete(PALETTE_PATH, () => HttpResponse.json({ data: ERASED() })),
      http.post(`${PALETTE_PATH}/consent`, () =>
        HttpResponse.json({ data: profile({ hasConsent: true }) })
      ),
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(409, PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE, 'Conflict')
      )
    )
    renderPanel()
    const user = userEvent.setup()
    await eraseData(user)
    await user.click(screen.getByTestId('palette-advisor-consent-grant'))
    await consumed(client.consent.at(-1))
    await user.click(await screen.findByTestId('palette-advisor-source-wardrobe'))

    // The refusal's recovery read starts after the last accepted write: its answer shows.
    await waitFor(() => expect(client.get).toHaveLength(2))
    await consumed(client.get[1])
    expect(await screen.findByTestId('palette-advisor-status')).toHaveTextContent(
      RUNNING_TEXT
    )
  })

  it('ERASE-RACE-05 a write that only failed, changing nothing, does not discard a valid recovery read', async () => {
    const { reads, recovery } = useRecoveryHandlers(() =>
      HttpResponse.json({ data: { ...RUNNING(), recommendations: [card(FOUNDATION)] } })
    )
    const user = await startRecovery(reads)

    // A recommendation save fails with a server error while the recovery read is out.
    await user.click(
      await screen.findByTestId(`palette-advisor-save-${FOUNDATION.itemKey}`)
    )
    await consumed(client.update.at(-1))
    expect(client.update).toHaveLength(1)

    await open(recovery)
    await consumed(client.get[1])

    expect(await screen.findByTestId('palette-advisor-status')).toHaveTextContent(
      RUNNING_TEXT
    )
  })
})
