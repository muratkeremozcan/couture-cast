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
// changed pixel means nothing was painted. Used by playwright/tests/community-dark-mode.spec.ts.
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

type Clip = { x: number; y: number; width: number; height: number }

async function shot(page: Page, clip: Clip) {
  return (
    await page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' })
  ).toString('base64')
}

/** Compares a shot without the ink (`bare`) with one with it (`inked`), pixel by pixel. */
function compare(page: Page, bare: string, inked: string): Promise<Ink> {
  return page.evaluate(
    async ({ a, b }) => {
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
      const [inkedPx, barePx] = await Promise.all([pixels(a), pixels(b)])
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * channel(d[i]!) +
        0.7152 * channel(d[i + 1]!) +
        0.0722 * channel(d[i + 2]!)
      // Each changed pixel: the luminance under it without the ink, and with it.
      const pairs: [number, number][] = []
      for (let i = 0; i < inkedPx.length; i += 4) {
        const changed =
          Math.abs(inkedPx[i]! - barePx[i]!) +
          Math.abs(inkedPx[i + 1]! - barePx[i + 1]!) +
          Math.abs(inkedPx[i + 2]! - barePx[i + 2]!)
        if (changed > 0) pairs.push([luminance(barePx, i), luminance(inkedPx, i)])
      }
      const painted = pairs.length
      // The background is the median under the ink; uniform when 95% of the ink sits within
      // 15% of it (an antialiased edge over a 1 px border is allowed, a background that changes
      // under the text is not). The ratio is read over that background only.
      const under = pairs.map(([bare]) => bare).sort((x, y) => x - y)
      const median = under[Math.floor(under.length / 2)] ?? 0
      const near = (value: number) =>
        Math.max(value + 0.05, median + 0.05) / Math.min(value + 0.05, median + 0.05) <=
        1.15
      const onBackground = pairs.filter(([bare]) => near(bare))
      const uniform = painted === 0 || onBackground.length >= 0.95 * painted
      let ratio = 1
      for (const [bare, ink] of onBackground)
        ratio = Math.max(
          ratio,
          (Math.max(bare, ink) + 0.05) / (Math.min(bare, ink) + 0.05)
        )
      return { painted, ratio, uniform }
    },
    { a: inked, b: bare }
  )
}

/**
 * Measures one ink of `target` inside its own box (plus `margin`). `prepare` runs first on every
 * attempt (it re-marks enumerated targets after a re-render); `bare` and `inked` put the page in
 * the two states, in that order. A re-render that replaces the node between the shots is detected
 * through the mark and measured again.
 */
