// Story CC-7.10 D3 owner: the one screen budget measure web and native both run.
// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
/**
 * Story CC-7.10 D3 (amended by the TEA pushback P1 to P5): counts what a screen shows a member,
 * read from layout and computed styles only, never from class names.
 *
 * `measureScreenBudget` is one self-contained function: Playwright serializes it into the page
 * (`page.evaluate(measureScreenBudget, config)`), so its body references nothing outside itself
 * and everything it needs arrives in `config`. The native suite calls the same function on the
 * react-native-web DOM, where `testID` renders as `data-testid` and RN styles as computed CSS.
 * `screenBudgetMeasureConfig` in `screen-budget.ts` builds the config from `screen-budget.json`,
 * and `evaluateScreenBudget` there turns the result into pass or fail.
 *
 * Coverage: this file needs a layout engine, so the utils node coverage excludes it
 * (`packages/utils/vitest.config.ts`). Its proof is TEA's
 * `playwright/tests/screen-budget-rules.spec.ts`, which runs every rule on synthetic DOM in
 * Chromium with a passing and a failing control.
 */

/** One offending or counted element: its stable key and, where useful, a measured detail. */
export interface ScreenBudgetElement {
  /** `data-testid`, else the tag plus the first 40 characters of its text (P7). */
  readonly key: string
  readonly detail?: string
}

export interface ScreenBudgetParagraph extends ScreenBudgetElement {
  /** Distinct line boxes of the block's own text, inline children included (P5). */
  readonly lines: number
}

export interface ScreenBudgetMeasureConfig {
  /** The fold and the visible area: 390 x 844 (D3, AC1). */
  readonly viewport: { readonly width: number; readonly height: number }
  /** The bottom tab bar: nothing inside it is measured. */
  readonly tabBarSelectors: readonly string[]
  /**
   * Garment, saved-look and Community look tiles (P1): targets, chip rows and paragraphs inside
   * one are not measured; primary buttons and card-in-card still are.
   */
  readonly tileSelectors: readonly string[]
  /**
   * CSS values that resolve to each token in this document (P4): web passes
   * `rgb(var(--cc-primary))` so the live variables decide, native passes the role's value. A
   * probe element turns each into the engine's computed form before any compare.
   */
  readonly tokens: {
    readonly primary: string
    readonly card: string
    readonly cardMuted: string
    readonly cardShadow: string
  }
  /** A card is at least this wide and tall (D3: 64). */
  readonly minCardSizePx: number
  /** Today only: `selector` null reads the document scroll height, else that element's. */
  readonly todayHeight?: { readonly selector: string | null }
  /** Closet only: the garment grid or the empty-closet block, whichever renders. */
  readonly closetChrome?: { readonly anchors: readonly string[] }
  /** The subtree to measure; the document body when omitted. */
  readonly rootSelector?: string
}

export interface ScreenBudgetMeasurement {
  /** Visible interactive targets above the fold, tab bar and tiles excluded, nesting once. */
  readonly targetsAboveFold: readonly ScreenBudgetElement[]
  /** Rendered targets anywhere on the screen whose background is the primary token. */
  readonly primaryButtons: readonly ScreenBudgetElement[]
  /** Rows of two or more pills, one of them selectable, one entry per row container. */
  readonly chipRows: readonly ScreenBudgetElement[]
  /** Cards with a card ancestor, one entry per inner card. */
  readonly nestedCards: readonly ScreenBudgetElement[]
  /** Every measured paragraph of two or more lines, with its line count. */
  readonly paragraphs: readonly ScreenBudgetParagraph[]
  /** Today's scroll height in px, when the config asks for it. */
  readonly todayHeight?: number
  /** The Closet anchor's top in px from the top of the page at scroll 0, when asked. */
  readonly closetChrome?: number
  /** Floors for the callers (R1): what was found and excluded. */
  readonly stats: {
    readonly tabBarTargets: number
    readonly tileTargets: number
    readonly cards: number
  }
  /** A token that did not resolve or an anchor that is missing; each fails the audit. */
  readonly errors: readonly string[]
}

/**
 * Measures the screen as it stands. Waits for `document.fonts.ready`, measures at scroll 0 and
 * restores the scroll position it found.
 */
