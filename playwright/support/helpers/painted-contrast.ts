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
import { type Locator, type Page } from '@playwright/test'

export type ContrastFailure = {
  text: string
  ratio: number
  required: number
  painted: number
}

/** `uniform`: the background under the changed pixels varies by under 15% in contrast terms. */
export type Ink = { painted: number; ratio: number; uniform: boolean }

const MARK = 'data-tea-ink'
const TARGET = 'data-tea-target'
const STYLE_ID = 'tea-ink-style'
// Glyph fill only: color, and every currentColor border or decoration with it, is left alone.
const FILL_OFF =
  '-webkit-text-fill-color: transparent !important; text-shadow: none !important;'
// Descendants' glyphs stay hidden in both shots, so only the marked element's own text differs.
const DESCENDANT_TEXT_OFF = `[${MARK}] * { ${FILL_OFF} }`
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
 * every finite animation and transition finished (at most a second; spinners never finish and are
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
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
  })
  await nextFrames(page)
}

type Clip = { x: number; y: number; width: number; height: number }

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
function compare(page: Page, bare: string, inked: string, mask?: string): Promise<Ink> {
  return page.evaluate(
    async ({ a, b, m }) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [inkedPx, barePx, maskPx] = await Promise.all([
        pixels(a),
        pixels(b),
        m ? pixels(m) : Promise.resolve(null),
      ])
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
      let painted = 0
      const changedPairs: [number, number][] = []
      const maskPairs: [number, number][] = []
      for (let i = 0; i < inkedPx.length; i += 4) {
        const pair: [number, number] = [luminance(barePx, i), luminance(inkedPx, i)]
        if (differs(inkedPx, barePx, i)) {
          painted += 1
          changedPairs.push(pair)
        }
        if (maskPx && differs(maskPx, barePx, i)) maskPairs.push(pair)
      }
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
      const rate = (glyphs: [number, number][]): number[] => {
        // Each background region is rated on its own. Glyph pixels are grouped by the exact
        // luminance under them, and each group by its strongest stem (the pixel whose ink differs
        // most from its own background, which is where a translucent text color is painted over
        // that region); the text takes its weakest group. A group needs 3% of the glyph pixels
        // (and at least 8) to count, so a few antialiased pixels cannot decide the result. The glyph
        // pixels left outside every counted group (a gradient beside a flat region, or a gradient
        // alone) are rated too once they reach 5% of the label: in 2% steps, each step's stem held
        // against every background in it.
        type Group = { count: number; strongest: number; ink: number; unders: number[] }
        const groupBy = (
          sample: [number, number][],
          keyOf: (under: number) => number
        ) => {
          const groups = new Map<number, Group>()
          for (const [under, inked] of sample) {
            const key = keyOf(under)
            let group = groups.get(key)
            if (!group) {
              group = { count: 0, strongest: 1, ink: inked, unders: [] }
              groups.set(key, group)
            }
            group.count += 1
            group.unders.push(under)
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
        const exactKeys = new Set<number>()
        const rated: number[] = []
        for (const group of groupBy(glyphs, (under) => under))
          if (group.count >= floor) {
            rated.push(group.strongest)
            exactKeys.add(group.unders[0]!)
          }
        const remainder = glyphs.filter(([under]) => !exactKeys.has(under))
        if (remainder.length >= Math.max(8, 0.05 * glyphs.length)) {
          const steps = groupBy(remainder, (under) =>
            Math.round(Math.log(under + 0.05) / Math.log(1.02))
          )
          const counted = steps.filter((group) => group.count >= floor)
          for (const group of counted.length > 0 ? counted : steps)
            rated.push(worstOf(group))
        }
        // A glyph too small for either floor (a period paints a few pixels) is still rated: each
        // exact background under it by its own strongest stem.
        if (rated.length === 0)
          for (const group of groupBy(glyphs, (under) => under))
            rated.push(group.strongest)
        return rated
      }
      const rated = rate(onBackground)
      let ratio = rated.length > 0 ? Infinity : 1
      for (const value of rated) ratio = Math.min(ratio, value)
      return { painted, ratio, uniform }
    },
    { a: inked, b: bare, m: mask ?? null }
  )
}

type States = {
  bare: () => Promise<void>
  inked: () => Promise<void>
  mask?: () => Promise<void>
}

/**
 * The region to shoot: the element's box plus `margin`, in the viewport. 'detached' when the
 * node was replaced between the lookup and the scroll; null when it has no box on screen. A sticky
 * bar or overlay over the box would be measured in its place, so a covered element is refused.
 */
async function clipFor(
  target: Locator,
  margin: number
): Promise<Clip | null | 'detached'> {
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 2_000 })
  } catch (error) {
    if (/not attached|detached/i.test(String(error))) return 'detached'
    throw error
  }
  const cover = await target.evaluate((el) => {
    // Centred first: scrolled only into view, text at the bottom edge lands under a fixed tab
    // bar (CC-7.9 shell spec, CI c9614d98) and would be refused as covered.
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
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
      for (const fx of [0.5, 0.15, 0.85]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2)
        if (hit && !el.contains(hit) && !hit.contains(el)) {
          const id = hit.closest('[data-testid]')?.getAttribute('data-testid') ?? ''
          return `${hit.tagName.toLowerCase()} in ${id}`
        }
      }
      return null
    } finally {
      if (previous) own.style.setProperty('pointer-events', previous, priority)
      else own.style.removeProperty('pointer-events')
    }
  })
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
async function takeShots(page: Page, clip: Clip, states: States): Promise<Ink> {
  await states.bare()
  const bare = await shot(page, clip)
  await states.inked()
  const inked = await shot(page, clip)
  let mask: string | undefined
  if (states.mask) {
    await states.mask()
    mask = await shot(page, clip)
  }
  await setInkStyle(page, '')
  return compare(page, bare, inked, mask)
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
  options: { margin?: number; prepare?: () => Promise<void> } = {}
): Promise<Ink | null> {
  const margin = options.margin ?? 0
  const page = target.page()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await options.prepare?.()
    if ((await target.count()) === 0) continue
    const clip = await clipFor(target, margin)
    if (clip === 'detached') continue
    if (!clip) return null
    const handle = await target.elementHandle()
    await handle.evaluate((el, mark) => el.setAttribute(mark, ''), MARK)
    try {
      await settle(page)
      const ink = await takeShots(page, clip, states)
      const stable = await handle.evaluate(
        (el, mark) => el.isConnected && el.hasAttribute(mark),
        MARK
      )
      // Nothing changed is read once more before it counts as unpainted: a frame that had not
      // repainted yet reads the same way. A label that is really hidden reads zero again.
      if (stable && (ink.painted > 0 || attempt > 0)) return ink
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
 * A keyboard focus indicator as a reader sees it appear: the element's area before focus and
 * after `focusWithKeyboard`, with every normal decoration in both shots, so a permanent shadow or
 * border is no indicator. `painted` counts the pixels focus changes.
 */
export function focusRing(
  target: Locator,
  focusWithKeyboard: () => Promise<void>
): Promise<Ink | null> {
  const page = target.page()
  return measure(
    target,
    {
      bare: async () => {
        await target.evaluate((el) => (el as HTMLElement).blur())
        await nextFrames(page)
      },
      inked: async () => {
        await focusWithKeyboard()
        await nextFrames(page)
      },
    },
    { margin: 10 }
  )
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
    const measurable = (el: Element) => {
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return (
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        !el.closest(':disabled') &&
        !(el instanceof HTMLOptionElement)
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
    const ink = await inkOfText(page.locator(`[${TARGET}="${target.index}"]`), settled)
    const failure = failureFor(target, ink)
    if (failure) failures.push(failure)
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
 * exempts an inactive control), and so is visually hidden text that keeps only a 1 px box
 * (`sr-only`). An empty field is refused: the caller fills it, and measures its placeholder with
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
