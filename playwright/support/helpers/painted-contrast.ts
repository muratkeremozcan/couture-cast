// Rendered-pixel contrast for Playwright specs: what Chromium paints, not what CSS declares.
//
// Each measurement takes two screenshots of the same region: one without the ink under test and
// one with it. Text is hidden by -webkit-text-fill-color alone, so borders, underlines and other
// currentColor decoration stay in both shots; a placeholder by its own fill; a focus indicator by
// taking the first shot before keyboard focus. The pixels that change are that ink, each compared
// with the same pixel without it, so group opacity, translucent colors, clip-paths and
// antialiasing count as painted. The highest per-pixel WCAG ratio stands for the ink (a glyph's
// stem reaches its full color), which holds only on a uniform background, so the background under
// the changed pixels must be uniform or the measurement is refused. Ratios compare unrounded; no
// changed pixel means nothing was painted. Used by community-dark-mode, community-reactions,
// accessibility-hardening, commerce-affiliate-preferences and app-shell-visual-system specs.
import { type Locator, type Page, test } from '@playwright/test'

export type ContrastFailure = {
  text: string
  ratio: number
  required: number
  painted: number
}

/** `uniform`: the background under the changed pixels varies by under 15% in contrast terms. */
/**
 * Where the ratio came from: the pixel group that rated lowest, by how it was rated (`exact`: one
 * background luminance, within 1%, and its strongest stem; `step`: a 2% luminance step held at its worst;
 * `small`: a glyph under both floors), its size, luminances and box in the shot (CSS pixels).
 */
export type Weakest = {
  kind: 'exact' | 'step' | 'small'
  ratio: number
  count: number
  under: number
  ink: number
  box: [number, number, number, number]
}
export type Ink = {
  painted: number
  ratio: number
  uniform: boolean
  weakest?: Weakest
  /** The two shots and a diff mask (changed pixels grey, the weakest group red), base64 PNG. */
  shots?: { bare: string; inked: string; diff: string }
  /**
   * Focus rings only (WCAG 2.4.13 focus appearance): samples outside the border box whose own
   * before/after contrast is at least 3:1, and the area a 2 CSS px perimeter of the unfocused
   * control covers (twice its perimeter, corners rounded by its border radius, rounded up). The
   * shots use `scale: 'css'`, so both are in CSS pixels, one sample per CSS pixel.
   */
  qualifying?: number
  required?: number
}

const MARK = 'data-tea-ink'
const TARGET = 'data-tea-target'
const STYLE_ID = 'tea-ink-style'
// Glyph fill only: color, and every currentColor border or decoration with it, is left alone.
const FILL_OFF =
  '-webkit-text-fill-color: transparent !important; text-shadow: none !important;'
// Descendants' glyphs stay hidden in both shots, so only the marked element's own text differs.
const DESCENDANT_TEXT_OFF = `[${MARK}] * { ${FILL_OFF} }`
// The focused target with its own indicator switched off: what focus changed that this does not
// revert was painted by something other than the target's outline or shadow.
const INDICATOR_OFF = `[${MARK}] { outline-style: none !important; box-shadow: none !important; }`
const OWN_TEXT_OFF = `[${MARK}] { ${FILL_OFF} }`
// The glyph mask: the same glyphs in an opaque magenta, to find where every letter sits.
const MASK_FILL =
  '-webkit-text-fill-color: #ff00ff !important; text-shadow: none !important;'
const OWN_TEXT_MASK = `[${MARK}] { ${MASK_FILL} }`
const PLACEHOLDER_MASK = `[${MARK}]::placeholder { color: #ff00ff !important; opacity: 1 !important; ${MASK_FILL} }`
const PLACEHOLDER_OFF = `[${MARK}]::placeholder { color: transparent !important; ${FILL_OFF} }`

async function setInkStyle(page: Page, css: string) {
  await page.evaluate(
    ({ id, rule }) => {
      let style = document.getElementById(id)
      if (!style) {
        style = document.createElement('style')
        style.id = id
        document.head.append(style)
      }
      style.textContent = rule
      // Two frames, so the next screenshot shows the rule painted, under load too.
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
    },
    { id: STYLE_ID, rule: css }
  )
}

const nextFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )

/**
 * Puts the page at rest before a pair of shots: the pointer parked at the top-left corner, then
 * every finite animation and transition finished (at most 400 ms; spinners never finish and are
 * left alone). Centring the target scrolls the page, and the element that lands under a resting
 * pointer turns hover a moment later; its colour transition running between the bare and inked
 * shots made a near-invisible group of changed pixels decide the ratio (CC-7.9 reactions ring,
 * 1.0069 on CI 7c284e60 and 40ee2f90, first case only, the one that scrolled).
 */
async function settle(page: Page) {
  await page.mouse.move(0, 0)
  await nextFrames(page)
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const end = animation.effect?.getComputedTiming().endTime
      return animation.playState === 'running' && Number.isFinite(Number(end))
    })
    if (finite.length === 0) return
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ])
  })
  await nextFrames(page)
}

type Clip = { x: number; y: number; width: number; height: number }
/** The element's border box inside the clip (CSS pixels), whose pixels a focus ring skips. */
type Exclude = Clip & { clipWidth: number; radius: number }

async function shot(page: Page, clip: Clip) {
  return (
    await page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' })
  ).toString('base64')
}

/**
 * Compares a shot without the ink (`bare`) with one with it (`inked`), pixel by pixel. `mask`,
 * when given, is the same glyphs painted magenta: every glyph position, including letters whose
 * real ink equals the background and so changes nothing, is then sampled.
 */
