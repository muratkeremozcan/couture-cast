// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.11 test owner: C-WEB-D-BANNED-NOTICE, the D14 author state, and the TEA-22 banned state in the grid and the teaser.
// Fix round 1: the sanction leaves with the session that owned it, and a live ban takes the weekly challenge with it.
// The grid runs through the real web transport and MSW.
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_BANNED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  moderationAppealStatusSchema,
  type CommunityBannedError,
  type ModerationAppealStatus,
} from '@couture/api-client/contracts/http'
import {
  COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS,
  CommunitySyncState,
  SPOTLIGHT_TEASER_REREAD_MS,
} from '@couture/api-client'
import { getI18n } from '../../i18n'
import deDE from '../../i18n/locales/de-DE.json'
import enUS from '../../i18n/locales/en-US.json'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  CHALLENGE,
  FEED_PATH,
  REMOVED_COPY,
  STATUS_COPY,
  authorState,
  errorBody,
  feedBody,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import { CommunityBannedNotice } from './community-banned-notice'
import { CommunityLookbookGrid } from './community-lookbook-grid'
import { useCommunitySpotlight } from './community-spotlight'
import { useHomeSpotlightTeaser } from './home-spotlight-teaser'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'
const EXPIRES_AT = '2026-11-10T12:00:00.000Z'
const temporary: CommunityBannedError['sanction'] = {
  kind: 'temporary',
  expiresAt: EXPIRES_AT,
  appealStatus: 'not_requested',
}
const permanent: CommunityBannedError['sanction'] = {
  kind: 'permanent',
  expiresAt: null,
  appealStatus: 'not_requested',
}

const longDate = (language: string) =>
  new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(EXPIRES_AT)
  )

function bannedResponse(
  sanction: CommunityBannedError['sanction'] = temporary,
  message: string = COMMUNITY_BANNED_MESSAGE
) {
  const body: CommunityBannedError = {
    statusCode: 403,
    code: 'community_banned',
    message,
    sanction,
  }
  return HttpResponse.json(body, { status: 403 })
}

const emptySpotlight = () =>
  HttpResponse.json({
    data: { level: 'none', label: null, items: [], nextCursor: null },
  })

function renderNotice(sanction: CommunityBannedError['sanction'], language = 'en-US') {
  const translate = getI18n().getFixedT(language)
  const t = (key: string, options?: Record<string, unknown>) =>
    translate(key, options ?? {})
  return render(<CommunityBannedNotice sanction={sanction} language={language} t={t} />)
}

const CANARY_URL = '/test-only/request-canary'
// The opt-in test latency can give a canary a shorter wait than an earlier request, so it also waits the longest one.
const longestTestLatencyMs = () =>
  typeof process === 'undefined' ? 0 : Number(process.env.MSW_TEST_DELAY_MS ?? 0)

// Registered ahead of each test's own handlers, so MSW tries all of those first for a canary.
beforeEach(() => {
  const install = useMswHandlers
  install(
    http.post(`*${CANARY_URL}`, async ({ request }) => {
      await request.text()
      // Nothing is delayed on a fake clock, so nothing needs outlasting there.
      if (!vi.isFakeTimers()) await delay(longestTestLatencyMs())
      return HttpResponse.json({})
    })
  )
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * Waits until every request sent so far has reached its handler, so a stray one has been counted.
 * A canary is the slowest route through MSW: it carries a body, and every other handler goes first.
 * The second round sees whatever the commits of the first round sent.
 */
const settle = async () => {
  for (let round = 0; round < 2; round += 1)
    await act(async () => {
      await fetch(CANARY_URL, { method: 'POST', body: 'canary' })
    })
}

// The longest pause any feed read takes before its one retry, plus a margin.
const FEED_RETRY_WINDOW_MS = COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS * 1000 + 1000
// The teaser's only timed read comes this long after an attempt, past both the 5 s pause and the 60 s floor.
const TEASER_RETRY_WINDOW_MS = SPOTLIGHT_TEASER_REREAD_MS + 1000

/**
 * Puts the timers on a fake clock, which a test must do before the first read.
 * A retry armed on the real clock would never notice the jump in `passRetryWindow`.
 * The clock also follows real time, so MSW and the waits of Testing Library keep moving.
 */
function startRetryClock({ withDate = false } = {}) {
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      ...(withDate ? (['Date'] as const) : []),
    ],
  })
}

