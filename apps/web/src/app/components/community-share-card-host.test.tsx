import { CommunitySyncState } from '@couture/api-client'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  ZERO,
  eventsBody,
  ranked,
  reactionFeedBody,
  resolveBody,
  resolvedTarget,
  spotlightBody,
} from '../../test-utils/community-spotlight'
import type * as WebSession from '../../lib/web-session'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'

const identity = vi.hoisted(() => ({ member: 'member-one' as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => identity.member,
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()

const own = () => ({
  ...item({
    id: 'spot-self',
    author: { displayName: 'You', isSelf: true },
  }),
  reactions: ZERO,
})
const opener = (surface: 'feed' | 'spotlight' | 'detail') =>
  within(
    screen.getByTestId(
      surface === 'detail'
        ? 'community-detail'
        : `${surface === 'spotlight' ? 'spotlight-' : ''}lookbook-card-spot-self`
    )
  ).getByTestId('share-card-open')

function useTransport(duplicate = false) {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const requests: { watermark: boolean; source: { postId: string } }[] = []
  let release: (() => void) | undefined
  let held: Promise<void> | undefined
  let self = true
  const post = () => ({ ...own(), author: { displayName: 'Member', isSelf: self } })
  useMswHandlers(
    http.get(FEED_PATH, () => reactionFeedBody(duplicate ? [post()] : [])),
    http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1, post())] })),
    http.post('/api/v1/community/posts/:postId/opened', () =>
      HttpResponse.json({ tracked: true })
    ),
    http.post('/api/v1/share-cards/prepare', async ({ request }) => {
      const body = (await request.json()) as (typeof requests)[number]
      requests.push(body)
      return HttpResponse.json({
        data: {
          ...preparedShareCardFixture,
          accessibilityLabel: body.watermark
            ? 'Watermark on preview'
            : 'Watermark off preview',
        },
      })
    }),
    http.get('/api/v1/community/events', async () => {
      if (held) await held
      return eventsBody([], 'cursor')
    }),
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as { targets: { key: string }[] }
      return resolveBody(targets.map(({ key }) => ({ ...resolvedTarget(post()), key })))
    })
  )
  return {
    requests,
    sync: () => syncs.at(-1)!,
    changeOwner: () => {
      self = false
    },
    hold: () => {
      held = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        held = undefined
        release?.()
      }
    },
  }
}

async function open(surface: 'feed' | 'spotlight' | 'detail' = 'spotlight') {
  await screen.findByTestId(
    `${surface === 'spotlight' ? 'spotlight-' : ''}lookbook-card-spot-self`
  )
  if (surface === 'detail') {
    await userEvent.click(screen.getByTestId('lookbook-open-spot-self'))
    await screen.findByTestId('community-detail')
  }
  const button = opener(surface)
  await userEvent.click(button)
  await screen.findByRole('dialog', { name: 'Your share card' })
  const image = await screen.findByTestId('share-card-preview')
  fireEvent.load(image)
  return { button, image }
}

async function cancel() {
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.queryByRole('dialog', { name: 'Your share card' })
  ).not.toBeInTheDocument()
}

describe('community share host across card surfaces', () => {
  setupCommunityGridSurface()
  beforeEach(async () => {
    identity.member = 'member-one'
    signIn()
    if (!globalThis.crypto.subtle)
      vi.stubGlobal('crypto', (await import('node:crypto')).webcrypto)
  })

  it('opens and prepares an own published spotlight post absent from the feed', async () => {
    const view = useTransport()
    renderGrid()
    await open()
    expect(screen.queryByTestId('lookbook-card-spot-self')).not.toBeInTheDocument()
    expect(view.requests).toEqual([
      expect.objectContaining({
        source: { kind: 'community_post', postId: 'spot-self' },
      }),
    ])
    expect(screen.getByTestId('share-card-save')).toBeEnabled()
  })

  it.each(['spotlight', 'feed', 'detail'] as const)(
    'returns focus to the invoking %s copy when a post appears twice',
    async (surface) => {
      useTransport(true)
      renderGrid()
      await screen.findByTestId('lookbook-card-spot-self')
      await screen.findByTestId('spotlight-lookbook-card-spot-self')
      const { button } = await open(surface)
      await userEvent.click(screen.getByRole('checkbox', { name: 'Show watermark' }))
      await cancel()
      expect(button).toHaveFocus()
    }
  )

  it.each(['spotlight', 'feed'] as const)(
    'retains composition through re-verification and restores the remounted %s invoker',
    async (surface) => {
      const view = useTransport(true)
      renderGrid()
      await screen.findByTestId('spotlight-lookbook-card-spot-self')
      await act(() => view.sync().catchUp())
      const { button } = await open(surface)
      await userEvent.click(screen.getByRole('checkbox', { name: 'Show watermark' }))
      await waitFor(() => expect(view.requests).toHaveLength(2))
      const offPreview = await screen.findByRole('img', { name: 'Watermark off preview' })
      fireEvent.load(offPreview)
      expect(screen.getByTestId('share-card-save')).toBeEnabled()
      const before = offPreview.getAttribute('src')
      const release = view.hold()
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9000)
      let pending!: Promise<void>
      try {
        await act(async () => {
          view.sync().foreground()
          pending = view.sync().catchUp()
          await Promise.resolve()
        })
        expect(
          screen.queryByRole('dialog', { name: 'Your share card' })
        ).not.toBeInTheDocument()
        expect(button.isConnected).toBe(false)
      } finally {
        release()
        await act(() => pending)
      }
      await screen.findByRole('dialog', { name: 'Your share card' })
      expect(screen.getByRole('checkbox', { name: 'Show watermark' })).not.toBeChecked()
      expect(screen.getByRole('img', { name: 'Watermark off preview' })).toHaveAttribute(
        'src',
        before
      )
      expect(view.requests).toHaveLength(2)
      const restored = opener(surface)
      expect(restored).not.toBe(button)
      await cancel()
      expect(restored).toHaveFocus()
    }
  )

  it.each(['signed-out', 'other-member'] as const)(
    'removes a spotlight composition when identity changes to %s',
    async (mode) => {
      const view = useTransport()
      renderGrid()
      await open()
      view.changeOwner()
      act(() => {
        identity.member = mode === 'signed-out' ? null : 'member-two'
        if (mode === 'signed-out')
          window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
        else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'other-token')
        window.dispatchEvent(new Event('couture:session'))
      })
      expect(screen.queryByTestId('share-card-preview')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('dialog', { name: 'Your share card' })
      ).not.toBeInTheDocument()
      if (mode === 'other-member') {
        const card = await screen.findByTestId('spotlight-lookbook-card-spot-self')
        expect(within(card).queryByTestId('share-card-open')).not.toBeInTheDocument()
      }
      expect(view.requests).toHaveLength(1)
    }
  )
})
