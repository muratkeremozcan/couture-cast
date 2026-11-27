// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-COMM-001 (Community's first content marker is the City
// Spotlight section, P5, AC2) and
// 7.11-CMP-COMM-002..003 (post detail as a full-height layer that closes from its back arrow and
// from browser back, D12, D13). The browser journey is 7.11-E2E-04x.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  feedHandler,
  item,
  renderGrid,
  setupCommunityGridClock,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()

describe('7.11 Community first content and post detail layer', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    signIn()
  })

  it('7.11-CMP-COMM-001 marks the first displayed card photo', async () => {
    useMswHandlers(feedHandler({ items: [item(), item({ id: 'post-2' })] }))
    renderGrid()
    await screen.findByTestId('lookbook-card-post-2')

    const first = screen.getByTestId('lookbook-card-post-1')
    const marker = screen.getByTestId('community-first-content')
    expect(first).toContainElement(marker)
    expect(within(marker).getByRole('img')).toBeVisible()
  })

  it('7.11-CMP-COMM-001 marks the empty title when the feed has no cards', async () => {
    useMswHandlers(feedHandler({ items: [], mode: 'all' }))
    renderGrid()

    expect(await screen.findByTestId('community-first-content')).toHaveTextContent(
      'No looks shared here yet'
    )
  })

  it('7.11-CMP-COMM-002 opens a post as a full-height layer whose back arrow closes it and returns focus', async () => {
    useMswHandlers(feedHandler({ items: [item({ title: 'Wool over merino' })] }))
    const user = userEvent.setup()
    renderGrid()
    const opener = await screen.findByTestId('lookbook-open-post-1')
    await user.click(opener)

    const dialog = await screen.findByRole('dialog', { name: 'Wool over merino' })
    expect(dialog).toHaveAttribute('data-presentation', 'screen')
    const handle = within(dialog).getByTestId('layer-swipe-handle')
    expect(within(handle).getByTestId('app-top-bar-title')).toHaveTextContent(
      'Wool over merino'
    )
    const back = within(handle).getByTestId('app-top-bar-back')
    expect(back).toHaveAccessibleName('Back')
    expect(back).toHaveFocus()

    await user.click(back)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('lookbook-open-post-1')).toHaveFocus()
  })

  it('7.11-CMP-COMM-003 browser back closes the post layer with the URL unchanged', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    useMswHandlers(feedHandler({ items: [item({ title: 'Wool over merino' })] }))
    const user = userEvent.setup()
    const href = window.location.href
    renderGrid()
    await user.click(await screen.findByTestId('lookbook-open-post-1'))
    await screen.findByRole('dialog', { name: 'Wool over merino' })
    // The layer's entry lands once any back step an earlier case started has landed.
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))

    const popped = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true })
    })
    act(() => window.history.back())
    await act(async () => {
      await popped
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.href).toBe(href)
    expect(screen.getByTestId('lookbook-open-post-1')).toHaveFocus()
  })
})
