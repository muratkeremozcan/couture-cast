import type { Locator } from '@playwright/test'
import { expect } from '../fixtures/merged-fixtures'

/** Measure the painted text bounds after scrolling each control into view. */
export async function expectReadable(control: Locator) {
  await expect(control).toBeVisible()
  await control.scrollIntoViewIfNeeded()
  const overflow = await control.evaluate(async (element) => {
    await document.fonts.ready
    const bounds = element.getBoundingClientRect()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const clipped: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      let left = Math.max(bounds.left, 0)
      let right = Math.min(bounds.right, document.documentElement.clientWidth)
      for (
        let parent = node.parentElement;
        parent && parent !== element;
        parent = parent.parentElement
      ) {
        if (/^(hidden|clip)$/.test(getComputedStyle(parent).overflowX)) {
          const clipping = parent.getBoundingClientRect()
          left = Math.max(left, clipping.left)
          right = Math.min(right, clipping.right)
        }
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const line of Array.from(range.getClientRects())) {
        if (
          line.left < left - 1 ||
          line.right > right + 1 ||
          line.top < bounds.top - 1 ||
          line.bottom > bounds.bottom + 1
        ) {
          clipped.push(node.textContent.trim())
          break
        }
      }
    }
    return clipped
  })
  expect(overflow, `${control.toString()} has room for every visible label`).toEqual([])
}