export async function measureScreenBudget(
  config: ScreenBudgetMeasureConfig
): Promise<ScreenBudgetMeasurement> {
  const doc = document
  const win = window
  if (doc.fonts) await doc.fonts.ready

  const errors: string[] = []
  const root: Element =
    (config.rootSelector ? doc.querySelector(config.rootSelector) : null) ?? doc.body
  if (config.rootSelector && root === doc.body)
    errors.push(`root ${config.rootSelector} missing`)
  const viewW = config.viewport.width
  const viewH = config.viewport.height
  const startX = win.scrollX
  const startY = win.scrollY
  win.scrollTo(0, 0)

  const transparent = (value: string) =>
    value === 'transparent' ||
    /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(value) ||
    /\/\s*0\s*\)$/.test(value)

  // P4: each token in the computed form this engine gives an element, read through a probe.
  const resolveTokens = () => {
    const probe = doc.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1px;height:1px;pointer-events:none;'
    doc.body.appendChild(probe)
    const resolve = (property: 'backgroundColor' | 'boxShadow', value: string) => {
      probe.style[property] = ''
      probe.style[property] = value
      return win.getComputedStyle(probe)[property]
    }
    const tokenColor = (name: string, value: string) => {
      const computed = resolve('backgroundColor', value)
      if (!computed || transparent(computed)) {
        errors.push(`token ${name} did not resolve (${value})`)
        return null
      }
      return computed
    }
    const primary = tokenColor('primary', config.tokens.primary)
    const cardColors = [
      tokenColor('card', config.tokens.card),
      tokenColor('cardMuted', config.tokens.cardMuted),
    ].filter((value): value is string => value !== null)
    const cardShadowRaw = resolve('boxShadow', config.tokens.cardShadow)
    const cardShadow = cardShadowRaw && cardShadowRaw !== 'none' ? cardShadowRaw : null
    if (!cardShadow)
      errors.push(`token cardShadow did not resolve (${config.tokens.cardShadow})`)
    probe.remove()
    return { primary, cardColors, cardShadow }
  }
  const { primary, cardColors, cardShadow } = resolveTokens()

  const styleCache = new Map<Element, CSSStyleDeclaration>()
  const style = (el: Element) => {
    let cs = styleCache.get(el)
    if (!cs) {
      cs = win.getComputedStyle(el)
      styleCache.set(el, cs)
    }
    return cs
  }
  const insideAny = (el: Element, selectors: readonly string[]) =>
    selectors.some((selector) => el.closest(selector) !== null)
  const inTabBar = (el: Element) => insideAny(el, config.tabBarSelectors)
  const inTile = (el: Element) => insideAny(el, config.tileSelectors)

  const textOf = (el: Element) => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt', 'value']) {
      const value = el.getAttribute(attribute)?.replace(/\s+/g, ' ').trim()
      if (value) return value
    }
    return ''
  }
  // P7: the testid, else the tag plus the first 40 characters of its text.
  const keyOf = (el: Element) => {
    const testId = el.getAttribute('data-testid')
    if (testId) return testId
    const tag = el.tagName.toLowerCase()
    const text = textOf(el).slice(0, 40)
    return text ? `${tag} "${text}"` : tag
  }

  // P3: rendered means laid out with a box, not sr-only, not inside aria-hidden or inert, and
  // painted (visibility visible, opacity above 0 on it and every ancestor).
  const srOnly = (el: Element, rect: DOMRect) => {
    const cs = style(el)
    if (rect.width <= 1 || rect.height <= 1) return true
    if (/rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip))
      return true
    return /inset\(\s*50%/.test(cs.clipPath)
  }
  const painted = (el: Element) => {
    const check = (el as Element & { checkVisibility?: (options: object) => boolean })
      .checkVisibility
    if (check) return check.call(el, { opacityProperty: true, visibilityProperty: true })
    if (style(el).visibility !== 'visible') return false
    for (let node: Element | null = el; node; node = node.parentElement) {
      const cs = style(node)
      if (cs.display === 'none' || Number(cs.opacity) === 0) return false
    }
    return true
  }
  const rendered = (el: Element) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    if (srOnly(el, rect)) return false
    return painted(el)
  }
  // P3: in the viewport at scroll 0 and not clipped away by an overflow ancestor (a horizontal
  // scroller, a collapsed panel).
  const inView = (el: Element) => {
    const rect = el.getBoundingClientRect()
    let left = Math.max(rect.left, 0)
    let top = Math.max(rect.top, 0)
    let right = Math.min(rect.right, viewW)
    let bottom = Math.min(rect.bottom, viewH)
    for (
      let node = el.parentElement;
      node && node !== doc.body && node !== doc.documentElement;
      node = node.parentElement
    ) {
      const cs = style(node)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const clip = node.getBoundingClientRect()
      if (cs.overflowX !== 'visible') {
        left = Math.max(left, clip.left)
        right = Math.min(right, clip.right)
      }
      if (cs.overflowY !== 'visible') {
        top = Math.max(top, clip.top)
        bottom = Math.min(bottom, clip.bottom)
      }
    }
    return right > left && bottom > top
  }

  // D3: the interactive target definition, the same on both platforms.
  const TARGET_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    ...['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option'].map(
      (role) => `[role="${role}"]`
    ),
  ].join(', ')
  const isTarget = (el: Element) => {
    if (el.matches(TARGET_SELECTOR)) return true
    const tabIndex = el.getAttribute('tabindex')
    return tabIndex !== null && Number.parseInt(tabIndex, 10) >= 0
  }
  const insideTarget = (el: Element) => {
    for (let node = el.parentElement; node; node = node.parentElement)
      if (isTarget(node)) return true
    return false
  }

  const all = Array.from(root.querySelectorAll('*')).filter((el) => !inTabBar(el))
  const collectTargets = () => {
    const tabBarTargets = Array.from(root.querySelectorAll('*')).filter(
      (el) => inTabBar(el) && isTarget(el) && rendered(el)
    ).length

    // A visually hidden control (sr-only, opacity 0, display none) counts as its rendered label.
    const resolvedTargets: Element[] = []
    for (const el of all) {
      if (!isTarget(el)) continue
      if (rendered(el)) {
        resolvedTargets.push(el)
        continue
      }
      const labels = (el as HTMLInputElement).labels
      if (labels)
        for (const label of Array.from(labels))
          if (!inTabBar(label) && rendered(label)) resolvedTargets.push(label)
    }
    const uniqueTargets = Array.from(new Set(resolvedTargets))
    const targetSet = new Set(uniqueTargets)
    // Nested targets count once: the outermost.
    const outermost = uniqueTargets.filter((el) => {
      for (let node = el.parentElement; node; node = node.parentElement)
        if (targetSet.has(node)) return false
      return true
    })
    const tileTargets = outermost.filter(inTile).length
    const targetsAboveFold = outermost
      .filter((el) => !inTile(el) && inView(el))
      .map((el) => ({ key: keyOf(el) }))
    return { tabBarTargets, uniqueTargets, targetSet, tileTargets, targetsAboveFold }
  }
  const { tabBarTargets, uniqueTargets, targetSet, tileTargets, targetsAboveFold } =
    collectTargets()

  // D3 primary: background is the primary token, anywhere on the screen, tiles included (P1).
  // A gold target inside a gold target is one button; a gold one inside a plain link counts.
  const gold = (el: Element) => primary !== null && style(el).backgroundColor === primary
  const goldAncestor = (el: Element) => {
    for (let node = el.parentElement; node; node = node.parentElement)
      if (targetSet.has(node) && gold(node)) return true
    return false
  }
  const primaryButtons = uniqueTargets
    .filter((el) => gold(el) && !goldAncestor(el))
    .map((el) => ({ key: keyOf(el) }))

  // D3 chip row (P2): pills grouped by their nearest common row container.
  const verticalRadius = (value: string, height: number) => {
    const parts = value.trim().split(/\s+/)
    const vertical = parts[1] ?? parts[0] ?? '0'
    const amount = Number.parseFloat(vertical)
    if (Number.isNaN(amount)) return 0
    return vertical.endsWith('%') ? (amount / 100) * height : amount
  }
  const isPill = (el: Element) => {
    const rect = el.getBoundingClientRect()
    const cs = style(el)
    const radius = Math.min(
      verticalRadius(cs.borderTopLeftRadius, rect.height),
      verticalRadius(cs.borderBottomRightRadius, rect.height)
    )
    return rect.height > 0 && radius >= rect.height / 2 - 0.5
  }
  const SELECTION_ATTRIBUTES = [
    'aria-pressed',
    'aria-checked',
    'aria-selected',
    'aria-current',
  ]
  const SELECTION_ROLES = ['radio', 'tab', 'option']
  const selectable = (el: Element) =>
    SELECTION_ATTRIBUTES.some((attribute) => el.hasAttribute(attribute)) ||
    SELECTION_ROLES.includes(el.getAttribute('role') ?? '')
  const ROW_ROLES = ['group', 'radiogroup', 'tablist', 'listbox']
  const rowContainer = (el: Element) => {
    if (ROW_ROLES.includes(el.getAttribute('role') ?? '')) return true
    return /^(inline-)?(flex|grid)$/.test(style(el).display)
  }
  // A row is two or more pills in one container, at least one carrying a selection state: a
  // row of links marks only its active chip (`aria-current`), and a row of CTA pills with no
  // selected member is not a chip row (M3).
  const measureChipRows = () => {
    const pills = uniqueTargets.filter((el) => !inTile(el) && isPill(el))
    const rows = new Map<Element, Element[]>()
    for (const pill of pills) {
      for (let node = pill.parentElement; node; node = node.parentElement) {
        if (!rowContainer(node)) continue
        if (!pills.some((other) => other !== pill && node.contains(other))) continue
        const members = rows.get(node)
        if (members) members.push(pill)
        else rows.set(node, [pill])
        break
      }
    }
    return Array.from(rows)
      .filter(([, members]) => members.length >= 2 && members.some(selectable))
      .map(([row, members]) => ({ key: keyOf(row), detail: `${members.length} chips` }))
  }
  const chipRows = measureChipRows()

  // D3 card: a non-interactive box of at least 64 x 64 with a radius whose background is the
  // card or cardMuted token or that casts the card shadow.
  const hasRadius = (cs: CSSStyleDeclaration) =>
    [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomLeftRadius,
      cs.borderBottomRightRadius,
    ].some((value) => Number.parseFloat(value) > 0)
  const isCard = (el: Element) => {
    if (isTarget(el)) return false
    const rect = el.getBoundingClientRect()
    if (rect.width < config.minCardSizePx || rect.height < config.minCardSizePx)
      return false
    const cs = style(el)
    if (!hasRadius(cs)) return false
    const background = cardColors.includes(cs.backgroundColor)
    const shadow = cardShadow !== null && cs.boxShadow.includes(cardShadow)
    return (background || shadow) && rendered(el)
  }
  const cards = all.filter(isCard)
  // A card inside a card is a visible second level: its box differs from the outer card's by
  // more than 1 px on a side, and it has its own background, the card shadow or a visible border.
  // react-native-web often wraps a card's content in a View with the same box and color, which is
  // one card on screen.
  const visibleBorder = (cs: CSSStyleDeclaration) =>
    (['Top', 'Right', 'Bottom', 'Left'] as const).some(
      (side) =>
        Number.parseFloat(cs[`border${side}Width`]) > 0 &&
        cs[`border${side}Style`] !== 'none' &&
        cs[`border${side}Style`] !== 'hidden' &&
        !transparent(cs[`border${side}Color`])
    )
  const secondLevel = (inner: Element, outer: Element) => {
    const a = inner.getBoundingClientRect()
    const b = outer.getBoundingClientRect()
    const ownBox =
      Math.abs(a.left - b.left) > 1 ||
      Math.abs(a.top - b.top) > 1 ||
      Math.abs(a.right - b.right) > 1 ||
      Math.abs(a.bottom - b.bottom) > 1
    if (!ownBox) return false
    const cs = style(inner)
    return (
      cs.backgroundColor !== style(outer).backgroundColor ||
      (cardShadow !== null && cs.boxShadow.includes(cardShadow)) ||
      visibleBorder(cs)
    )
  }
  const measureNestedCards = () => {
    const cardSet = new Set(cards)
    const nestedCards: ScreenBudgetElement[] = []
    for (const card of cards) {
      for (let node = card.parentElement; node; node = node.parentElement) {
        if (!cardSet.has(node)) continue
        if (secondLevel(card, node))
          nestedCards.push({ key: keyOf(card), detail: `inside ${keyOf(node)}` })
        break
      }
    }
    return nestedCards
  }
  const nestedCards = measureNestedCards()

  // D3 paragraph (P5): a block that owns text, its lines counted from the text's own boxes.
  const inlineDisplay = (el: Element) => {
    const display = style(el).display
    return display === 'inline' || display === 'contents' || display.startsWith('ruby')
  }
  const blockOwner = (node: Node) => {
    let el = node.parentElement
    while (el && el !== root && inlineDisplay(el)) el = el.parentElement
    return el
  }
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]'
  const isParagraph = (owner: Element) =>
    !inTabBar(owner) &&
    !inTile(owner) &&
    !isTarget(owner) &&
    !insideTarget(owner) &&
    !owner.closest(HEADING_SELECTOR) &&
    !owner.closest('label, legend') &&
    rendered(owner)
  const countLines = (owner: Element, nodes: readonly Text[]) => {
    const ownerRect = owner.getBoundingClientRect()
    const clipsOwnText = style(owner).overflowY !== 'visible'
    const boxes: DOMRect[] = []
    for (const node of nodes) {
      const range = doc.createRange()
      range.selectNodeContents(node)
      for (const box of Array.from(range.getClientRects())) {
        if (box.width <= 0 || box.height <= 0) continue
        // Clamped text counts its rendered lines only.
        const middle = (box.top + box.bottom) / 2
        if (clipsOwnText && (middle < ownerRect.top || middle > ownerRect.bottom))
          continue
        boxes.push(box)
      }
    }
    boxes.sort((a, b) => a.top - b.top)
    let lines = 0
    let lineTop = Number.NEGATIVE_INFINITY
    let lineBottom = Number.NEGATIVE_INFINITY
    for (const box of boxes) {
      // A new line box starts more than 2 px below the current one's top and below its middle,
      // so a smaller inline run on the same line does not count as a line of its own.
      if (box.top > lineTop + 2 && (box.top + box.bottom) / 2 > lineBottom) {
        lines += 1
        lineTop = box.top
        lineBottom = box.bottom
      } else lineBottom = Math.max(lineBottom, box.bottom)
    }
    return lines
  }
  const measureParagraphs = () => {
    const textNodes = new Map<Element, Text[]>()
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue
      const owner = blockOwner(node)
      if (!owner) continue
      const list = textNodes.get(owner)
      if (list) list.push(node as Text)
      else textNodes.set(owner, [node as Text])
    }
    const paragraphs: ScreenBudgetParagraph[] = []
    for (const [owner, nodes] of textNodes) {
      if (!isParagraph(owner)) continue
      const lines = countLines(owner, nodes)
      if (lines >= 2)
        paragraphs.push({ key: keyOf(owner), lines, detail: `${lines} lines` })
    }
    return paragraphs
  }
  const paragraphs = measureParagraphs()

  const measureTodayHeight = (selector: string | null) => {
    if (selector === null)
      return Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)
    const el = doc.querySelector(selector)
    if (el) return el.scrollHeight
    errors.push(`today height element missing: ${selector}`)
    return undefined
  }
  const todayHeight = config.todayHeight
    ? measureTodayHeight(config.todayHeight.selector)
    : undefined

  const measureClosetChrome = (anchors: readonly string[]) => {
    const tops = anchors
      .map((selector) => doc.querySelector(selector))
      .filter((el): el is Element => el !== null && rendered(el))
      .map((el) => el.getBoundingClientRect().top + win.scrollY)
    if (tops.length) return Math.round(Math.min(...tops))
    errors.push(`closet anchor missing: ${anchors.join(', ')}`)
    return undefined
  }
  const closetChrome = config.closetChrome
    ? measureClosetChrome(config.closetChrome.anchors)
    : undefined

  win.scrollTo(startX, startY)
  return {
    targetsAboveFold,
    primaryButtons,
    chipRows,
    nestedCards,
    paragraphs,
    ...(todayHeight === undefined ? {} : { todayHeight }),
    ...(closetChrome === undefined ? {} : { closetChrome }),
    stats: { tabBarTargets, tileTargets, cards: cards.length },
    errors,
  }
}
