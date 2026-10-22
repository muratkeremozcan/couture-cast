// Story 6.5 (R43): content that hides as unverified (D3) unmounts, so the page shrinks and
// the reader's place in the feed is lost. Capturing the card at the top of the view before
// the hide lets the same items return where the reader left them.
import { useCallback, useRef, type RefObject } from 'react'

type HiddenFeed = {
  scope: number
  ids: readonly string[]
  /** The element that scrolls the feed, or null when the window does. */
  scroller: HTMLElement | null
  /** The first card still in view, and its distance from the top of the scroller. */
  anchor: { id: string; top: number } | null
  offset: number
}

/** The nearest scrolling ancestor, such as the mobile preview frame, or null for the window. */
function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (
    let parent = node.parentElement;
    parent && parent !== document.body && parent !== document.documentElement;
    parent = parent.parentElement
  ) {
    const { overflowY } = window.getComputedStyle(parent)
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent
  }
  return null
}

function viewTop(scroller: HTMLElement | null) {
  return scroller ? scroller.getBoundingClientRect().top : 0
}

export function useCommunityScrollRestore({
  grid,
  scope,
}: {
  /** The feed grid; its children are the rendered cards, in item order. */
  grid: RefObject<HTMLElement | null>
  /** Advances whenever the feed's filter or session changes. */
  scope: RefObject<number>
}) {
  const hiddenRef = useRef<HiddenFeed | null>(null)

  /** Call just before verified content hides, while its cards are still mounted. */
  const capture = useCallback(
    (items: readonly { id: string }[]) => {
      const node = grid.current
      if (hiddenRef.current || !node || !items.length) return
      const scroller = scrollerOf(node)
      const top = viewTop(scroller)
      const cards = Array.from(node.children)
      const index = cards.findIndex((card) => card.getBoundingClientRect().bottom > top)
      const anchor = index >= 0 ? items[index] : undefined
      hiddenRef.current = {
        scope: scope.current,
        ids: items.map((item) => item.id),
        scroller,
        anchor: anchor
          ? { id: anchor.id, top: cards[index]!.getBoundingClientRect().top - top }
          : null,
        offset: scroller ? scroller.scrollTop : window.scrollY,
      }
    },
    [grid, scope]
  )

  /** Call once verified items render again; it scrolls only if they include what hid. */
  const restore = useCallback(
    (items: readonly { id: string }[]) => {
      const hidden = hiddenRef.current
      const node = grid.current
      if (!hidden || !node || !items.length) return
      hiddenRef.current = null
      const ids = new Set(items.map((item) => item.id))
      if (hidden.scope !== scope.current || !hidden.ids.every((id) => ids.has(id))) return
      const { scroller, anchor } = hidden
      let delta: number
      if (anchor) {
        const card = node.children[items.findIndex((item) => item.id === anchor.id)]
        if (!card) return
        delta = card.getBoundingClientRect().top - viewTop(scroller) - anchor.top
      } else {
        delta = hidden.offset - (scroller ? scroller.scrollTop : window.scrollY)
      }
      if (Math.abs(delta) < 1) return
      // An instant jump: nothing animates, whatever the reader's motion preference, and
      // scrolling leaves focus where it is.
      const target: HTMLElement | Window = scroller ?? window
      target.scrollBy({ top: delta, behavior: 'instant' })
    },
    [grid, scope]
  )

  return { capture, restore }
}