async function compare(
  page: Page,
  bare: string,
  inked: string,
  mask?: string,
  withShots = false,
  exclude: Exclude | null = null,
  own?: string
): Promise<Ink> {
  const result = await page.evaluate(
    async ({ a, b, m, w, x, o }) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [inkedImage, bareImage, maskImage, ownImage] = await Promise.all([
        pixels(a),
        pixels(b),
        m ? pixels(m) : Promise.resolve(null),
        o ? pixels(o) : Promise.resolve(null),
      ])
      const ownPx = ownImage?.data ?? null
      const inkedPx = inkedImage.data
      const barePx = bareImage.data
      const maskPx = maskImage?.data ?? null
      const { width, height } = bareImage
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * channel(d[i]!) +
        0.7152 * channel(d[i + 1]!) +
        0.0722 * channel(d[i + 2]!)
      const differs = (x: Uint8ClampedArray, y: Uint8ClampedArray, i: number) =>
        Math.abs(x[i]! - y[i]!) +
          Math.abs(x[i + 1]! - y[i + 1]!) +
          Math.abs(x[i + 2]! - y[i + 2]!) >
        0
      // Each glyph position (the mask's, or else every pixel the ink changed): the luminance
      // under it without the ink, and with it.
      // A focus ring is read outside the element's border box only (see focusRing). The shots
      // are at CSS resolution, so `scale` is 1; it stays for a shot taken at another scale.
      const scale = x ? width / x.clipWidth : 1
      const inside = (pixel: number) => {
        if (!x) return false
        const px = (pixel % width) / scale
        const py = Math.floor(pixel / width) / scale
        return px >= x.x && px < x.x + x.width && py >= x.y && py < x.y + x.height
      }
      const collect = () => {
        const changed: [number, number, number][] = []
        const masked: [number, number, number][] = []
        for (let i = 0; i < inkedPx.length; i += 4) {
          if (inside(i / 4)) continue
          const pair: [number, number, number] = [
            luminance(barePx, i),
            luminance(inkedPx, i),
            i / 4,
          ]
          if (differs(inkedPx, barePx, i)) changed.push(pair)
          if (maskPx && differs(maskPx, barePx, i)) masked.push(pair)
        }
        return { changedPairs: changed, maskPairs: masked }
      }
      const { changedPairs, maskPairs } = collect()
      const painted = changedPairs.length
      const pairs = maskPairs.length > 0 ? maskPairs : changedPairs
      // The background is the median under the ink; uniform when 95% of the ink sits within
      // 15% of it (an antialiased edge over a 1 px border is allowed, a background that changes
      // under the text is not). The ratio is read over that background only.
      const under = pairs.map(([bare]) => bare).sort((x, y) => x - y)
      const median = under[Math.floor(under.length / 2)] ?? 0
      const near = (value: number) =>
        Math.max(value + 0.05, median + 0.05) / Math.min(value + 0.05, median + 0.05) <=
        1.15
      const onBackground = pairs.filter(([bare]) => near(bare))
      const uniform = pairs.length === 0 || onBackground.length >= 0.95 * pairs.length
      const contrast = (x: number, y: number) =>
        (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
      // Focus appearance: the changed pixels outside the border box that reach 3:1 themselves.
      const appearance = () =>
        x
          ? {
              // A sample counts when focus changes it at 3:1 and the target's own indicator is
              // what changed it: it reverts with the target's outline and shadow switched off
              // (`own`). A strip elsewhere that repaints on focus is no ring (Codex check 4).
              qualifying: changedPairs.filter(
                ([u, i, pixel]) =>
                  contrast(u, i) >= 3 && (!ownPx || differs(ownPx, inkedPx, pixel * 4))
              ).length,
              // Twice the control's perimeter, corners rounded by its border radius.
              required: Math.ceil(
                2 *
                  (2 * (x.width + x.height) -
                    (8 - 2 * Math.PI) * Math.min(x.radius, x.width / 2, x.height / 2)) *
                  scale *
                  scale
              ),
            }
          : {}
      const rate = (glyphs: [number, number, number][]): Rated[] => {
        // Each background region is rated on its own. Glyph pixels are grouped by the luminance
        // under them (within 1%, see `region`), and each group by its strongest stem (the pixel whose ink differs
        // most from its own background, which is where a translucent text color is painted over
        // that region); the text takes its weakest group. A group needs 3% of the glyph pixels
        // (and at least 8) to count, so a few antialiased pixels cannot decide the result. The glyph
        // pixels left outside every counted group (a gradient beside a flat region, or a gradient
        // alone) are rated too once they reach 5% of the label: in 2% steps, each step's stem held
        // against every background in it.
        type Group = {
          count: number
          strongest: number
          ink: number
          unders: number[]
          pixels: number[]
        }
        const groupBy = (
          sample: [number, number, number][],
          keyOf: (under: number) => number
        ) => {
          const groups = new Map<number, Group>()
          for (const [under, inked, pixel] of sample) {
            const key = keyOf(under)
            let group = groups.get(key)
            if (!group) {
              group = { count: 0, strongest: 1, ink: inked, unders: [], pixels: [] }
              groups.set(key, group)
            }
            group.count += 1
            group.unders.push(under)
            group.pixels.push(pixel)
            const local = contrast(under, inked)
            if (local > group.strongest) {
              group.strongest = local
              group.ink = inked
            }
          }
          return [...groups.values()]
        }
        const floor = Math.max(8, 0.03 * glyphs.length)
        const worstOf = (group: Group) => {
          let worst = Infinity
          for (const under of group.unders)
            worst = Math.min(worst, contrast(group.ink, under))
          return worst
        }
        // One background region is one luminance within 1% (of L + 0.05, a contrast change of
        // under 1%), not one exact value: a translucent blurred bar varies by tiny amounts, split
        // the text into slivers, and a sliver holding only a thin diagonal's antialiased edge
        // rated 4.45 for #A1A1AA on #121214, about 7:1 (CI 5f2043f2, Community filter chip).
        const region = (under: number) =>
          Math.round(Math.log(under + 0.05) / Math.log(1.01))
        const exactKeys = new Set<number>()
        const rated: Rated[] = []
        // Rated by its strongest stem against every background in it, the worst counting: the
        // stem stands for the ink the whole region carries, and no background in the region can
        // pass on a neighbour's behalf (Codex check 4: #747474 at 4.49 beside #757474 at 4.51
        // read 4.51 when the region took its best local ratio).
        for (const group of groupBy(glyphs, region))
          if (group.count >= floor) {
            rated.push({ value: worstOf(group), group, kind: 'exact' })
            exactKeys.add(region(group.unders[0]!))
          }
        const remainder = glyphs.filter(([under]) => !exactKeys.has(region(under)))
        if (remainder.length >= Math.max(8, 0.05 * glyphs.length)) {
          const steps = groupBy(remainder, (under) =>
            Math.round(Math.log(under + 0.05) / Math.log(1.02))
          )
          const counted = steps.filter((group) => group.count >= floor)
          for (const group of counted.length > 0 ? counted : steps)
            rated.push({ value: worstOf(group), group, kind: 'step' })
        }
        // A glyph too small for either floor (a period paints a few pixels) is still rated: each
        // exact background under it by its own strongest stem.
        if (rated.length === 0)
          for (const group of groupBy(glyphs, (under) => under))
            rated.push({ value: group.strongest, group, kind: 'small' })
        return rated
      }
      type Rated = {
        value: number
        group: { count: number; ink: number; unders: number[]; pixels: number[] }
        kind: 'exact' | 'step' | 'small'
      }
      const rated = rate(onBackground)
      let ratio = rated.length > 0 ? Infinity : 1
      let low: Rated | undefined
      for (const entry of rated)
        if (entry.value < ratio) {
          ratio = entry.value
          low = entry
        }
      // The weakest group, located: its box and a diff mask of the shot (CC-7.9 reactions ring).
      const locate = (entry: Rated) => {
        let [x0, y0, x1, y1] = [width, height, 0, 0]
        for (const pixel of entry.group.pixels) {
          const x = pixel % width
          const y = Math.floor(pixel / width)
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
        const sortedUnders = [...entry.group.unders].sort((x, y) => x - y)
        return {
          kind: entry.kind,
          ratio: entry.value,
          count: entry.group.count,
          under: sortedUnders[Math.floor(sortedUnders.length / 2)] ?? 0,
          ink: entry.group.ink,
          box: [x0, y0, x1, y1] as [number, number, number, number],
        }
      }
      const diffMask = (entry: Rated) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        const diff = ctx.createImageData(width, height)
        for (let i = 0; i < barePx.length; i += 4) {
          const grey = Math.round(
            (barePx[i]! + barePx[i + 1]! + barePx[i + 2]!) / 9 + 170
          )
          const shade = differs(inkedPx, barePx, i) ? 90 : grey
          diff.data.set([shade, shade, shade, 255], i)
        }
        for (const pixel of entry.group.pixels) diff.data.set([255, 0, 0, 255], pixel * 4)
        ctx.putImageData(diff, 0, 0)
        return canvas.toDataURL('image/png').split(',')[1] ?? ''
      }
      return {
        painted,
        ratio,
        uniform,
        weakest: low && locate(low),
        diffPng: low && w ? diffMask(low) : '',
        ...appearance(),
      }
    },
    { a: inked, b: bare, m: mask ?? null, w: withShots, x: exclude, o: own ?? null }
  )
  const { diffPng, ...ink } = result
  return diffPng ? { ...ink, shots: { bare, inked, diff: diffPng } } : ink
}