/** Jumps past a retry window, then waits for whatever fired inside it to reach its handler. */
async function passRetryWindow(windowMs: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(windowMs)
  })
  await settle()
}

const notice = () => screen.getByTestId('community-banned-notice')
const queryNotice = () => screen.queryByTestId('community-banned-notice')

describe('C-WEB-D-BANNED-NOTICE: the notice', () => {
  const copy = enUS.community.banned

  it('states a temporary ban with its localized expiry and the scope', () => {
    renderNotice(temporary)
    expect(
      within(notice()).getByRole('heading', { level: 2, name: copy.title })
    ).toBeInTheDocument()
    expect(notice()).toHaveTextContent(
      copy.temporary.replace('{{until}}', longDate('en-US'))
    )
    expect(notice()).toHaveTextContent(copy.scope)
    expect(notice()).not.toHaveTextContent(copy.permanent)
  })

  it('formats the expiry in the language it is given', () => {
    renderNotice(temporary, 'de-DE')
    expect(notice()).toHaveTextContent(
      deDE.community.banned.temporary.replace('{{until}}', longDate('de-DE'))
    )
  })

  it('states a permanent ban with no date', () => {
    renderNotice(permanent)
    expect(notice()).toHaveTextContent(copy.permanent)
    expect(notice()).not.toHaveTextContent(copy.temporary.split('{{until}}')[0] ?? '')
    expect(notice().textContent).not.toMatch(/\b20\d\d\b/)
  })

  it.each(moderationAppealStatusSchema.options)(
    'states the appeal status %s',
    (appealStatus: ModerationAppealStatus) => {
      renderNotice({ ...temporary, appealStatus })
      expect(notice()).toHaveTextContent(copy.appeal[appealStatus])
      expect(notice().textContent).not.toContain(appealStatus)
    }
  )

  it('directs a member with no recorded appeal to support, and offers no appeal form', () => {
    renderNotice(temporary)
    expect(notice()).toHaveTextContent('contact CoutureCast support')
    expect(within(notice()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(notice()).queryByRole('button')).not.toBeInTheDocument()
    expect(within(notice()).queryByRole('link')).not.toBeInTheDocument()
  })

  it('names no reason, moderator, case or raw kind', () => {
    renderNotice(temporary)
    expect(notice().textContent).not.toMatch(
      /moderator|operator|\bcase\b|reason|sanction|temporary|community\.banned/i
    )
  })

  it('renders in every state with one heading and no raw key', () => {
    for (const sanction of [temporary, permanent]) {
      const view = renderNotice(sanction)
      expect(within(notice()).getAllByRole('heading')).toHaveLength(1)
      expect(notice().textContent).not.toContain('community.banned')
      view.unmount()
    }
  })
})

describe('C-WEB-D-BANNED-NOTICE: the grid', () => {
  setupCommunityGridClock()
  setupCommunityGridSurface()

  const signOut = () =>
    act(() => {
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })

  /** The whole page, so the live region that announced the ban counts too. */
  function expectNoSanctionOnPage() {
    const copy = enUS.community.banned
    expect(queryNotice()).not.toBeInTheDocument()
    const page = document.body.textContent ?? ''
    for (const words of [
      copy.title,
      copy.scope,
      copy.permanent,
      copy.temporary.split('{{until}}')[0] ?? '',
      longDate('en-US'),
      ...Object.values(copy.appeal),
    ])
      expect(page).not.toContain(words)
  }

  const cardsShown = () =>
    within(screen.getByTestId('community-card-grid')).queryAllByRole('article').length +
    within(screen.getByTestId('community-card-grid')).queryAllByRole('img').length

  function serve(state: { banned: boolean; reads: number }) {
    const install = useMswHandlers
    install(
      http.get(FEED_PATH, () => {
        state.reads += 1
        return state.banned
          ? bannedResponse()
          : feedBody({
              items: [item()],
              authorStates: [authorState({ id: 'as-1', status: 'pending_review' })],
              activeChallenge: CHALLENGE,
            })
      }),
      http.get(SPOTLIGHT_PATH, () => (state.banned ? bannedResponse() : emptySpotlight()))
    )
  }

  it('replaces the first read with the notice, one read and no retry', async () => {
    startRetryClock()
    signIn()
    const state = { banned: true, reads: 0 }
    serve(state)
    renderGrid()
    expect(await screen.findByTestId('community-banned-notice')).toBeInTheDocument()
    await passRetryWindow(FEED_RETRY_WINDOW_MS)
    expect(state.reads).toBe(1)
    expect(cardsShown()).toBe(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(enUS.community.feed.emptyTitle)
    expect(screen.queryByRole('button', { name: /try again|retry/i })).toBeNull()
    expect(document.body.textContent).not.toContain(COMMUNITY_BANNED_MESSAGE)
  })

  it('reaches the notice ahead of the rollout message rule', async () => {
    signIn()
    useMswHandlers(
      http.get(FEED_PATH, () =>
        bannedResponse(temporary, COMMUNITY_FEED_DISABLED_MESSAGE)
      ),
      http.get(SPOTLIGHT_PATH, emptySpotlight)
    )
    renderGrid()
    expect(await screen.findByTestId('community-banned-notice')).toBeInTheDocument()
  })

  it('renders the sanction of the 403 body, permanent included', async () => {
    signIn()
    useMswHandlers(
      http.get(FEED_PATH, () =>
        bannedResponse({ ...permanent, appealStatus: 'requested' })
      ),
      http.get(SPOTLIGHT_PATH, emptySpotlight)
    )
    renderGrid()
    const shown = await screen.findByTestId('community-banned-notice')
    expect(shown).toHaveTextContent(enUS.community.banned.permanent)
    expect(shown).toHaveTextContent(enUS.community.banned.appeal.requested)
  })

  it('clears the cached cards when a later read is refused', async () => {
    signIn()
    const state = { banned: false, reads: 0 }
    serve(state)
    renderGrid()
    await screen.findByText(item().caption!)
    state.banned = true
    await userEvent.click(screen.getByTestId('community-filter-all'))
    expect(await screen.findByTestId('community-banned-notice')).toBeInTheDocument()
    expect(screen.queryByText(item().caption!)).not.toBeInTheDocument()
    expect(cardsShown()).toBe(0)
  })

  it('leaves nothing of the member feed on screen, their own posts included', async () => {
    signIn()
    const state = { banned: false, reads: 0 }
    serve(state)
    renderGrid()
    await screen.findByTestId('author-state-as-1')
    state.banned = true
    await userEvent.click(screen.getByTestId('community-filter-all'))
    await screen.findByTestId('community-banned-notice')
    expect(screen.queryByTestId('community-author-states')).not.toBeInTheDocument()
  })

  it('offers no way to take part while the notice says the member cannot', async () => {
    signIn()
    const state = { banned: false, reads: 0 }
    serve(state)
    renderGrid()
    await screen.findByTestId('create-post-button')
    expect(screen.getByTestId('weekly-challenge-banner')).toBeInTheDocument()
    state.banned = true
    await userEvent.click(screen.getByTestId('community-filter-all'))
    await screen.findByTestId('community-banned-notice')
    expect(screen.queryByTestId('create-post-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('weekly-challenge-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('challenge-participate-button')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(CHALLENGE.title)
  })

  it('closes an open dialog when the ban lands behind it', async () => {
    signIn()
    const state = { banned: false, reads: 0 }
    serve(state)
    renderGrid()
    await userEvent.click(await screen.findByTestId('create-post-button'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    state.banned = true
    fireEvent.click(screen.getByTestId('community-filter-all'))
    await screen.findByTestId('community-banned-notice')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('removes the filters and the notifications link with the feed, and reads no more', async () => {
    signIn()
    const state = { banned: true, reads: 0 }
    serve(state)
    const onBannedChange = vi.fn()
    renderGrid({ onBannedChange })
    await screen.findByTestId('community-banned-notice')
    expect(onBannedChange).toHaveBeenLastCalledWith(true)
    const reads = state.reads
    expect(screen.queryByTestId('community-filter-all')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Community notifications' })).toBeNull()
    await settle()
    expect(state.reads).toBe(reads)
  })

  it('offers no compose control when the very first read is refused', async () => {
    signIn()
    serve({ banned: true, reads: 0 })
    renderGrid()
    await screen.findByTestId('community-banned-notice')
    expect(screen.queryByTestId('create-post-button')).not.toBeInTheDocument()
  })

  it('drops the notice when a later read succeeds, since the ban has ended', async () => {
    signIn()
    const state = { banned: true, reads: 0 }
    serve(state)
    const { rerender } = renderGrid()
    await screen.findByTestId('community-banned-notice')
    state.banned = false
    rerender(<CommunityLookbookGrid showFilterNav activeTab="all" />)
    await screen.findByText(item().caption!)
    expect(queryNotice()).not.toBeInTheDocument()
  })

  describe('a change of identity while the notice shows', () => {
    const OTHER_TOKEN = 'other-member-token'
    const FEED_ERROR = enUS.community.error.load

    /**
     * Answers by bearer, as the API does.
     * The banned member is refused, the other account gets `other`, and no bearer gets a 401.
     */
    function serveAccounts(
      other: () => Response | Promise<Response> = () => feedBody({ items: [item()] })
    ) {
      const install = useMswHandlers
      install(
        http.get(FEED_PATH, ({ request }) => {
          const bearer = request.headers.get('authorization')
          if (bearer === `Bearer ${OTHER_TOKEN}`) return other()
          return bearer
            ? bannedResponse()
            : errorBody(401, 'Unauthorized', 'Unauthorized')
        }),
        http.get(SPOTLIGHT_PATH, emptySpotlight)
      )
    }

    async function showBannedMember() {
      signIn()
      const onBannedChange = vi.fn()
      renderGrid({ onBannedChange })
      await screen.findByTestId('community-banned-notice')
      expect(notice()).toHaveTextContent(longDate('en-US'))
      expect(notice()).toHaveTextContent(enUS.community.banned.appeal.not_requested)
      expect(onBannedChange).toHaveBeenLastCalledWith(true)
      return onBannedChange
    }

    const switchAccount = () =>
      act(() => {
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, OTHER_TOKEN)
        window.dispatchEvent(new Event('couture:session'))
      })

    it('takes every sanction detail with it on sign-out', async () => {
      serveAccounts()
      const onBannedChange = await showBannedMember()
      signOut()
      await settle()
      expectNoSanctionOnPage()
      expect(onBannedChange).toHaveBeenLastCalledWith(false)
    })

    it('never shows the old sanction to the next account, whose feed then loads', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (release = resolve))
      serveAccounts(async () => {
        await gate
        return feedBody({ items: [item()] })
      })
      const onBannedChange = await showBannedMember()
      switchAccount()
      // The next account's read is held, so this is what they see before any answer.
      await settle()
      expectNoSanctionOnPage()
      expect(onBannedChange).toHaveBeenLastCalledWith(false)
      act(() => release())
      await screen.findByText(item().caption!)
      expectNoSanctionOnPage()
      expect(screen.getByTestId('community-filter-all')).toBeInTheDocument()
    })

    it('shows the next account its own error and retry, with no old sanction', async () => {
      let reads = 0
      serveAccounts(() => {
        reads += 1
        return reads === 1
          ? errorBody(500, 'ECONNRESET reading community_posts', 'Internal Server Error')
          : feedBody({ items: [item()] })
      })
      const onBannedChange = await showBannedMember()
      switchAccount()
      expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(
        FEED_ERROR
      )
      expectNoSanctionOnPage()
      expect(onBannedChange).toHaveBeenLastCalledWith(false)
      await userEvent.click(screen.getByTestId('community-feed-retry-button'))
      await screen.findByText(item().caption!)
      expect(reads).toBe(2)
      expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument()
    })
  })

  describe('a realtime rebuild still out when the ban lands', () => {
    const EVENTS_PAGE = {
      data: { events: [], nextCursor: 'cursor', hasMore: false, resyncRequired: false },
    }
    const DENIED = { statusCode: 403, message: 'Denied' }

    /**
     * Runs the bootstrap catch-up itself, which the file's clock stubs away with `start`.
     * Only the socket stays out of it, and a catch-up needs no socket.
     */
    function runBootstrapOnStart() {
      vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
        this: CommunitySyncState
      ) {
        void this.catchUp()
      })
    }

    /**
     * Holds both reads of one feed generation, so the test chooses which answers first.
     * The events page waits for the direct read, so the next read is always the rebuild.
     */
    function serveBothReads({ validationDenied }: { validationDenied: boolean }) {
      const seen = {
        direct: false,
        rebuild: false,
        rebuildAnswered: false,
        validations: 0,
      }
      let releaseDirect: () => void = () => undefined
      let releaseRebuild: () => void = () => undefined
      let directArrived: () => void = () => undefined
      const directGate = new Promise<void>((resolve) => (releaseDirect = resolve))
      const rebuildGate = new Promise<void>((resolve) => (releaseRebuild = resolve))
      const directSeen = new Promise<void>((resolve) => (directArrived = resolve))
      let eventPages = 0
      const install = useMswHandlers
      install(
        http.get(FEED_PATH, async () => {
          if (!seen.direct) {
            seen.direct = true
            directArrived()
            await directGate
            return bannedResponse()
          }
          if (!seen.rebuild) {
            seen.rebuild = true
            await rebuildGate
            seen.rebuildAnswered = true
            return feedBody({ items: [item()], activeChallenge: CHALLENGE })
          }
          // The ban is real by now, so any later read is refused.
          return bannedResponse()
        }),
        http.get(SPOTLIGHT_PATH, emptySpotlight),
        http.get('/api/v1/community/events', async () => {
          eventPages += 1
          await directSeen
          return eventPages > 1 && validationDenied
            ? HttpResponse.json(DENIED, { status: 403 })
            : HttpResponse.json(EVENTS_PAGE)
        }),
        http.post('/api/v1/community/targets/resolve', async ({ request }) => {
          seen.validations += 1
          const { targets } = (await request.json()) as {
            targets: { key: string; postId: string }[]
          }
          return validationDenied
            ? HttpResponse.json(DENIED, { status: 403 })
            : HttpResponse.json({
                data: {
                  targets: targets.map((target) => ({
                    key: target.key,
                    status: 'unavailable',
                  })),
                },
              })
        })
      )
      return {
        seen,
        releaseDirect: () => act(() => releaseDirect()),
        releaseRebuild: () => act(() => releaseRebuild()),
      }
    }

    it.each<[string, boolean]>([
      ['the late page lands', false],
      ['the late page lands and target validation is then denied', true],
    ])('keeps the challenge off the page when %s', async (_label, validationDenied) => {
      signIn()
      runBootstrapOnStart()
      const reads = serveBothReads({ validationDenied })
      const onBannedChange = vi.fn()
      renderGrid({ onBannedChange })
      await waitFor(() => expect(reads.seen.rebuild).toBe(true))

      reads.releaseDirect()
      await screen.findByTestId('community-banned-notice')
      expect(screen.queryByTestId('weekly-challenge-banner')).not.toBeInTheDocument()

      reads.releaseRebuild()
      await waitFor(() => expect(reads.seen.rebuildAnswered).toBe(true))
      // The first round hands the held answer back, and the second sees what its commit started.
      await settle()
      await settle()

      expect(notice()).toHaveTextContent(longDate('en-US'))
      expect(onBannedChange).toHaveBeenLastCalledWith(true)
      expect(screen.queryByTestId('weekly-challenge-banner')).not.toBeInTheDocument()
      expect(screen.queryByTestId('challenge-participate-button')).not.toBeInTheDocument()
      expect(document.body.textContent).not.toContain(CHALLENGE.title)
      expect(screen.queryByTestId('lookbook-card-post-1')).not.toBeInTheDocument()
      expect(screen.queryByText(item().caption!)).not.toBeInTheDocument()
      expect(cardsShown()).toBe(0)
    })
  })

  describe('a denied socket control', () => {
    function captureSync() {
      const syncs: CommunitySyncState[] = []
      vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
        this: CommunitySyncState
      ) {
        syncs.push(this)
      })
      return () => syncs[0]!
    }

    function serveWithEvents(state: { banned: boolean; reads: number; denied: boolean }) {
      const install = useMswHandlers
      install(
        http.get(FEED_PATH, () => {
          state.reads += 1
          return state.banned
            ? bannedResponse()
            : feedBody({ items: [item()], activeChallenge: CHALLENGE })
        }),
        http.get(SPOTLIGHT_PATH, emptySpotlight),
        http.get('/api/v1/community/events', () =>
          state.denied
            ? HttpResponse.json({ statusCode: 403, message: 'Denied' }, { status: 403 })
            : HttpResponse.json({
                data: {
                  events: [],
                  nextCursor: 'cursor',
                  hasMore: false,
                  resyncRequired: false,
                },
              })
        )
      )
    }

    it('reaches the banned state on its next read', async () => {
      startRetryClock()
      signIn()
      const sync = captureSync()
      const state = { banned: false, reads: 0, denied: false }
      serveWithEvents(state)
      renderGrid()
      await screen.findByText(item().caption!)
      const readsBefore = state.reads
      state.banned = true
      state.denied = true
      await act(async () => {
        await sync().catchUp()
      })
      expect(await screen.findByTestId('community-banned-notice')).toBeInTheDocument()
      expect(screen.queryByText(item().caption!)).not.toBeInTheDocument()
      await passRetryWindow(FEED_RETRY_WINDOW_MS)
      expect(state.reads).toBe(readsBefore + 1)
    })

    it('takes the weekly challenge and its Participate button with it', async () => {
      signIn()
      const sync = captureSync()
      const state = { banned: false, reads: 0, denied: false }
      serveWithEvents(state)
      renderGrid()
      await screen.findByTestId('weekly-challenge-banner')
      expect(screen.getByTestId('challenge-participate-button')).toBeInTheDocument()
      state.banned = true
      state.denied = true
      await act(async () => {
        await sync().catchUp()
      })
      await screen.findByTestId('community-banned-notice')
      expect(screen.queryByTestId('weekly-challenge-banner')).not.toBeInTheDocument()
      expect(screen.queryByTestId('challenge-participate-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('create-post-button')).not.toBeInTheDocument()
      expect(document.body.textContent).not.toContain(CHALLENGE.title)
    })

    describe('a probe still out when its answer lands', () => {
      /** The denied callback's probe is the one read for a single post, and it waits for `release`. */
      async function startHeldProbe() {
        let started = 0
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => (release = resolve))
        const install = useMswHandlers
        install(
          http.get(FEED_PATH, async ({ request }) => {
            if (new URL(request.url).searchParams.get('limit') !== '1')
              return feedBody({ items: [item()] })
            started += 1
            await gate
            return bannedResponse()
          }),
          http.get(SPOTLIGHT_PATH, emptySpotlight),
          http.get('/api/v1/community/events', () =>
            HttpResponse.json({ statusCode: 403, message: 'Denied' }, { status: 403 })
          )
        )
        signIn()
        const sync = captureSync()
        const onBannedChange = vi.fn()
        renderGrid({ onBannedChange })
        await screen.findByText(item().caption!)
        await act(async () => {
          await sync().catchUp()
        })
        await waitFor(() => expect(started).toBe(1))
        return { onBannedChange, release: () => act(() => release()) }
      }

      it('shows nothing of a ban that answers after sign-out', async () => {
        const { onBannedChange, release } = await startHeldProbe()
        signOut()
        release()
        await settle()
        expectNoSanctionOnPage()
        expect(screen.getByTestId('community-live-region')).not.toHaveTextContent(
          enUS.community.error.banned
        )
        expect(onBannedChange).toHaveBeenLastCalledWith(false)
        expect(onBannedChange).not.toHaveBeenCalledWith(true)
      })

      it('still reaches the notice when the scope has not changed', async () => {
        const { onBannedChange, release } = await startHeldProbe()
        expect(queryNotice()).not.toBeInTheDocument()
        release()
        expect(await screen.findByTestId('community-banned-notice')).toBeInTheDocument()
        expect(onBannedChange).toHaveBeenLastCalledWith(true)
      })
    })

    it('shows no notice when the denial is not a ban', async () => {
      signIn()
      const sync = captureSync()
      const state = { banned: false, reads: 0, denied: false }
      serveWithEvents(state)
      renderGrid()
      await screen.findByText(item().caption!)
      const readsBefore = state.reads
      state.denied = true
      await act(async () => {
        await sync().catchUp()
      })
      await waitFor(() => expect(state.reads).toBe(readsBefore + 1))
      await settle()
      expect(queryNotice()).not.toBeInTheDocument()
      expect(screen.queryByText(item().caption!)).not.toBeInTheDocument()
    })
  })
})

describe('TEA-22: the spotlight', () => {
  const spotlightPage = (nextCursor: string | null) => ({
    data: { level: 'none', label: null, items: [], nextCursor },
  })

  function renderSpotlight(onBanned: (sanction: unknown) => void) {
    const announce = vi.fn()
    const view = renderHook(() =>
      useCommunitySpotlight({
        scope: 'member-1',
        onBanned,
        beginRead: () => 0,
        reconcile: (items) => [...items],
        announce,
      })
    )
    return { ...view, announce }
  }

  it('closes the surface when a later page is refused for a ban', async () => {
    signIn()
    let reads = 0
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, () => {
        reads += 1
        return reads === 1 ? HttpResponse.json(spotlightPage('next')) : bannedResponse()
      })
    )
    const onBanned = vi.fn()
    const { result, announce } = renderSpotlight(onBanned)
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(onBanned).not.toHaveBeenCalled()

    await act(() => result.current.loadMore())
    expect(onBanned).toHaveBeenCalledTimes(1)
    expect(onBanned).toHaveBeenCalledWith(
      expect.objectContaining({ kind: expect.any(String) as string })
    )
    expect(result.current.state.status).toBe('disabled')
    expect(result.current.state.moreFailed).toBe(false)
    expect(announce).not.toHaveBeenCalledWith({ key: 'community.spotlight.error' })
    expect(reads).toBe(2)
  })

  it('says nothing about a ban when a later page fails for another reason', async () => {
    signIn()
    let reads = 0
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, () => {
        reads += 1
        return reads === 1
          ? HttpResponse.json(spotlightPage('next'))
          : HttpResponse.error()
      })
    )
    const onBanned = vi.fn()
    const { result } = renderSpotlight(onBanned)
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await act(() => result.current.loadMore())
    expect(onBanned).not.toHaveBeenCalled()
    expect(result.current.state.moreFailed).toBe(true)
  })
})

