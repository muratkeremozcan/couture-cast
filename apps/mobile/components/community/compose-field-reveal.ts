// Story 6.7b R16 owner: keeps the focused compose field, with its label row and
// counter, inside the sheet's scroll viewport when the keyboard shrinks it.
//
// The modal's keyboard view lifts the sheet above the keyboard by shrinking it,
// so the scroll viewport loses the keyboard's height while its scroll offset
// stays where it was. A field focused near the bottom of the old viewport then
// sits below the new one, under the pinned Publish button: the member types
// into a field they cannot see. These are the measurements that decide it.
import { useEffect, useRef, useState } from 'react'
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native'

/** A rect in the scroll content's coordinates: top and bottom in points. */
export interface ContentRect {
  top: number
  bottom: number
}

export interface ScrollViewport {
  /** Current vertical scroll offset. */
  offset: number
  /** Height of the scroll view's visible frame. */
  height: number
}

/** Rounding slack, so a rect laid out on a fractional pixel still counts as in. */
const TOLERANCE = 1

/** The whole rect is inside the visible part of the scroll view. */
export function isRectInViewport(rect: ContentRect, viewport: ScrollViewport): boolean {
  if (viewport.height <= 0) return false
  return (
    rect.top >= viewport.offset - TOLERANCE &&
    rect.bottom <= viewport.offset + viewport.height + TOLERANCE
  )
}

/**
 * The offset that brings `rect` fully into view with `margin` around it, moving
 * as little as possible, or null when it is already in view. A rect taller
 * than the viewport is aligned by its top, so the label and counter stay seen.
 */
export function revealOffset(
  rect: ContentRect,
  viewport: ScrollViewport,
  margin = 8
): number | null {
  if (viewport.height <= 0) return null
  const top = Math.max(0, rect.top - margin)
  const bottom = rect.bottom + margin
  if (top >= viewport.offset && bottom <= viewport.offset + viewport.height) return null
  if (bottom - top > viewport.height || top < viewport.offset) return top
  return bottom - viewport.height
}

export type ComposeField = 'alt' | 'caption'
/** A section the sheet measures: a field, or the photo above them. */
export type ComposeSection = ComposeField | 'photo'

function sameRect(previous: ContentRect | undefined, next: ContentRect): boolean {
  return previous?.top === next.top && previous.bottom === next.bottom
}

/**
 * Wires the reveal into a scroll view and its field sections. The frame moves
 * just enough to show the whole focused section (label row, counter and field)
 * when a field gains focus, when the frame's height changes (the keyboard view
 * shrinking or growing it) and when the focused section's size changes (a
 * caption growing a line). A scroll alone never moves it: a member writing alt
 * text scrolls up to look at the photo, and the frame stays where they put it.
 */
export function useComposeFieldReveal() {
  const scrollRef = useRef<ScrollView>(null)
  // Read by the reveal, which must not re-run on scroll, and mirrored into
  // state only so the in-view marker re-renders as the member scrolls.
  const offsetRef = useRef(0)
  const [offset, setOffset] = useState(0)
  const [height, setHeight] = useState(0)
  const [rects, setRects] = useState<Partial<Record<ComposeSection, ContentRect>>>({})
  const [focused, setFocused] = useState<ComposeField | null>(null)
  const focusedRect = focused ? rects[focused] : undefined

  useEffect(() => {
    if (!focusedRect) return
    const target = revealOffset(focusedRect, { offset: offsetRef.current, height })
    if (target !== null) scrollRef.current?.scrollTo({ y: target, animated: false })
  }, [focusedRect, height])

  const scrollProps = {
    ref: scrollRef,
    scrollEventThrottle: 16,
    onLayout: (event: LayoutChangeEvent) => {
      setHeight(event.nativeEvent.layout.height)
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = event.nativeEvent.contentOffset.y
      setOffset(offsetRef.current)
    },
  }

  /** `onLayout` for a section, a direct child of the scroll content. */
  const sectionLayout = (field: ComposeSection) => (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout
    const next = { top: y, bottom: y + height }
    setRects((previous) =>
      sameRect(previous[field], next) ? previous : { ...previous, [field]: next }
    )
  }

  /** `onFocus` and `onBlur` for a field's input. */
  const fieldFocus = (field: ComposeField) => ({
    onFocus: () => setFocused(field),
    onBlur: () => setFocused((current) => (current === field ? null : current)),
  })

  const inView = (field: ComposeSection) => {
    const rect = rects[field]
    return rect !== undefined && isRectInViewport(rect, { offset, height })
  }

  return { scrollProps, sectionLayout, fieldFocus, inView }
}