type States = {
  bare: () => Promise<void>
  inked: () => Promise<void>
  mask?: () => Promise<void>
  /**
   * Focus rings only: settle the page first (pointer parked, finite transitions done) and keep
   * both shots and a diff mask of the weakest group on the result. The settle ran before every
   * text scan on 2e5b5628 and pushed pw-e2e (2, 2) past its 20-minute job limit.
   */
  withShots?: boolean
  /**
   * Focus rings only: rate the pixels focus changes outside the element's border box, where
   * the outline and halo paint. Inside, focus re-rasterises the label under the new layer: on
   * CI fd692390 80 label pixels moved 1.5% in luminance and, as the weakest group, read 1.0069
   * while the ring around the button held well over 3:1 (reactions, default light).
   */
  outsideOnly?: boolean
}

/**
 * The region to shoot: the element's box plus `margin`, in the viewport. 'detached' when the
 * node was replaced between the lookup and the scroll; null when it has no box on screen. A sticky
 * bar or overlay over the box would be measured in its place, so a covered element is refused.
 */
async function clipFor(
  target: Locator,
  margin: number,
  coverRows: number[] = [0.5]
): Promise<Clip | null | 'detached'> {
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 2_000 })
  } catch (error) {
    if (/not attached|detached/i.test(String(error))) return 'detached'
    throw error
  }
  const cover = await target.evaluate((el, rows) => {
    // Centred first: scrolled only into view, text at the bottom edge lands under a fixed tab
    // bar (CC-7.9 shell spec, CI c9614d98) and would be refused as covered. Only the window
    // scrolls: scrollIntoView centres the element in every scrolling ancestor too, and a
    // horizontal row (overflow-x auto also scrolls vertically) moved its content up under its
    // own clip, so the hit landed on the section text above (CI 2e5b5628, spotlight row).
    // The centre is that of the area below the page's scroll-padding-top: a stuck header stack
    // declares its depth there (WCAG C43), and the window's own middle can sit under it.
    const before = el.getBoundingClientRect()
    const padTop =
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
    const middle = padTop + (window.innerHeight - padTop) / 2
    window.scrollBy(0, before.top + before.height / 2 - middle)
    const r = el.getBoundingClientRect()
    // The measured element takes hit tests for the check, whatever its own or an ancestor's
    // pointer-events say: a decorative label (the spotlight rank pill, a badge row) is
    // pointer-events none, so the hit fell through it to the photo it paints over and read as
    // covered (CI 40ee2f90). Anything really painted above it still wins the hit.
    const own = el as HTMLElement
    const previous = own.style.getPropertyValue('pointer-events')
    const priority = own.style.getPropertyPriority('pointer-events')
    own.style.setProperty('pointer-events', 'auto', 'important')
    try {
      const points = rows.flatMap((fy) =>
        [0.5, 0.15, 0.85].map((fx) => [r.left + r.width * fx, r.top + r.height * fy])
      )
      for (const [px, py] of points) {
        const hit = document.elementFromPoint(px!, py!)
        if (hit && !el.contains(hit) && !hit.contains(el)) {
          // Both sides named, so a cover reads from the log (CI fd692390, span in spotlight).
          const id = hit.closest('[data-testid]')?.getAttribute('data-testid') ?? ''
          const describe = (node: Element) => {
            const box = node.getBoundingClientRect()
            return `${node.outerHTML.slice(0, 160)} text "${(node.textContent ?? '').trim().slice(0, 40)}" box [${[box.x, box.y, box.width, box.height].map(Math.round).join(', ')}]`
          }
          const point = [px!, py!].map(Math.round)
          return `${hit.tagName.toLowerCase()} in ${id}\n  cover: ${describe(hit)}\n  target: ${describe(el)}\n  at [${point.join(', ')}], scroll [${window.scrollX}, ${window.scrollY}]`
        }
      }
      return null
    } finally {
      if (previous) own.style.setProperty('pointer-events', previous, priority)
      else own.style.removeProperty('pointer-events')
    }
  }, coverRows)
  if (cover)
    throw new Error(`painted-contrast: the measured element is covered by ${cover}`)
  const box = await target.boundingBox()
  if (!box || box.width === 0 || box.height === 0) return null
  const viewport = target.page().viewportSize()!
  const x = Math.max(0, box.x - margin)
  const y = Math.max(0, box.y - margin)
  const clip = {
    x,
    y,
    width: Math.min(viewport.width, box.x + box.width + margin) - x,
    height: Math.min(viewport.height, box.y + box.height + margin) - y,
  }
  return clip.width > 0 && clip.height > 0 ? clip : null
}