describe('TEA-22: the home teaser', () => {
  const stubVisibility = () =>
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')

  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('reads once, shows no module and never retries a banned member', async () => {
    // The Date too, since the 60 s read floor would otherwise swallow a late re-read.
    startRetryClock({ withDate: true })
    signIn()
    stubVisibility()
    const reads: (string | null)[] = []
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        reads.push(new URL(request.url).searchParams.get('surface'))
        return bannedResponse()
      })
    )
    const { result } = renderHook(() => useHomeSpotlightTeaser({ stacked: true }))
    await waitFor(() => expect(reads).toEqual(['home_teaser']))
    await passRetryWindow(TEASER_RETRY_WINDOW_MS)
    expect(result.current.value).toBeNull()
    expect(reads).toHaveLength(1)
  })
})

describe('D14: the author state of a banned or operator-held post', () => {
  setupCommunityGridClock()
  setupCommunityGridSurface()

  beforeEach(() => signIn())

  it('renders the generic state when moderationReason is null, with no reason line', async () => {
    useMswHandlers(
      http.get(FEED_PATH, () =>
        feedBody({
          authorStates: [
            authorState({
              id: 'as-held',
              status: 'flagged',
              moderationReason: null,
              caption: 'A look taken down',
            }),
          ],
        })
      ),
      http.get(SPOTLIGHT_PATH, emptySpotlight)
    )
    renderGrid()
    expect(await screen.findByTestId('status-badge-as-held')).toHaveTextContent(
      STATUS_COPY.flagged
    )
    expect(screen.getByTestId('author-state-explanation-as-held')).toHaveTextContent(
      REMOVED_COPY.flagged
    )
    expect(screen.queryByTestId('author-state-reason-as-held')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/community_ban:|operator_takedown/)
    expect(document.body.textContent).not.toContain('Reason:')
  })
})
