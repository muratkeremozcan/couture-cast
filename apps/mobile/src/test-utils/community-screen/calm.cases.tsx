// Learning path Step 72: Calm Community with an empty state.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
import {
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
} from '@couture/api-client/contracts/http'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { expect, it, vi } from 'vitest'
import deDE from '@/assets/locales/de-DE.json'
import enUS from '@/assets/locales/en-US.json'
import { getCommunityPostFromMobile } from '@/src/lib/community'
import i18n from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { press } from '@/src/test-utils/press'
import { CommunityTab } from './community-tab'
import {
  CHALLENGE,
  communityGateOpen,
  feedJson,
  feedUrls,
  item,
  serveFeed,
  setMockParams,
} from './harness'

const nearby = item({
  id: 'calm-peer-nearby',
  title: 'Blue layers',
  author: { displayName: 'Style Explorer CC7150A1', isSelf: false },
  reactions: {
    counts: { applause: 1, love: 0, inspiration: 0 },
    total: 1,
    viewerReaction: null,
    revision: 0,
    generation: 0,
  },
})
const peer = item({
  id: 'calm-peer-other',
  title: 'Rain shell',
  author: { displayName: 'Style Explorer CC7150B2', isSelf: false },
  reactions: nearby.reactions,
})

function serveSpotlight(spotlight: CommunityReactionSpotlight) {
  const body = communityReactionSpotlightResponseSchema.parse({ data: spotlight })
  server.use(http.get('*/api/v1/community/spotlight', () => HttpResponse.json(body)))
}