/** The bare, inked and (when given) mask shots of `clip`, compared. */
async function takeShots(
  page: Page,
  clip: Clip,
  states: States,
  exclusionAtBare: () => Promise<Exclude | null> = () => Promise.resolve(null)
): Promise<Ink> {
  await states.bare()
  // The excluded border box is read in the bare state, the one the shots compare from: a blur
  // that moves the target would otherwise leave the exclusion where it was (Codex check 4).
  const exclude = await exclusionAtBare()
  const bare = await shot(page, clip)
  await states.inked()
  const inked = await shot(page, clip)
  let mask: string | undefined
  if (states.mask) {
    await states.mask()
    mask = await shot(page, clip)
  }
  let own: string | undefined
  if (states.outsideOnly) {
    await setInkStyle(page, INDICATOR_OFF)
    own = await shot(page, clip)
  }
  await setInkStyle(page, '')
  return compare(page, bare, inked, mask, states.withShots, exclude, own)
}

/**
 * Measures one ink of `target` inside its own box (plus `margin`). `prepare` runs first on every
 * attempt (it re-marks enumerated targets after a re-render); `bare` and `inked` put the page in
 * the two states, in that order. A re-render that replaces the node between the shots is detected
 * through the mark and measured again.
 */
async function measure(
  target: Locator,
  states: States,
  options: { margin?: number; prepare?: () => Promise<void>; coverRows?: number[] } = {}
): Promise<Ink | null> {
  const margin = options.margin ?? 0
  const page = target.page()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await options.prepare?.()
    if ((await target.count()) === 0) continue
    const clip = await clipFor(target, margin, options.coverRows)
    if (clip === 'detached') continue
    if (!clip) return null
    const handle = await target.elementHandle()
    await handle.evaluate((el, mark) => el.setAttribute(mark, ''), MARK)
    try {
      if (states.withShots || attempt > 0) await settle(page)
      const exclusionAtBare = async (): Promise<Exclude | null> => {
        if (!states.outsideOnly) return null
        const box = await handle.boundingBox()
        if (!box) throw new Error('painted-contrast: the focus ring target has no box')
        // The ring is read inside the clip taken before the bare state; a target that left it
        // there cannot be measured.
        if (
          box.x < clip.x ||
          box.y < clip.y ||
          box.x + box.width > clip.x + clip.width ||
          box.y + box.height > clip.y + clip.height
        )
          throw new Error(
            'painted-contrast: the focus ring target moved out of its clip when it lost focus'
          )
        const radius = await handle.evaluate(
          (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
        )
        return {
          x: box.x - clip.x,
          y: box.y - clip.y,
          width: box.width,
          height: box.height,
          clipWidth: clip.width,
          radius,
        }
      }
      const ink = await takeShots(page, clip, states, exclusionAtBare)
      const stable = await handle.evaluate(
        (el, mark) => el.isConnected && el.hasAttribute(mark),
        MARK
      )
      // Recheck empty or uneven samples after the page settles. A native select can repaint
      // between shots, as the report reason did in the CC-7.14 burn-in. Stable uneven samples
      // and unpainted labels still reach the caller's contrast assertions.
      if (stable && ((ink.painted > 0 && ink.uniform) || attempt > 0)) return ink
    } finally {
      await handle
        .evaluate((el, mark) => el.removeAttribute(mark), MARK)
        .catch(() => undefined)
      await handle.dispose()
    }
  }
  throw new Error('painted-contrast: the element kept re-rendering during measurement')
}

