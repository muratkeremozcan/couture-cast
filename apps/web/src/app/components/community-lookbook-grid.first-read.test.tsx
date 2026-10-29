import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMUNITY_POST_NOT_FOUND_MESSAGE } from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  POST_PATH,
  item,
  feed,
  errorBody,
  renderGrid,
  signIn,
  setupCommunityGridClock,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()

describe('Story 6.3 highlighted target while the first feed read is in flight', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    signIn()
  })

  it('6.3-WEB-024 revalidates the off-page target when a filter switch supersedes the first feed read', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hidden = false
    let first = true
    useMswHandlers(
      http.get(FEED_PATH, async () => {
        if (first) {
          first = false
          await gate
        }
        return HttpResponse.json({
          data: feed({ items: [], mode: hidden ? 'all' : 'auto' }),
        })
      }),
      http.get(POST_PATH, () =>
        hidden
          ? errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
          : HttpResponse.json({ data: { ...item() } })
      )
    )
    const user = userEvent.setup()
    renderGrid({ highlightedCardId: 'post-1' })
    // The deep link resolves on its own while the first feed read is held.
    await screen.findByTestId('lookbook-card-post-1')
    hidden = true
    await user.click(screen.getByTestId('community-filter-all'))
    release()
    await waitFor(() => expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull())
  })
})
