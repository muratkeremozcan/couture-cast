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
/**
 * Drags a scroll-through takes at most. A screen still scrolling after them fails: at 12 the
 * Android 6c85bbb4 Community feed stopped 13 pages down on every capture, so its last cards were
 * read at some launches and not others.
 */
export const MAX_DRAGS = 30

/**
 * The screenshot file of page `page` of the capture named `file`: page 0 keeps the capture's own
 * name (`<file>.png`, what every reader and earlier run use), a later page `<file>-page<n>.png`.
 */
export function pageImage(file, page) {
  if (typeof file !== 'string' || file === '')
    throw new Error('live_font_page_image_file')
  if (!Number.isSafeInteger(page) || page < 0)
    throw new Error('live_font_page_image_index')
  return page === 0 ? `${file}.png` : `${file}-page${page}.png`
}

/**
 * Points every listed clip of a judged leg at the screenshot of each page it shows on: a settled
 * clip (`clipping`) at the settled capture's pages, an updated one (`postUpdateClipping`) at the
 * updated capture's; a box-in-parent clip, read on page 0, at page 0. A capture without a file
 * name (a unit fixture) leaves its clips as they are.
 */
export function attachClipImages(checks, { settled, updated } = {}) {
  for (const [name, capture] of [
    ['clipping', settled],
    ['postUpdateClipping', updated],
  ]) {
    if (typeof capture?.file !== 'string') continue
    for (const entry of checks?.[name]?.clipped ?? [])
      entry.images = (entry.pages ?? [0]).map((page) => pageImage(capture.file, page))
  }
  return checks
}

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
 * live_font_scroll_page_unstable. `shoot()`, given, takes the page's screenshot once it held
 * still on both sides (so the image is the page the answer describes) and returns its file
 * name, kept as the page's `image`.
 */
export async function stablePage({
  read,
  probe,
  pause,
  first,
  shoot,
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
    if (sameLayout(after.nodes, previous.nodes))
      return shoot
        ? { ...previous, textProbe, image: shoot() }
        : { ...previous, textProbe }
    moved += 1
    previous = after
    settled = false
  }
}

/**
 * The scroll-through: the page at the top, then one page per drag until a drag shows the same
 * page again (the bottom). `page(index)` reads settled page `index` (stablePage; 0 the top) and
 * `dragUp()` scrolls one step down the content. Returns the distinct pages in order and the
 * number of drags made, which the caller undoes. A screen that still shows a new page after
 * `maxDrags` drags never reached its bottom, so its last pages would go unread: it fails as
 * live_font_scroll_bottom_unreached.
 */
export async function scrollPages({ page, dragUp, maxDrags = MAX_DRAGS }) {
  const pages = [await page(0)]
  for (let drags = 0; drags < maxDrags; drags += 1) {
    dragUp()
    const next = await page(pages.length)
    if (sameLayout(next.nodes, pages.at(-1).nodes)) return { pages, drags }
    pages.push(next)
  }
  const error = new Error(
    `live_font_scroll_bottom_unreached: still scrolling after ${maxDrags} drags`
  )
  error.code = 'live_font_scroll_bottom_unreached'
  throw error
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
