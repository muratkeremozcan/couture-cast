// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-00i, every page probed (TEA rulings 2026-11-14): how the live font-scale proof reads a
// screen's scroll pages, each with the text layout probe's answer, and attaches them to the
// capture the oracle judges page by page (live-font-scale-proof.mjs pageCaptures). Device IO is
// injected, so every rule here runs off-device; scripts/run-live-font-proof.mjs binds it to
// Maestro, adb and the probe.
import { sameLayout, stitchPages } from './live-font-capture.mjs'

/** Reads a page settles within; at 500 ms apart, about ten seconds. */
export const PAGE_ATTEMPTS = 20
export const PAGE_INTERVAL_MS = 500
/** Drags a scroll-through takes at most before it stops. */
export const MAX_DRAGS = 12

function unstable(detail) {
  const error = new Error(`live_font_scroll_page_unstable: ${detail}`)
  error.code = 'live_font_scroll_page_unstable'
  return error
}

/**
 * One settled screen or scroll page with its probe answer. `read()` returns the hierarchy as the
 * caller needs it, with the `nodes` the comparison reads; `probe()` returns the probe's answer.
 * A page is settled after two identical reads `intervalMs` apart, or at once when the caller
 * hands a read it already saw settle as `first` (makeCapture, after settleCapture). The probe is
 * asked then, and the hierarchy is read once more after its answer (a sandwich read): a page
 * that moved between the read and the answer (a scroll still settling) is never paired, the read
 * after becomes the next comparison and the page is tried again. Within `attempts` pauses the
 * page must hold still on both sides of one answer, or the run fails as
 * live_font_scroll_page_unstable.
 */
export async function stablePage({
  read,
  probe,
  pause,
  first,
  attempts = PAGE_ATTEMPTS,
  intervalMs = PAGE_INTERVAL_MS,
}) {
  let previous = first ?? read()
  let settled = first !== undefined
  let moved = 0
  for (let attempt = 0; ; ) {
    if (!settled) {
      if (attempt >= attempts)
        throw unstable(`${attempts} reads, ${moved} probe answers on a moving page`)
      attempt += 1
      await pause(intervalMs)
      const current = read()
      settled = sameLayout(current.nodes, previous.nodes)
      previous = current
      if (!settled) continue
    }
    const textProbe = probe()
    const after = read()
    if (sameLayout(after.nodes, previous.nodes)) return { ...previous, textProbe }
    moved += 1
    previous = after
    settled = false
  }
}

/**
 * The scroll-through: the page at the top, then one page per drag until a drag shows the same
 * page again (the bottom) or `maxDrags` drags are done. `page()` reads one settled page
 * (stablePage) and `dragUp()` scrolls one step down the content. Returns the distinct pages in
 * order and the number of drags made, which the caller undoes.
 */
export async function scrollPages({ page, dragUp, maxDrags = MAX_DRAGS }) {
  const pages = [await page()]
  let drags = 0
  for (; drags < maxDrags; drags += 1) {
    dragUp()
    const next = await page()
    if (sameLayout(next.nodes, pages.at(-1).nodes)) break
    pages.push(next)
  }
  return { pages, drags }
}

/**
 * What a capture keeps of its scroll-through: `fullText`, the stitched text of every page
 * (stitchPages, stepping `expectedShift` across a page that shares no text with its neighbour),
 * and, for a screen that scrolls, `pages` with each page's probe answer and `pageShift`, which
 * the judge reads to name and judge each page's text. A screen of one page keeps neither.
 */
export function attachPages(capture, pages, expectedShift) {
  if (pages.length < 2) {
    capture.fullText = undefined
    return capture
  }
  capture.fullText = stitchPages(
    pages.map((page) => page.nodes),
    { expectedShift }
  )
  capture.pages = pages
  capture.pageShift = expectedShift
  return capture
}