export function registerCalmCommunityCases() {
  it('7.15-COM-001/002 renders a ranked peer once and opens its detail in one press', async () => {
    serveFeed(() => feedJson({ items: [peer, nearby], activeChallenge: CHALLENGE }))
    serveSpotlight({
      level: 'city',
      label: 'Lisbon',
      items: [{ ...nearby, rank: 1 }],
      nextCursor: null,
    })
    await render(<CommunityTab />)
    await communityGateOpen()

    const post = screen.getByTestId('community-new-post-button')
    const climate = screen.getByTestId('community-climate-filter')
    const challenge = screen.getByTestId('community-challenge-banner')
    const ranked = screen.getByTestId(`community-spotlight-item-${nearby.id}`)
    const ordinary = screen.getByTestId(`community-post-card-${peer.id}`)
    expect(post).toHaveAccessibleName(enUS.community.calm.post)
    expect(climate).toBeVisible()
    expect(challenge).toHaveTextContent(CHALLENGE.title)
    expect(ranked).toHaveTextContent(enUS.community.calm.nearYou)
    expect(ordinary).not.toHaveTextContent(enUS.community.calm.nearYou)
    expect(screen.getAllByTestId(`community-post-card-${nearby.id}`)).toHaveLength(1)
    expect(
      ranked.compareDocumentPosition(ordinary) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      within(ranked).getByTestId(`community-card-title-${nearby.id}`)
    ).toHaveTextContent(nearby.title!)
    expect(
      within(ranked).getByTestId(`community-card-author-${nearby.id}`)
    ).toHaveTextContent(nearby.author.displayName)
    expect(within(ranked).getByTestId(`community-card-image-${nearby.id}`)).toBeVisible()
    expect(
      within(ranked).getAllByTestId(`community-reactions-${nearby.id}`)
    ).toHaveLength(1)

    press(within(challenge).getByTestId('community-challenge-dismiss'))
    expect(screen.queryByTestId('community-challenge-banner')).toBeNull()
    expect(ranked).toBeVisible()

    press(within(ranked).getByTestId(`community-card-open-${nearby.id}`))
    const detail = await screen.findByTestId('community-spotlight-detail')
    expect(within(detail).getByTestId('app-top-bar-title')).toHaveTextContent(
      'Blue layers'
    )
    expect(within(detail).getByTestId('community-spotlight-detail-rank')).toBeVisible()
  })

  it('7.15-COM-004/005 the localized zero-look action loads both approved peers', async () => {
    await i18n.changeLanguage('de-DE')
    serveFeed((url) => {
      const all = url.searchParams.get('mode') === 'all'
      return feedJson({
        mode: all ? 'all' : 'auto',
        viewerBand: 'cold_dry',
        items: all ? [nearby, peer] : [],
      })
    })
    serveSpotlight({ level: 'none', label: null, items: [], nextCursor: null })
    await render(<CommunityTab />)
    await communityGateOpen()

    const empty = await screen.findByTestId('community-feed-empty')
    expect(empty).toHaveTextContent(deDE.community.calm.climateEmpty)
    expect(within(empty).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryAllByTestId(/^community-post-card-calm-peer-/)).toHaveLength(0)
    press(within(empty).getByRole('button', { name: deDE.community.calm.seeAllClimates }))
    await screen.findByTestId(`community-post-card-${nearby.id}`)
    await screen.findByTestId(`community-post-card-${peer.id}`)
    expect(feedUrls.at(-1)?.searchParams.get('mode')).toBe('all')
    expect(screen.queryByTestId('community-feed-empty')).toBeNull()
  })

  it('7.15-COM-003 a peer More action offers Report without opening the detail', async () => {
    await render(<CommunityTab />)
    await communityGateOpen()
    const card = await screen.findByTestId('community-post-card-post-a')
    expect(within(card).queryByTestId('community-reactions-post-a')).toBeNull()
    expect(screen.queryByTestId('community-card-report-post-a')).toBeNull()
    press(within(card).getByTestId('community-card-actions'))
    const report = await screen.findByTestId('community-card-report-post-a')
    expect(screen.queryByTestId('community-post-detail')).toBeNull()
    expect(screen.queryByTestId('community-card-withdraw-post-a')).toBeNull()
    press(report)
    await waitFor(() =>
      expect(screen.getByTestId('community-report-modal')).toBeVisible()
    )
  })

  it('7.15-COM-003 an own look withdraws immediately and leaves a visible notice', async () => {
    const own = item({ id: 'calm-own', author: { displayName: 'You', isSelf: true } })
    const withdrawnPosts: string[] = []
    serveFeed(() => feedJson({ items: withdrawnPosts.length ? [] : [own] }))
    server.use(
      http.post('*/api/v1/community/posts/:postId/withdraw', ({ params }) => {
        withdrawnPosts.push(String(params.postId))
        return HttpResponse.json({ tracked: true })
      })
    )
    await render(<CommunityTab />)
    await communityGateOpen()
    const card = await screen.findByTestId('community-post-card-calm-own')
    press(within(card).getByTestId('community-card-actions'))
    const withdraw = await screen.findByTestId('community-card-withdraw-calm-own')
    expect(screen.queryByTestId('community-card-report-calm-own')).toBeNull()
    press(withdraw)
    await waitFor(() => expect(withdrawnPosts).toEqual(['calm-own']))
    expect(await screen.findByTestId('deep-link-info-banner')).toHaveTextContent(
      enUS.community.removed.withdrawn
    )
    await waitFor(() => expect(card).not.toBeInTheDocument())
  })

  it('focuses an early notification result once its card title mounts', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const handles = new Map<unknown, number>()
    vi.mocked(findNodeHandle).mockImplementation((node) => {
      if (!handles.has(node)) handles.set(node, 700 + handles.size)
      return handles.get(node) ?? null
    })
    let releaseFeed!: (response: Response) => void
    const heldFeed = new Promise<Response>((resolve) => {
      releaseFeed = resolve
    })
    let markDetailServed!: () => void
    const detailServed = new Promise<void>((resolve) => {
      markDetailServed = resolve
    })
    setMockParams({ source: 'notification', type: 'community', cardId: nearby.id })
    serveFeed(() => heldFeed)
    server.use(
      http.get('*/api/v1/community/posts/' + nearby.id, () => {
        markDetailServed()
        return HttpResponse.json({ data: nearby })
      })
    )
    try {
      await render(<CommunityTab />)
      await detailServed
      const request = vi.mocked(getCommunityPostFromMobile).mock.results.at(-1)
      expect(request?.type).toBe('return')
      await act(async () => {
        await request?.value
      })
      expect(screen.queryByTestId('community-card-title-' + nearby.id)).toBeNull()
    } finally {
      releaseFeed(feedJson({ items: [] }))
    }
    const title = await screen.findByTestId('community-card-title-' + nearby.id)
    await waitFor(() => {
      expect(handles.get(title)).toBeTypeOf('number')
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(title)
      )
    })
  })
}
