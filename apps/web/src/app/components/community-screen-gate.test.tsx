// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D3 test owner: the Community screen gate waits for the first feed page and the
// City Spotlight above it, so neither lands after the body appeared and moves the other. A
// Spotlight that fails is part of what the body shows at reveal, never hidden by the gate.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-007). The measured budget is 7.7-E2E-001.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  feedBody,
  item,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  ranked,
  spotlightBody,
} from '../../test-utils/community-spotlight'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { CommunityLookbookGrid } from './community-lookbook-grid'
import { ScreenGate } from './screen-gate'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

setupCommunityGridClock()

/** Feed and Spotlight reads held until the test answers each. */
function useHeldReads() {
  const feed = Promise.withResolvers<void>()
  const spotlight = Promise.withResolvers<'ok' | 'fail'>()
  useMswHandlers(
    http.get(FEED_PATH, async () => {
      await feed.promise
      return feedBody({ items: [item({ id: 'post-1' })] })
    }),
    http.get(SPOTLIGHT_PATH, async () => {
      const outcome = await spotlight.promise
      return outcome === 'ok'
        ? spotlightBody({ items: [ranked(1)] })
        : HttpResponse.json({ message: 'Unavailable' }, { status: 503 })
    })
  )
  return { feed, spotlight }
}

function renderCommunity() {
  return render(
    <ScreenGate screen="community" reads={['feed', 'spotlight']}>
      <CommunityLookbookGrid showFilterNav returnPath="/community" />
    </ScreenGate>
  )
}

describe('7.7 Community screen gate', () => {
  setupCommunityGridSurface()

  afterEach(() => {
    document.documentElement.removeAttribute('data-session')
    screenSnapshot.clear()
  })

  it('7.7-CMP-007 waits for the first feed page and the Spotlight before the body appears', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    renderCommunity()

    const gate = screen.getByTestId('screen-gate')
    expect(gate).toHaveAttribute('data-screen', 'community')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()

    await act(async () => {
      reads.feed.resolve()
      await reads.feed.promise
    })
    expect(await screen.findByTestId('lookbook-card-post-1')).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')

    await act(async () => {
      reads.spotlight.resolve('ok')
      await reads.spotlight.promise
    })
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    // Both are in place at reveal: the Spotlight row above the feed, no skeleton in between.
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeVisible()
    expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    expect(screen.queryByTestId('lookbook-card-skeleton')).toBeNull()
    expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
  })

  it('7.7-CMP-007 a failed Spotlight opens the gate with its error and Retry inside the body', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    renderCommunity()

    await act(async () => {
      reads.feed.resolve()
      reads.spotlight.resolve('fail')
      await Promise.all([reads.feed.promise, reads.spotlight.promise])
    })

    const gate = screen.getByTestId('screen-gate')
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(await screen.findByTestId('community-spotlight-error')).toBeVisible()
    expect(screen.getByTestId('community-spotlight-retry-button')).toBeVisible()
    expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    expect(gate.contains(screen.getByTestId('community-spotlight-error'))).toBe(true)
  })

  it('7.7-CMP-007 stays closed while the first feed page is unanswered and the Spotlight is in, then opens', async () => {
    document.documentElement.setAttribute('data-session', 'member')
    signIn()
    const reads = useHeldReads()
    renderCommunity()
    const gate = screen.getByTestId('screen-gate')

    await act(async () => {
      reads.spotlight.resolve('ok')
      await reads.spotlight.promise
    })
    expect(await screen.findByTestId('spotlight-lookbook-card-spot-1')).not.toBeVisible()
    expect(gate).not.toHaveAttribute('data-ready')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()

    await act(async () => {
      reads.feed.resolve()
      await reads.feed.promise
    })
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('lookbook-card-post-1')).toBeVisible()
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeVisible()
    expect(screen.queryByTestId('lookbook-card-skeleton')).toBeNull()
  })
})
