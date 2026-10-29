// React reports a missing list key once per module, so this check lives in a file of its own:
// in a file with other grid tests, an earlier one would use the warning up and this one could
// never fail.
import { http } from 'msw'
import { screen, waitFor } from '@testing-library/react'
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

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunityLookbookGrid React warnings (Story 6.1)', () => {
  setupCommunityGridSurface()

  it('6.1-WEB-073 renders the live region without React warnings', async () => {
    signIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useMswHandlers(
      feedHandler({ items: [item(), item({ id: 'post-2' })] }),
      http.get(POST_PATH, () => postBody({ id: 'post-2' }))
    )
    renderGrid({ highlightedCardId: 'post-2' })
    await screen.findByTestId('lookbook-card-post-1')
    await waitFor(() => expect(screen.getByTestId('lookbook-card-post-2')).toHaveFocus())
    await waitFor(() =>
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Focused on the highlighted look.'
      )
    )
    // Every list the grid renders needs a stable key, the announcement list included.
    expect(
      errors.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .filter((text) => /key/i.test(text))
    ).toEqual([])
  })
})