const textStates = (page: Page, extra = '') => ({
  bare: () => setInkStyle(page, `${DESCENDANT_TEXT_OFF}\n${OWN_TEXT_OFF}\n${extra}`),
  inked: () => setInkStyle(page, `${DESCENDANT_TEXT_OFF}\n${extra}`),
  mask: () => setInkStyle(page, `${DESCENDANT_TEXT_OFF}\n${OWN_TEXT_MASK}\n${extra}`),
})

/** The painted contrast of an element's own text (or a field's value, or a closed select's choice). */
export function inkOfText(
  target: Locator,
  prepare?: () => Promise<void>
): Promise<Ink | null> {
  return measure(target, textStates(target.page()), { prepare })
}

/** The painted contrast of an empty field's placeholder over the field. */
export function inkOfPlaceholder(field: Locator): Promise<Ink | null> {
  const page = field.page()
  return measure(field, {
    bare: () => setInkStyle(page, PLACEHOLDER_OFF),
    inked: () => setInkStyle(page, ''),
    mask: () => setInkStyle(page, PLACEHOLDER_MASK),
  })
}

/**
 * A keyboard focus indicator as WCAG 2.4.13 (focus appearance) measures it: the element's area
 * before focus and after `focusWithKeyboard`, with every normal decoration in both shots, so a
 * permanent shadow or border is no indicator. Only pixels outside the element's border box
 * count, where the outline and halo paint. `qualifying` counts those whose own before/after
 * contrast reaches 3:1; the ring passes when it covers `required`, the area of a 2 CSS px
 * perimeter of the control, both counted in CSS pixels (the shots use `scale: 'css'`). The
 * target and the page must sit still between the two shots, or the measurement fails. CC-7.9
 * replaced a weakest-group rating here: every ring has a faint antialiased fringe, and that
 * fringe (60 px at 1.0092 on CI e5d4cfa5) decided the old ratio.
 */
export async function focusRing(
  target: Locator,
  focusWithKeyboard: () => Promise<void>
): Promise<Ink | null> {
  const page = target.page()
  // Where the page and the target sat at each shot: a scroll between them shifts the clip.
  const positions: Record<string, unknown> = {}
  const where = (label: string) =>
    target
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        return {
          scroll: [window.scrollX, window.scrollY],
          box: [r.x, r.y, r.width, r.height],
          focused: document.activeElement === el,
          focusVisible: el.matches(':focus-visible'),
        }
      })
      .then((value) => {
        positions[label] = value
      })
  const ink = await measure(
    target,
    {
      bare: async () => {
        await target.evaluate((el) => (el as HTMLElement).blur())
        await nextFrames(page)
        await where('bare')
      },
      inked: async () => {
        await focusWithKeyboard()
        await nextFrames(page)
        await where('inked')
        // Both shots must frame the same pixels: an element or page that moved between them
        // compares two layouts, never a ring (Codex check 3). This fails loudly, before scoring.
        const [bare, inked] = [positions.bare, positions.inked] as {
          scroll: number[]
          box: number[]
        }[]
        const same = (x: number[] = [], y: number[] = []) =>
          x.length === y.length && x.every((value, index) => value === y[index])
        if (!same(bare?.scroll, inked?.scroll) || !same(bare?.box, inked?.box))
          throw new Error(
            `painted-contrast: the focus ring target moved between the shots: ${JSON.stringify(positions)}`
          )
      },
      withShots: true,
      outsideOnly: true,
    },
    // A control is sampled on three rows, not only its middle line: a band over its top half
    // read as a short ring instead of a cover (CI 48c7a01e, applause pill).
    { margin: 10, coverRows: [0.25, 0.5, 0.75] }
  )
  // Every ring's area goes to the log, so a pass shows how far it cleared the minimum.
  const area = ink?.required ? (ink.qualifying ?? 0) / ink.required : 0
  if (ink)
    console.log(
      `[painted-contrast] focus ring ${JSON.stringify({ qualifying: ink.qualifying, required: ink.required, area, painted: ink.painted, weakest: ink.weakest })}`
    )
  // Short of the area the evidence goes on the report: both shots, the diff mask, and the
  // numbers and positions in words (CC-7.9 reactions ring).
  if (ink && area < 1 && ink.shots) {
    const info = test.info()
    const name = `focus-ring-${info.attachments.length}`
    await info.attach(`${name}-bare.png`, {
      body: Buffer.from(ink.shots.bare, 'base64'),
      contentType: 'image/png',
    })
    await info.attach(`${name}-inked.png`, {
      body: Buffer.from(ink.shots.inked, 'base64'),
      contentType: 'image/png',
    })
    await info.attach(`${name}-diff.png`, {
      body: Buffer.from(ink.shots.diff, 'base64'),
      contentType: 'image/png',
    })
    await info.attach(`${name}.json`, {
      body: JSON.stringify(
        {
          qualifying: ink.qualifying,
          required: ink.required,
          area,
          painted: ink.painted,
          weakest: ink.weakest,
          positions,
        },
        null,
        2
      ),
      contentType: 'application/json',
    })
  }
  return ink
}

