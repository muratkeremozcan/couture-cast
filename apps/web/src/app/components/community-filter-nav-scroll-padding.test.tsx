// Story CC-7.9 (CI 48c7a01e, community-reactions at 1280x720): the stuck filter nav covered the
// top half of a focused reaction button and its ring. WCAG 2.4.11 (technique C43): the page's
// scroll padding follows the sticky stack, so a focus scroll never leaves a control under it.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LookbookFilterNav } from './community-lookbook-grid'

/** The nav's box as the browser would report it for the next layout read. */
function placeNav(nav: HTMLElement, top: number, height: number) {
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 1280,
    width: 1280,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })
}

const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

const scrollPadding = () => document.documentElement.style.scrollPaddingTop

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LookbookFilterNav sticky stack scroll padding', () => {
  it('7.9-CMP-STICKY-001 pads the page by the stuck nav so a focused reaction is never under it', async () => {
    const view = render(
      <LookbookFilterNav activeTab="all" onTabChange={vi.fn()} stickyTop={77} />
    )
    const nav = view.container.querySelector('nav')!

    // Above the community section the nav sits lower down, so only Home's chip bar covers the top.
    placeNav(nav, 900, 283)
    window.dispatchEvent(new Event('scroll'))
    await frame()
    expect(scrollPadding()).toBe('77px')

    // Stuck under the chip bar it reaches 360 px down, the band that hid the applause button.
    placeNav(nav, 77, 283)
    window.dispatchEvent(new Event('scroll'))
    await frame()
    expect(scrollPadding()).toBe('360px')

    // The padding leaves with the nav.
    view.unmount()
    expect(scrollPadding()).toBe('')
  })

  it('7.9-CMP-STICKY-002 leaves the page unpadded for a banned member, whose nav is gone', () => {
    render(
      <LookbookFilterNav activeTab="all" onTabChange={vi.fn()} stickyTop={77} closed />
    )
    expect(scrollPadding()).toBe('')
  })
})
