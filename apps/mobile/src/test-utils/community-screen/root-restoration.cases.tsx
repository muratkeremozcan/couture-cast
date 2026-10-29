import React, { useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Platform } from 'react-native'
import { http, HttpResponse } from 'msw'
import {
  communityReactionSpotlightResponseSchema,
  COMMUNITY_FEED_DISABLED_MESSAGE,
} from '@couture/api-client/contracts/http'
import {
  AndroidShareCardPresentation,
  useAndroidNavigationIntent,
} from '@/components/android-share-card-presentation'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { setMobileApplicationUserId } from '@/src/lib/mobile-auth'
import { androidNavigationSnapshot } from '@/src/lib/android-navigation-restoration'
import { server } from '@/src/test-utils/msw/server'
import { item, serveFeed, feedJson } from './harness'
import { press } from '@/src/test-utils/press'
import { trackJsonBodies } from '@/src/test-utils/late-response'
function Home({ navigate }: { navigate: () => void }) {
  const intent = useAndroidNavigationIntent()
  return (
    <button
      data-testid="restoration-home"
      onClick={() => {
        intent('/')
        navigate()
      }}
    >
      Home
    </button>
  )
}
function Harness({ initialPath = '/community' }: { initialPath?: string }) {
  const [path, setPath] = useState(initialPath)
  return (
    <AndroidShareCardPresentation
      pathname={path}
      navigationReady
      onRestoreRoute={setPath}
    >
      <Home navigate={() => setPath('/')} />
      {path === '/community' && <CommunityScreen />}
    </AndroidShareCardPresentation>
  )
}
function page(caption = 'Original before font', missing = false) {
  return HttpResponse.json(
    communityReactionSpotlightResponseSchema.parse({
      data: {
        level: 'city',
        label: 'Lisbon',
        items: missing
          ? []
          : [
              {
                ...item({ id: 'restored-spot', caption }),
                rank: 1,
                reactions: {
                  counts: { applause: 1, love: 0, inspiration: 0 },
                  total: 1,
                  viewerReaction: null,
                  revision: 0,
                  generation: 1,
                },
              },
            ],
        nextCursor: null,
      },
    })
  )
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
async function open() {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
  act(() => setMobileApplicationUserId('root-member-a'))
  server.use(http.get('*/api/v1/community/spotlight', () => page()))
  const view = render(<Harness />)
  const entry = await screen.findByTestId('community-spotlight-item-restored-spot')
  press(within(entry).getByTestId('community-card-open-restored-spot'))
  await screen.findByTestId('community-spotlight-detail-title')
  return view
}
export function registerCommunityRootRestorationCases() {
  it('Android null-member token session opens Spotlight detail through the real screen', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    act(() => setMobileApplicationUserId(null))
    server.use(http.get('*/api/v1/community/spotlight', () => page()))
    render(<Harness />)
    const entry = await screen.findByTestId('community-spotlight-item-restored-spot')
    press(within(entry).getByTestId('community-card-open-restored-spot'))
    const title = await screen.findByTestId('community-spotlight-detail-title')
    expect(title).toBeVisible()
    expect(screen.getByTestId('community-spotlight-detail')).toHaveTextContent(
      'Original before font'
    )
    press(screen.getByTestId('community-spotlight-detail-close'))
    await waitFor(() =>
      expect(
        screen.queryByTestId('community-spotlight-detail-title')
      ).not.toBeInTheDocument()
    )
    expect(androidNavigationSnapshot().checkpoint).toBeNull()
  })
  it('Android null-member token session opens its own community share-card composer', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    act(() => setMobileApplicationUserId(null))
    serveFeed(() =>
      feedJson({ items: [item({ author: { displayName: 'Own look', isSelf: true } })] })
    )
    render(<Harness />)
    const opener = await screen.findByTestId('community-share-card-open-post-a')
    press(opener)
    expect(await screen.findByTestId('share-card-title')).toBeVisible()
    press(screen.getByTestId('share-card-cancel'))
    await waitFor(() =>
      expect(screen.queryByTestId('share-card-title')).not.toBeInTheDocument()
    )
    expect(androidNavigationSnapshot().checkpoint).toBeNull()
  })
  it('Android root restores detail only after fresh Spotlight membership and preserves explicit Cancel', async () => {
    let opened = 0
    server.use(
      http.post('*/api/v1/community/posts/:postId/opened', () => {
        opened++
        return HttpResponse.json({ tracked: true })
      })
    )
    const old = await open()
    await waitFor(() => expect(opened).toBe(1))
    old.unmount()
    const held = deferred()
    let entered = false
    server.use(
      http.get('*/api/v1/community/spotlight', async () => {
        entered = true
        await held.promise
        return page('Fresh authorized Spotlight')
      })
    )
    const fresh = render(<Harness initialPath="/" />)
    try {
      await waitFor(() => expect(entered).toBe(true))
      expect(
        screen.queryByTestId('community-spotlight-detail-title')
      ).not.toBeInTheDocument()
      expect(androidNavigationSnapshot().checkpoint).toEqual({
        member: 'root-member-a',
        path: '/community',
        detailId: 'restored-spot',
      })
      await act(async () => {
        held.resolve()
        await held.promise
      })
      const detail = await screen.findByTestId('community-spotlight-detail')
      await waitFor(() =>
        expect(within(detail).getByText('Fresh authorized Spotlight')).toBeVisible()
      )
      expect(opened).toBe(1)
      press(screen.getByTestId('community-spotlight-detail-close'))
      await waitFor(() =>
        expect(androidNavigationSnapshot().checkpoint?.detailId).toBeNull()
      )
      fresh.unmount()
      render(<Harness initialPath="/" />)
      await screen.findByTestId('community-spotlight-item-restored-spot')
      expect(
        screen.queryByTestId('community-spotlight-detail-title')
      ).not.toBeInTheDocument()
    } finally {
      held.resolve()
      act(() => setMobileApplicationUserId(null))
    }
  })
  it.each(['missing', 'denied'])(
    'Android root refuses a %s detail after fresh eligibility',
    async (reason) => {
      const old = await open()
      old.unmount()
      server.use(
        http.get('*/api/v1/community/spotlight', () =>
          reason === 'missing'
            ? page('Absent', true)
            : HttpResponse.json(
                {
                  statusCode: 403,
                  code: 'denied',
                  message: COMMUNITY_FEED_DISABLED_MESSAGE,
                },
                { status: 403 }
              )
        )
      )
      render(<Harness initialPath="/" />)
      try {
        await waitFor(() =>
          expect(androidNavigationSnapshot().checkpoint?.detailId).toBeNull()
        )
        expect(
          screen.queryByTestId('community-spotlight-detail-title')
        ).not.toBeInTheDocument()
      } finally {
        act(() => setMobileApplicationUserId(null))
      }
    }
  )
  it('Android root member change defeats held fresh detail and navigation retires the visit', async () => {
    const old = await open()
    old.unmount()
    const held = deferred()
    let entered = false
    server.use(
      http.get('*/api/v1/community/spotlight', async () => {
        entered = true
        await held.promise
        return page('Late prior member')
      })
    )
    render(<Harness initialPath="/" />)
    try {
      await waitFor(() => expect(entered).toBe(true))
      act(() => setMobileApplicationUserId(null))
      const late = trackJsonBodies('/api/v1/community/spotlight')
      held.resolve()
      await late.settled()
      expect(
        screen.queryByTestId('community-spotlight-detail-title')
      ).not.toBeInTheDocument()
      act(() => setMobileApplicationUserId('root-member-b'))
      await screen.findByTestId('community-spotlight-item-restored-spot')
      expect(
        screen.queryByTestId('community-spotlight-detail-title')
      ).not.toBeInTheDocument()
      press(
        within(screen.getByTestId('community-spotlight-item-restored-spot')).getByTestId(
          'community-card-open-restored-spot'
        )
      )
      await screen.findByTestId('community-spotlight-detail-title')
      press(screen.getByTestId('restoration-home'))
      expect(androidNavigationSnapshot().checkpoint).toEqual({
        member: 'root-member-b',
        path: '/',
        detailId: null,
      })
      expect(
        screen.queryByTestId('community-spotlight-detail-title')
      ).not.toBeInTheDocument()
    } finally {
      held.resolve()
      act(() => setMobileApplicationUserId(null))
    }
  })
}
