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
  unavailableTarget,
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
  let eventsStatus = 200
  let removed = false
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
      if (eventsStatus !== 200)
        return HttpResponse.json({ message: 'denied' }, { status: eventsStatus })
      return eventsBody([], 'cursor')
    }),
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as { targets: { key: string }[] }
      return resolveBody(
        targets.map(({ key }) =>
          removed ? unavailableTarget(key) : { ...resolvedTarget(post()), key }
        )
      )
    })
  )
  return {
    requests,
    sync: () => syncs.at(-1)!,
    changeOwner: () => {
      self = false
    },
    deny: () => {
      eventsStatus = 403
    },
    removePost: () => {
      removed = true
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

const detailDialog = () =>
  document.querySelector('[aria-labelledby="community-detail-title"]')!
const shareDialog = () => document.querySelector('[aria-labelledby="share-card-title"]')!
const reachable = (dialog: Element) =>
  !dialog.hasAttribute('inert') && dialog.getAttribute('aria-hidden') !== 'true'
// The page behind the dialogs: the app shell and any other body sibling the stack owns.
const pageIsInteractive = () =>
  document.body.style.overflow === '' &&
  [...document.body.children].every(
    (element) =>
      element.matches('[role="dialog"],script,style,link') ||
      (!element.hasAttribute('inert') && !(element as HTMLElement).inert)
  )

/**
 * The detail dialog stays logically open underneath its share dialog. Foreground
 * re-verification suspends both and resumes them in one commit, so the stack, not each
 * dialog's own snapshot of the page, decides what is reachable.
 */
describe('community share host above an open detail dialog', () => {
  setupCommunityGridSurface()
  beforeEach(async () => {
    identity.member = 'member-one'
    signIn()
    if (!globalThis.crypto.subtle)
      vi.stubGlobal('crypto', (await import('node:crypto')).webcrypto)
  })

  async function reverify(view: ReturnType<typeof useTransport>, outcome?: () => void) {
    const release = view.hold()
    outcome?.()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9000)
    let pending!: Promise<void>
    try {
      await act(async () => {
        view.sync().foreground()
        pending = view.sync().catchUp()
        await Promise.resolve()
      })
      expect(detailDialog()).not.toBeVisible()
      expect(screen.queryByRole('dialog', { name: 'Your share card' })).toBeNull()
    } finally {
      release()
      await act(() => pending)
    }
  }

  it('resumes with the share dialog reachable and the detail covered, then unwinds on Escape', async () => {
    const view = useTransport(true)
    renderGrid()
    await open('detail')
    expect(reachable(shareDialog())).toBe(true)
    expect(reachable(detailDialog())).toBe(false)
    await reverify(view)
    await screen.findByRole('dialog', { name: 'Your share card' })
    expect(reachable(shareDialog())).toBe(true)
    expect(reachable(detailDialog())).toBe(false)
    expect(document.body.style.overflow).toBe('hidden')
    expect(pageIsInteractive()).toBe(false)

    await userEvent.keyboard('{Escape}')
    expect(shareDialog()).toBeNull()
    expect(reachable(detailDialog())).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(detailDialog()).toBeNull()
    expect(pageIsInteractive()).toBe(true)
  })

  it('keeps Cancel working after resuming', async () => {
    const view = useTransport(true)
    renderGrid()
    await open('detail')
    await reverify(view)
    await screen.findByRole('dialog', { name: 'Your share card' })
    await cancel()
    expect(reachable(detailDialog())).toBe(true)
    await userEvent.click(
      within(detailDialog() as HTMLElement).getAllByRole('button', {
        name: 'Close this look',
      })[0]!
    )
    expect(detailDialog()).toBeNull()
    expect(pageIsInteractive()).toBe(true)
  })

  it('releases the page when access is denied during re-verification', async () => {
    const view = useTransport(true)
    renderGrid()
    await open('detail')
    const release = view.hold()
    view.deny()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9000)
    let pending!: Promise<void>
    try {
      await act(async () => {
        view.sync().foreground()
        pending = view.sync().catchUp()
        await Promise.resolve()
      })
    } finally {
      release()
      await act(() => pending)
    }
    await waitFor(() => expect(detailDialog()).toBeNull())
    expect(shareDialog()).toBeNull()
    expect(pageIsInteractive()).toBe(true)
  })

  it('releases the page when the owned post is removed during re-verification', async () => {
    const view = useTransport(true)
    renderGrid()
    await open('detail')
    await reverify(view, view.removePost)
    await waitFor(() => expect(detailDialog()).toBeNull())
    expect(shareDialog()).toBeNull()
    expect(pageIsInteractive()).toBe(true)
  })
})
