import { http } from 'msw'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  POST_PATH,
  feedHandler,
  item,
  postBody,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()

describe('share-card public source actions', () => {
  setupCommunityGridSurface()

  it.each([
    ['pending_review', null, false],
    ['flagged', '2026-09-01T10:00:00.000Z', false],
    ['withdrawn', '2026-09-01T10:00:00.000Z', false],
    ['published', null, false],
    ['published', '2026-09-01T10:00:00.000Z', true],
  ] as const)(
    'M2: own deep-linked %s / %s offers export=%s in its card and detail',
    async (status, publishedAt, eligible) => {
      signIn()
      const own = item({
        id: 'own-deep-link',
        status,
        publishedAt,
        author: { isSelf: true, displayName: 'You' },
      })
      useMswHandlers(
        feedHandler({ items: [] }),
        http.get(POST_PATH, () => postBody(own))
      )
      renderGrid({ highlightedCardId: own.id })
      const card = await screen.findByTestId(`lookbook-card-${own.id}`)
      expect(within(card).queryByTestId('share-card-open') !== null).toBe(eligible)
      await userEvent.click(within(card).getByTestId(`lookbook-open-${own.id}`))
      const detail = await screen.findByTestId('community-detail')
      expect(within(detail).queryByTestId('share-card-open') !== null).toBe(eligible)
    }
  )
})
