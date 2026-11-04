// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.11 test owner: C-WEB-D-BANNED-NOTICE, the D14 author state, and the TEA-22 banned state in the grid and the teaser.
// The grid runs through the real web transport and MSW.
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_BANNED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  moderationAppealStatusSchema,
  type CommunityBannedError,
  type ModerationAppealStatus,
} from '@couture/api-client/contracts/http'
import { CommunitySyncState } from '@couture/api-client'
import { getI18n } from '../../i18n'
import deDE from '../../i18n/locales/de-DE.json'
import enUS from '../../i18n/locales/en-US.json'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  CHALLENGE,
  FEED_PATH,
  REMOVED_COPY,
  STATUS_COPY,
  authorState,
  feedBody,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import { CommunityBannedNotice } from './community-banned-notice'
import { CommunityLookbookGrid } from './community-lookbook-grid'
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
    signIn()
    const state = { banned: true, reads: 0 }
    serve(state)
    renderGrid()
    expect(await screen.findByTestId('community-banned-notice')).toBeInTheDocument()
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
    state.banned = true
    await userEvent.click(screen.getByTestId('community-filter-all'))
    await screen.findByTestId('community-banned-notice')
    expect(screen.queryByTestId('create-post-button')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(CHALLENGE.title)
  })

  it('closes the filters and the notifications link with the feed', async () => {
    signIn()
    const state = { banned: true, reads: 0 }
    serve(state)
    const onBannedChange = vi.fn()
    renderGrid({ onBannedChange })
    await screen.findByTestId('community-banned-notice')
    expect(onBannedChange).toHaveBeenLastCalledWith(true)
    const reads = state.reads
    const chip = screen.getByTestId('community-filter-all')
    expect(chip).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(chip)
    expect(state.reads).toBe(reads)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('link', { name: 'Community notifications' })).toBeNull()
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
          return state.banned ? bannedResponse() : feedBody({ items: [item()] })
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
      expect(state.reads).toBe(readsBefore + 1)
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
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })
      expect(queryNotice()).not.toBeInTheDocument()
      expect(screen.queryByText(item().caption!)).not.toBeInTheDocument()
    })
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
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