const UNCLIP = 'data-tea-unclip'
// The clipping a label can hide behind: its own and its ancestors' clip-path, clip, mask and
// overflow, switched off together with their descendants'.
const UNCLIP_CSS = `[${UNCLIP}], [${UNCLIP}] * { clip-path: none !important; clip: auto !important; mask: none !important; overflow: visible !important; }`

/**
 * How much of `target`'s text paints, against the same element with its clipping (its own and its
 * ancestors' clip-path, clip, mask and overflow) switched off: 1 means all of it, a partly clipped
 * label reads far lower. Both counts come from the same node at the same position, font, color and
 * rasterization, so the ratio does not move with the machine's fonts or antialiasing. The reference
 * reads inside the element's own box, so text spilling out of a clipped box is not counted.
 */
export async function inkCoverage(target: Locator): Promise<number> {
  const page = target.page()
  const actual = await inkOfText(target)
  await target.evaluate((el, attr) => {
    for (let node: Element | null = el; node; node = node.parentElement)
      node.setAttribute(attr, '')
  }, UNCLIP)
  try {
    const reference = await measure(target, textStates(page, UNCLIP_CSS))
    if (!actual || !reference || reference.painted === 0) return 0
    return actual.painted / reference.painted
  } finally {
    await page.evaluate((attr) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr))
    }, UNCLIP)
  }
}

const requiredFor = (style: { fontSize: string; fontWeight: string }) => {
  const size = parseFloat(style.fontSize)
  return size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5
}

type Target = { index: number; text: string; fontSize: string; fontWeight: string }

/** Marks every measurable text run under `root` with its enumeration index; returns them. */
function enumerate(root: Locator): Promise<Target[]> {
  return root.evaluate((scope, tag) => {
    const found: Target[] = []
    // Text clipped away by itself or an ancestor paints nothing: the sr-only pattern (a 1 px
    // box with overflow hidden, clip rect(0 0 0 0) or clip-path inset(50%)) keeps the child's
    // own layout box, so a live region read 428 x 19 and its hit test landed on the visible
    // eyebrow under it (CI e5d4cfa5, community-live-region).
    // Only these shapes: text merely scrolled out of a row's overflow stays measured (the probe
    // scrolls it into view).
    // Each branch is a complete clip as CSS applies it (Codex check 3): `clip` acts only on an
    // absolutely or fixed positioned box; the 1 px box clips on both axes and is 1 px or less
    // both ways, so nothing of the text inside it can show.
    // An ancestor's overflow clips only what is laid out inside it: an absolutely positioned box
    // escapes every ancestor below its containing block, and a fixed one escapes them all, so a
    // 1 px wrapper below that block hides nothing of it (Codex check 4).
    // A clip that hides everything the node paints, its descendants included.
    const clipsAll = (style: CSSStyleDeclaration) =>
      (['absolute', 'fixed'].includes(style.position) &&
        /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(style.clip)) ||
      /^inset\(50%\)$/.test(style.clipPath)
    // A box 1 px or less both ways that clips both axes: nothing laid out inside it shows.
    const onePixelClip = (node: Element, style: CSSStyleDeclaration) => {
      if (!['hidden', 'clip'].includes(style.overflowX)) return false
      if (!['hidden', 'clip'].includes(style.overflowY)) return false
      const own = node.getBoundingClientRect()
      return own.width <= 1 && own.height <= 1
    }
    // Where a positioned box's layout escapes to: its containing block, or the page when fixed.
    const containingBlock = (node: Element, style: CSSStyleDeclaration) => {
      if (style.position === 'fixed') return 'all' as const
      if (style.position === 'absolute')
        return (node as HTMLElement).offsetParent ?? 'all'
      return null
    }
    const clippedAway = (el: Element) => {
      let escapeTo: Element | 'all' | null = null
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (clipsAll(style)) return true
        if (node === escapeTo) escapeTo = null
        if ((escapeTo === null || node === el) && onePixelClip(node, style)) return true
        escapeTo ??= containingBlock(node, style)
      }
      return false
    }
    const measurable = (el: Element) => {
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return (
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        !el.closest(':disabled') &&
        !(el instanceof HTMLOptionElement) &&
        !clippedAway(el)
      )
    }
    // '' means nothing to measure; null marks an empty field the caller must fill.
    const textOf = (el: Element): string | null => {
      if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? ''
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.type === 'file' || el.type === 'checkbox') return ''
        return el.value || null
      }
      return Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim()
    }
    const all = [scope, ...Array.from(scope.querySelectorAll('*'))]
    all.forEach((el, index) => {
      el.removeAttribute(tag)
      if (!measurable(el)) return
      const style = getComputedStyle(el)
      const own = textOf(el)
      const entry = { fontSize: style.fontSize, fontWeight: style.fontWeight }
      if (own === null) {
        found.push({
          index: -1 - index,
          text: `empty ${el.tagName.toLowerCase()} ${el.id}`,
          ...entry,
        })
        return
      }
      if (!own) return
      el.setAttribute(tag, String(index))
      found.push({ index, text: own, ...entry })
    })
    return found
  }, TARGET)
}

