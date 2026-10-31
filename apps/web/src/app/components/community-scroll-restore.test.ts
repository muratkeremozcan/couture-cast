// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.5 R43: the scroll restore hook on its own, against a stubbed layout. jsdom has
// no layout, so every rect, scroll height and scroll position below is set by the test.
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCommunityScrollRestore } from './community-scroll-restore'

const ITEMS = [{ id: 'post-1' }, { id: 'post-2' }, { id: 'post-3' }]
const CARD_HEIGHT = 450
const CARD_GAP = 500

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * A feed grid of three cards, 500 px apart. `layout.scrolled` moves every card up, as
 * scrolling would; `layout.origin` is where the first card sits when nothing is scrolled.
 */
function feedGrid(parent: HTMLElement) {
  const layout = { scrolled: 0, origin: 0 }
  const grid = document.createElement('div')
  for (const [index, entry] of ITEMS.entries()) {
    const card = document.createElement('article')
    card.dataset.testid = `lookbook-card-${entry.id}`
    card.getBoundingClientRect = () =>
      rect(layout.origin + index * CARD_GAP - layout.scrolled, CARD_HEIGHT)
    grid.append(card)
  }
  parent.append(grid)
  return { grid, layout }
}

function renderRestore(grid: HTMLElement, scope = { current: 1 }) {
  const { result } = renderHook(() =>
    useCommunityScrollRestore({ grid: { current: grid }, scope })
  )
  return { ...result.current, scope }
}

const mounted: HTMLElement[] = []
function mount(node: HTMLElement) {
  document.body.append(node)
  mounted.push(node)
  return node
}

afterEach(() => {
  for (const node of mounted.splice(0)) node.remove()
  vi.restoreAllMocks()
})

describe('useCommunityScrollRestore (Story 6.5 R43)', () => {
  it('6.5-R43-WEB-004 restores inside the scrolling frame that holds the feed, leaving the window alone', () => {
    const windowScrollBy = vi
      .spyOn(window, 'scrollBy')
      .mockImplementation(() => undefined)
    // The mobile preview frame: it scrolls on its own, 100 px below the top of the window.
    const frame = mount(document.createElement('div'))
    frame.style.overflowY = 'auto'
    Object.defineProperty(frame, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(frame, 'clientHeight', { configurable: true, value: 600 })
    frame.getBoundingClientRect = () => rect(100, 600)
    const frameScrollBy = vi.fn()
    frame.scrollBy = frameScrollBy as typeof frame.scrollBy
    const { grid, layout } = feedGrid(frame)
    layout.origin = 100
    const { capture, restore } = renderRestore(grid)

    // post-2 is the first card still in view, 200 px of it above the frame's top edge.
    layout.scrolled = 700
    capture(ITEMS)
    // The hide shrank the frame and clamped its scroll to the top.
    layout.scrolled = 0
    restore(ITEMS)

    expect(frameScrollBy).toHaveBeenCalledExactlyOnceWith({
      top: 700,
      behavior: 'instant',
    })
    expect(windowScrollBy).not.toHaveBeenCalled()
  })

  it('6.5-R43-WEB-005 restores the captured window offset when no card was in view', () => {
    const page = { scrollY: 0 }
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => page.scrollY)
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const { grid, layout } = feedGrid(mount(document.createElement('section')))
    // The reader scrolled past every card: each one ends above the top of the window.
    layout.origin = -2000
    const { capture, restore } = renderRestore(grid)

    page.scrollY = 1500
    capture(ITEMS)
    page.scrollY = 200
    restore(ITEMS)

    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 1300, behavior: 'instant' })
  })

  it('6.5-R43-WEB-006 never scrolls when the filter or session changed while the feed was hidden', () => {
    const page = { scrollY: 0 }
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => page.scrollY)
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const { grid, layout } = feedGrid(mount(document.createElement('section')))
    const { capture, restore, scope } = renderRestore(grid)

    layout.scrolled = 700
    page.scrollY = 700
    capture(ITEMS)
    layout.scrolled = 0
    page.scrollY = 0
    scope.current = 2
    restore(ITEMS)

    expect(scrollBy).not.toHaveBeenCalled()
    // The capture is spent: a later restore under the new scope moves nothing either.
    restore(ITEMS)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
