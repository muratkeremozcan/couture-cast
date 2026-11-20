// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// PR 259 round 3 (CodeRabbit, palette-advisor-panel.tsx `refresh`): erasing the member's palette
// data must stick. When a wardrobe write is refused because an analysis already runs, the panel
// reads the server's state again (`refresh`). If that read is still out when the member erases
// their data, its answer is the profile the server held before the erase, and it used to land
// after the erase's own answer: the consent state and the analysis came back on screen.
// A recovery read is accepted only while no newer write has been accepted since it started.
import { http, HttpResponse } from 'msw'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE } from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { signInFixtureMember } from '../../test-utils/member-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  PALETTE_PATH,
  errorBody,
  profile,
  readyAnalysis,
  renderPanel,
} from '../../test-utils/palette-advisor-panel'
import { settle } from '../../test-utils/request-barrier'

const DENIED = { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' }
/** What the server held before the erase: consent given, a ready analysis. */
const BEFORE_ERASE = () => profile({ hasConsent: true, analysis: readyAnalysis(null) })
const ERASED = () => profile({ hasConsent: false, analysis: null })
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

function hold() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

/** The bridge installs the member's next bearer (a fixture bearer keeps the same owner). */
function rotateBearer(token: string) {
  act(() => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/**
 * The handlers of a panel whose recovery read (the second GET, from `refresh` after a refused
 * wardrobe write) is held until `recovery.release()`. `answer` decides what it returns then.
 */
function useRecoveryHandlers(
  answer: (bearer: string | null) => Response,
  options: { erase?: () => void } = {}
) {
  signInFixtureMember('test-token-a')
  const recovery = hold()
  const reads: (string | null)[] = []
  useMswHandlers(
    http.get(PALETTE_PATH, async ({ request }) => {
      const bearer = request.headers.get('authorization')
      reads.push(bearer)
      // The first read is the panel's own; the second is the recovery read, held.
      if (reads.length === 1) return HttpResponse.json({ data: BEFORE_ERASE() })
      await recovery.gate
      return answer(bearer)
    }),
    http.post(`${PALETTE_PATH}/analyze`, () =>
      errorBody(409, PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE, 'Conflict')
    ),
    http.delete(PALETTE_PATH, () => {
      options.erase?.()
      return HttpResponse.json({ data: ERASED() })
    })
  )
  return { reads, recovery }
}

/** Renders the panel and refuses one wardrobe write: the recovery read is out and held. */
async function startRecovery(reads: (string | null)[]) {
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByTestId('palette-advisor-source-wardrobe'))
  await waitFor(() => expect(reads).toHaveLength(2))
  return user
}

async function eraseData(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('palette-advisor-consent-revoke'))
  await user.click(screen.getByTestId('palette-advisor-erase-confirm-yes'))
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

    await act(async () => {
      recovery.release()
      await Promise.resolve()
    })
    // The denied read is read again with the fresh bearer, and that answer is the old profile.
    await waitFor(() => expect(reads).toHaveLength(3))
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

    await act(async () => {
      recovery.release()
      await Promise.resolve()
    })
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

    await act(async () => {
      recovery.release()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('palette-advisor-status')).toHaveTextContent(
      'Analyzing your palette…'
    )
    await settle()
    expect(reads).toEqual([
      'Bearer test-token-a',
      'Bearer test-token-a',
      'Bearer test-token-b',
    ])
  })

  it('ERASE-RACE-04 control: an erase that finished before the recovery read started does not drop it', async () => {
    signInFixtureMember('test-token-a')
    let reads = 0
    useMswHandlers(
      http.get(PALETTE_PATH, () => {
        reads += 1
        // The panel's read, then the profile after the erase and a new consent.
        return HttpResponse.json({
          data: reads === 1 ? BEFORE_ERASE() : profile({ hasConsent: true }),
        })
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
    await user.click(await screen.findByTestId('palette-advisor-source-wardrobe'))

    // The refusal's recovery read starts after the last accepted write, so its answer stands.
    await waitFor(() => expect(reads).toBe(2))
    await settle()
    expect(screen.getByTestId('palette-advisor-sources')).toBeInTheDocument()
  })
})