/** Whether `root` shows at all, and the text it holds. */
function rootState(root: Locator) {
  return root.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      visible:
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none',
      text: (el.textContent ?? '').trim().slice(0, 60),
    }
  })
}

const signature = (list: Target[]) => JSON.stringify(list.map((t) => [t.index, t.text]))

class TargetsChanged extends Error {}

function failureFor(target: Target, ink: Ink | null): ContrastFailure | null {
  const required = requiredFor(target)
  if (ink && ink.painted > 0 && ink.uniform && ink.ratio >= required) return null
  const text =
    ink && !ink.uniform ? `${target.text} (background not uniform)` : target.text
  return {
    text: text.slice(0, 60),
    ratio: ink ? Math.floor(ink.ratio * 1000) / 1000 : 0,
    required,
    painted: ink?.painted ?? 0,
  }
}

/**
 * A text failure's evidence on the report (CI db90edaa, "Cold and dry" at 4.452): the run
 * measured once more with its shots kept (bare, inked, and the diff with the weakest group in
 * red), plus what the browser computed for it: its color, the first painted background up its
 * ancestors, font, opacity and where it sits.
 */
async function attachTextEvidence(target: Locator, failure: ContrastFailure) {
  const page = target.page()
  const again = await measure(target, { ...textStates(page), withShots: true }).catch(
    (error: unknown) => ({ error: String(error) })
  )
  const computed = await target
    .evaluate((el) => {
      const style = getComputedStyle(el)
      let backdrop = 'none'
      for (let node: Element | null = el; node; node = node.parentElement) {
        const background = getComputedStyle(node).backgroundColor
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(background)) {
          const id = node.closest('[data-testid]')?.getAttribute('data-testid') ?? ''
          backdrop = `${background} on ${node.tagName.toLowerCase()} in ${id}`
          break
        }
      }
      const box = el.getBoundingClientRect()
      return {
        html: el.outerHTML.slice(0, 200),
        testid: el.closest('[data-testid]')?.getAttribute('data-testid') ?? '',
        color: style.color,
        backdrop,
        font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
        opacity: style.opacity,
        theme: document.documentElement.getAttribute('data-theme'),
        scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        box: [box.x, box.y, box.width, box.height].map(Math.round),
      }
    })
    .catch((error: unknown) => ({ error: String(error) }))
  const info = test.info()
  const name = `text-contrast-${info.attachments.length}`
  const shots = again && 'shots' in again ? again.shots : undefined
  if (shots)
    for (const [label, body] of Object.entries(shots))
      await info.attach(`${name}-${label}.png`, {
        body: Buffer.from(body, 'base64'),
        contentType: 'image/png',
      })
  const measured =
    again === null
      ? null
      : 'error' in again
        ? again
        : { ratio: again.ratio, painted: again.painted, weakest: again.weakest }
  const report = { failure, measured, computed }
  await info.attach(`${name}.json`, {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
  console.log(`[painted-contrast] text failure ${JSON.stringify(report)}`)
}

/** One scan over a settled target list; throws TargetsChanged when the list moves under it. */
async function scanOnce(root: Locator, rootText: string): Promise<ContrastFailure[]> {
  const page = root.page()
  const targets = await enumerate(root)
  const expected = signature(targets)
  const settled = async () => {
    if (signature(await enumerate(root)) !== expected) throw new TargetsChanged()
  }
  const failures: ContrastFailure[] = []
  for (const target of targets) {
    if (target.index < 0) {
      failures.push({ text: target.text, ratio: 0, required: 4.5, painted: 0 })
      continue
    }
    const locator = page.locator(`[${TARGET}="${target.index}"]`)
    // Re-enumerated only when this target's mark is gone (a re-render replaced the node): one
    // enumeration per target walked the whole root with getComputedStyle each time, which made
    // a full-page scan quadratic (about 38 s per shell tab, CC-7.9 burn-in over 20 min on CI
    // db90edaa). A list that changed anywhere is still caught: by the re-enumeration when a mark
    // is lost, and by the check after the loop, and either restarts the scan.
    const prepare = async () => {
      if ((await locator.count()) === 0) await settled()
    }
    const ink = await inkOfText(locator, prepare)
    const failure = failureFor(target, ink)
    if (failure) {
      failures.push(failure)
      await attachTextEvidence(locator, failure)
    }
  }
  await settled()
  if (targets.length === 0 && rootText)
    failures.push({
      text: `${rootText} (no text rendered)`,
      ratio: 0,
      required: 4.5,
      painted: 0,
    })
  return failures
}

/**
 * Every visible text run, filled field and closed select inside `root` whose painted text is
 * below its WCAG minimum, not painted at all, or painted over a background that is not uniform
 * (refused: the best pixel would not stand for the run). Disabled controls are skipped (WCAG 1.4.3
 * exempts an inactive control), and so is visually hidden text: a 1 px box (`sr-only`), or
 * text inside one, clipped by clip rect(0 0 0 0), clip-path inset(50%) or a 1 px overflow box.
 * An empty field is refused: the caller fills it, and measures its placeholder with
 * `placeholderContrastFailures` first. A target re-rendered mid-measurement is found again by
 * enumerating `root` once more; a changed list of targets restarts the scan. A root that is not
 * shown, or that holds text none of which renders, fails.
 */
export async function textContrastFailures(root: Locator): Promise<ContrastFailure[]> {
  // A root that shows nothing while it holds text fails outright: nothing in it is readable.
  const state = await rootState(root)
  if (!state.visible)
    return state.text
      ? [{ text: `${state.text} (not shown)`, ratio: 0, required: 4.5, painted: 0 }]
      : []
  try {
    // The scan runs over one settled list of targets. If the list changes while a target is
    // measured (a sibling inserted, a run re-rendered with other text), it starts over, so no
    // index can point at a different element; persistent churn ends in an explicit error.
    for (let scan = 0; scan < 5; scan += 1) {
      try {
        return await scanOnce(root, state.text)
      } catch (error) {
        if (!(error instanceof TargetsChanged)) throw error
      }
    }
    throw new Error(
      'painted-contrast: the text under the root kept changing during the scan'
    )
  } finally {
    await root
      .evaluate(
        (scope, tag) =>
          [scope, ...Array.from(scope.querySelectorAll(`[${tag}]`))].forEach((el) =>
            el.removeAttribute(tag)
          ),
        TARGET
      )
      .catch(() => undefined)
  }
}

/** Each visible empty field's placeholder inside `root` below 4.5:1, or not painted. */
export async function placeholderContrastFailures(
  root: Locator
): Promise<ContrastFailure[]> {
  const fields = root.locator('input[placeholder], textarea[placeholder]')
  const failures: ContrastFailure[] = []
  for (const field of await fields.all()) {
    const state = await field.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => {
      const box = el.getBoundingClientRect()
      return {
        shown: box.width > 0 && box.height > 0 && !el.value && Boolean(el.placeholder),
        text: `placeholder ${el.id}: ${el.placeholder.slice(0, 30)}`,
      }
    })
    if (!state.shown) continue
    const ink = await inkOfPlaceholder(field)
    if (!ink || ink.painted === 0 || !ink.uniform || ink.ratio < 4.5)
      failures.push({
        text: ink && !ink.uniform ? `${state.text} (background not uniform)` : state.text,
        ratio: ink ? Math.floor(ink.ratio * 1000) / 1000 : 0,
        required: 4.5,
        painted: ink?.painted ?? 0,
      })
  }
  return failures
}