async function measure(
  target: Locator,
  states: { bare: () => Promise<void>; inked: () => Promise<void> },
  options: { margin?: number; prepare?: () => Promise<void> } = {}
): Promise<Ink | null> {
  const margin = options.margin ?? 0
  const page = target.page()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await options.prepare?.()
    if ((await target.count()) === 0) continue
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 2_000 })
    } catch (error) {
      // Replaced between the lookup and the scroll: look it up again.
      if (/not attached|detached/i.test(String(error))) continue
      throw error
    }
    // A sticky bar or overlay over the box would be measured in its place: refuse that.
    const cover = await target.evaluate((el) => {
      const r = el.getBoundingClientRect()
      for (const fx of [0.5, 0.15, 0.85]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2)
        if (hit && !el.contains(hit) && !hit.contains(el)) {
          const id = hit.closest('[data-testid]')?.getAttribute('data-testid') ?? ''
          return `${hit.tagName.toLowerCase()} in ${id}`
        }
      }
      return null
    })
    if (cover)
      throw new Error(`painted-contrast: the measured element is covered by ${cover}`)
    const box = await target.boundingBox()
    if (!box || box.width === 0 || box.height === 0) return null
    const viewport = page.viewportSize()!
    const x = Math.max(0, box.x - margin)
    const y = Math.max(0, box.y - margin)
    const clip = {
      x,
      y,
      width: Math.min(viewport.width, box.x + box.width + margin) - x,
      height: Math.min(viewport.height, box.y + box.height + margin) - y,
    }
    if (clip.width <= 0 || clip.height <= 0) return null
    const handle = await target.elementHandle()
    await handle.evaluate((el, mark) => el.setAttribute(mark, ''), MARK)
    try {
      await states.bare()
      const bare = await shot(page, clip)
      await states.inked()
      const inked = await shot(page, clip)
      await setInkStyle(page, '')
      const ink = await compare(page, bare, inked)
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

const textStates = (page: Page) => ({
  bare: () => setInkStyle(page, `${DESCENDANT_TEXT_OFF}\n${OWN_TEXT_OFF}`),
  inked: () => setInkStyle(page, DESCENDANT_TEXT_OFF),
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

/**
 * How much of `target`'s text paints, against a clone of it with the same font, black on white,
 * outside every clipping ancestor: 1 means all of it, a partly clipped label reads far lower.
 */
export async function inkCoverage(target: Locator): Promise<number> {
  const page = target.page()
  const actual = await inkOfText(target)
  const reference = await target.evaluate((el) => {
    const style = getComputedStyle(el)
    const clone = el.cloneNode(true) as HTMLElement
    clone.removeAttribute('data-testid')
    // Each property that can clip, fade or move the text is reset; nothing that sets the glyph
    // fill inline, so the measurement's own fill rule still applies to the clone.
    for (const [property, value] of [
      ['clip-path', 'none'],
      ['clip', 'auto'],
      ['mask', 'none'],
      ['opacity', '1'],
      ['filter', 'none'],
      ['transform', 'none'],
      ['overflow', 'visible'],
      ['visibility', 'visible'],
      ['position', 'static'],
      ['margin', '0'],
      ['padding', '0'],
      ['border', '0'],
      ['background', 'none'],
      ['width', 'auto'],
      ['height', 'auto'],
      ['font', style.font],
      ['letter-spacing', style.letterSpacing],
      ['word-spacing', style.wordSpacing],
      ['text-transform', style.textTransform],
      ['white-space', 'pre'],
      ['color', '#000'],
      ['display', 'inline-block'],
    ] as const)
      clone.style.setProperty(property, value, 'important')
    const holder = document.createElement('div')
    holder.dataset.testid = 'tea-ink-reference'
    holder.setAttribute(
      'style',
      'all: initial; position: fixed; left: 8px; top: 8px; z-index: 2147483647; background: #fff; padding: 4px;'
    )
    holder.append(clone)
    document.body.append(holder)
    return true
  })
  try {
    const clone = page.getByTestId('tea-ink-reference').locator(':scope > *')
    const ref = reference ? await inkOfText(clone) : null
    if (!actual || !ref || ref.painted === 0) return 0
    return actual.painted / ref.painted
  } finally {
    await page.evaluate(() =>
      document.querySelector('[data-testid="tea-ink-reference"]')?.remove()
    )
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

/**
 * Every visible text run, filled field and closed select inside `root` whose painted text is
 * below its WCAG minimum, not painted at all, or painted over a background that is not uniform
 * (refused: the best pixel would not stand for the run). Disabled controls are skipped (WCAG 1.4.3
 * exempts an inactive control), and so is visually hidden text that keeps only a 1 px box
 * (`sr-only`). An empty field is refused: the caller fills it, and measures its placeholder with
 * `placeholderContrastFailures` first. A target re-rendered mid-measurement is found again by
 * enumerating `root` once more.
 */
export async function textContrastFailures(root: Locator): Promise<ContrastFailure[]> {
  const targets = await enumerate(root)
  const page = root.page()
  const failures: ContrastFailure[] = []
  try {
    for (const target of targets) {
      if (target.index < 0) {
        failures.push({ text: target.text, ratio: 0, required: 4.5, painted: 0 })
        continue
      }
      const ink = await inkOfText(
        page.locator(`[${TARGET}="${target.index}"]`),
        async () => {
          await enumerate(root)
        }
      )
      const required = requiredFor(target)
      const text =
        ink && !ink.uniform ? `${target.text} (background not uniform)` : target.text
      if (!ink || ink.painted === 0 || !ink.uniform || ink.ratio < required)
        failures.push({
          text: text.slice(0, 60),
          ratio: ink ? Math.floor(ink.ratio * 1000) / 1000 : 0,
          required,
          painted: ink?.painted ?? 0,
        })
    }
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
  return failures
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

/** The palette's card surface as computed on the root, as an rgb() string. */
export function paletteCardSurface(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--theme-card-bg)'
    document.body.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  })
}
