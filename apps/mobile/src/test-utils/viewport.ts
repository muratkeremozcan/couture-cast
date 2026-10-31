import { Dimensions } from 'react-native'
import { expect } from 'vitest'
import { page } from 'vitest/browser'

/**
 * Resizes the test viewport and resolves once react-native-web reports the new window size.
 *
 * `page.viewport` resolves when Playwright has resized the page. The iframe's `resize`
 * event, which `Dimensions` and `useWindowDimensions` listen to, can arrive a frame later,
 * so a screen rendered straight after `page.viewport` would lay out for the previous size.
 */
export async function setViewport(width: number, height: number) {
  await page.viewport(width, height)
  await expect
    .poll(() => {
      const window = Dimensions.get('window')
      return [window.width, window.height]
    })
    .toEqual([width, height])
}