/** Resolved colors of an element, as the browser computes them. */
export function resolved(target: Locator) {
  return target.evaluate((el) => {
    const style = getComputedStyle(el)
    return { color: style.color, border: style.borderTopColor }
  })
}

/** The rendered color of one pixel of `target`, `inset` CSS pixels in from its top center. */
export async function surfacePixel(target: Locator, inset = 3): Promise<string> {
  const box = (await target.boundingBox())!
  const page = target.page()
  const png = await page.screenshot({
    clip: {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + inset),
      width: 1,
      height: 1,
    },
    animations: 'disabled',
    scale: 'css',
  })
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  }, png.toString('base64'))
}

/**
 * The palette's card surface and card text as computed under the root, as rgb() strings. Story
 * CC-7.9 D1 and D5: each palette field is a `--cc-theme-*` channel triple on `:root` (Default) or
 * on `<html data-theme>`, in light and dark values, so the probe reads what the palette resolves to
 * in the current scheme. An unresolved variable is refused: it would read as transparent black and
 * an equality against it would only compare two failures.
 */
export async function paletteCardColors(
  page: Page
): Promise<{ surface: string; ink: string }> {
  const colors = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'rgb(var(--cc-theme-card-bg))'
    probe.style.color = 'rgb(var(--cc-theme-card-text))'
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const read = { surface: style.backgroundColor, ink: style.color }
    probe.remove()
    const root = getComputedStyle(document.documentElement)
    return {
      ...read,
      declared:
        root.getPropertyValue('--cc-theme-card-bg').trim() !== '' &&
        root.getPropertyValue('--cc-theme-card-text').trim() !== '',
    }
  })
  if (!colors.declared)
    throw new Error(
      'painted-contrast: --cc-theme-card-bg or --cc-theme-card-text is not set'
    )
  return { surface: colors.surface, ink: colors.ink }
}

/** The palette's card surface as computed under the root, as an rgb() string. */
export async function paletteCardSurface(page: Page): Promise<string> {
  return (await paletteCardColors(page)).surface
}

/**
 * What a focus outline around `target` is drawn over: the background of its nearest ancestor that
 * paints one (Story CC-7.9 D7: a card's `data-surface="card"`, else the `data-surface="page"`
 * surface), with that ancestor's `data-surface`. A translucent fill (the sticky bars' `bg-page/95`)
 * counts as its own color, since it sits over the same page color. No painted ancestor is refused.
 */
export async function focusBackdrop(
  target: Locator
): Promise<{ color: string; surface: string | null; node: string }> {
  const backdrop = await target.evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor
      // rgb(r, g, b) or rgba(r, g, b, a): only a fourth channel of 0 is no fill.
      const channels = color.match(/[\d.]+/g)?.map(Number) ?? []
      if (color === 'transparent' || (channels.length === 4 && channels[3] === 0))
        continue
      return {
        color,
        surface: node.closest('[data-surface]')?.getAttribute('data-surface') ?? null,
        node: `${node.tagName.toLowerCase()}[data-testid=${node.getAttribute('data-testid') ?? '-'}]`,
      }
    }
    return null
  })
  if (!backdrop) throw new Error('painted-contrast: no painted surface behind the target')
  return backdrop
}
