// Rendered-pixel contrast for Playwright specs: what Chromium paints, not what CSS declares.
//
// Each measurement takes two screenshots of the same region: one as rendered, and one with only
// the ink under test made transparent by an injected rule (an element's own text, a field's
// placeholder, or a focus outline). The region's pixels that change are that ink; each is compared
// with the pixel at the same place without it, so group opacity, translucent colors, gradients,
// clip-paths and antialiasing all come out as painted. The highest per-pixel WCAG ratio stands
// for the ink (a glyph's stem reaches its full color), compared unrounded; no changed pixel means
// nothing was painted. Used by playwright/tests/community-dark-mode.spec.ts.
import { type Locator, type Page } from '@playwright/test'

export type ContrastFailure = {
  text: string
  ratio: number
  required: number
  painted: number
}

type Ink = { painted: number; ratio: number }

const MARK = 'data-tea-ink'
const TARGET = 'data-tea-target'
const STYLE_ID = 'tea-ink-style'
// Descendants' own text stays hidden in both shots, so only the marked element's text differs.
const DESCENDANT_TEXT_OFF = `[${MARK}] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }`
const OWN_TEXT_OFF = `[${MARK}] { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }`
const PLACEHOLDER_OFF = `[${MARK}]::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }`
const RING_OFF = `[${MARK}], [${MARK}]:focus-visible { outline: none !important; box-shadow: none !important; }`

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

/** Screenshots `clip` with `shown` and then `hidden` applied, and compares them pixel by pixel. */
async function compareShots(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  shown: string,
  hidden: string
): Promise<Ink> {
  const shot = async (css: string) => {
    await setInkStyle(page, css)
    return (
      await page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'css' })
    ).toString('base64')
  }
  const withInk = await shot(shown)
  const withoutInk = await shot(hidden)
  await setInkStyle(page, '')
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
      const [inked, bare] = await Promise.all([pixels(a), pixels(b)])
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const luminance = (d: Uint8ClampedArray, i: number) =>
        0.2126 * channel(d[i]!) +
        0.7152 * channel(d[i + 1]!) +
        0.0722 * channel(d[i + 2]!)
      let painted = 0
      let ratio = 1
      for (let i = 0; i < inked.length; i += 4) {
        const changed =
          Math.abs(inked[i]! - bare[i]!) +
          Math.abs(inked[i + 1]! - bare[i + 1]!) +
          Math.abs(inked[i + 2]! - bare[i + 2]!)
        if (changed === 0) continue
        painted += 1
        const [hi, lo] = [luminance(inked, i), luminance(bare, i)].sort((x, y) => y - x)
        ratio = Math.max(ratio, (hi! + 0.05) / (lo! + 0.05))
      }
      return { painted, ratio }
    },
    { a: withInk, b: withoutInk }
  )
}

/**
 * Marks the element, measures one ink of it inside its own box (plus `margin`), unmarks it. A
 * re-render that replaces the element between the two shots drops the mark and makes them equal,
 * so the measurement counts only when the same marked node is still attached afterwards; it is
 * taken again otherwise.
 */
async function measure(
  target: Locator,
  shown: string,
  hidden: string,
  margin = 0
): Promise<Ink | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await target.scrollIntoViewIfNeeded()
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
    const page = target.page()
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
      const ink = await compareShots(page, clip, shown, hidden)
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

/** The painted contrast of an element's own text (or a field's value, or a closed select's choice). */
export function inkOfText(target: Locator): Promise<Ink | null> {
  return measure(target, DESCENDANT_TEXT_OFF, `${DESCENDANT_TEXT_OFF}\n${OWN_TEXT_OFF}`)
}

/** The painted contrast of an empty field's placeholder over the field. */
export function inkOfPlaceholder(field: Locator): Promise<Ink | null> {
  return measure(field, '', PLACEHOLDER_OFF)
}

/**
 * A focused element's ring as painted: the pixels its outline and halo change around it, against
 * the same pixels without them. `painted` counts those pixels; none means no visible ring.
 */
export function focusRing(target: Locator): Promise<Ink | null> {
  return measure(target, '', RING_OFF, 10)
}

const requiredFor = (style: { fontSize: string; fontWeight: string }) => {
  const size = parseFloat(style.fontSize)
  return size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5
}

/**
 * Every visible text run, filled field and closed select inside `root` whose painted text is
 * below its WCAG minimum, or not painted at all. Disabled controls are skipped (WCAG 1.4.3 exempts
 * an inactive control), and so is visually hidden text that keeps only a 1 px box (`sr-only`):
 * a label clipped any other way is measured, and fails when nothing of it is painted. An empty
 * field is refused: the caller fills it, and measures its placeholder with
 * `placeholderContrastFailures` first.
 */
export async function textContrastFailures(root: Locator): Promise<ContrastFailure[]> {
  const targets = await root.evaluate((scope, tag) => {
    const found: { index: number; text: string; fontSize: string; fontWeight: string }[] =
      []
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
      if (!measurable(el)) return
      const style = getComputedStyle(el)
      const own = textOf(el)
      if (own === null) {
        found.push({
          index: -1 - index,
          text: `empty ${el.tagName.toLowerCase()} ${el.id}`,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        })
        return
      }
      const text = own
      if (text) {
        el.setAttribute(tag, String(index))
        found.push({
          index,
          text,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        })
      }
    })
    return found
  }, TARGET)
  const failures: ContrastFailure[] = []
  for (const target of targets) {
    if (target.index < 0) {
      failures.push({ text: target.text, ratio: 0, required: 4.5, painted: 0 })
      continue
    }
    const ink = await inkOfText(root.page().locator(`[${TARGET}="${target.index}"]`))
    const required = requiredFor(target)
    if (!ink || ink.painted === 0 || ink.ratio < required)
      failures.push({
        text: target.text.slice(0, 40),
        ratio: ink ? Math.floor(ink.ratio * 1000) / 1000 : 0,
        required,
        painted: ink?.painted ?? 0,
      })
  }
  await root.evaluate(
    (scope, tag) =>
      [scope, ...Array.from(scope.querySelectorAll(`[${tag}]`))].forEach((el) =>
        el.removeAttribute(tag)
      ),
    TARGET
  )
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
    if (!ink || ink.painted === 0 || ink.ratio < 4.5)
      failures.push({
        text: state.text,
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
