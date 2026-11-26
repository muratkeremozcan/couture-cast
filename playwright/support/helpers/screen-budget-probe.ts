// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): the web analytics-only probe (AC3, spec D4 amended by P6),
// used by playwright/tests/screen-budget-home-actions.spec.ts and proved on inline pages by
// screen-budget-rules.spec.ts (7.10-RULE-060..066).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
//
// Each visible target (tab bar excluded) is clicked in a fresh load. An effect is a path or
// search change, a hash change that scrolls, a request the analytics allow list does not match
// (to a path the page had not requested before the click, so a poll is not an effect), a
// dialog, a popup, a download, focus moved to another element, or a DOM change outside the
// control that did not also happen in a one second window with no click. A file chooser gets a
// 1 x 1 PNG and the change handler's effect is what counts. A target with none of these does
// nothing a member can see, whatever analytics it sends.
//
// Deviation from the playwright-utils mandate (no fixed waits): proving that a click had NO
// effect needs a fixed observation window, because no event marks the absence of one. The one
// second window is D4's own definition; it is spent inside the page, never to synchronise.
import type { Dialog, FileChooser, Page, Request } from '@playwright/test'
import { isAnalyticsRequest, type ScreenBudgetElement } from '@couture/utils'

/** D4's window: a click's effect shows within one second. */
export const OBSERVE_MS = 1000
/** The no-click window that marks nodes changing on their own; noise filter only (P6c). */
export const BASELINE_MS = 500

/** How a target is found again in a fresh load (P6e): its testid, else its role and name. */
export interface ProbeTarget extends ScreenBudgetElement {
  readonly testId: string | null
  readonly tag: string
  readonly role: string | null
  readonly name: string
  /** Its testid, else its tag, role and name: what a fresh load matches it by. */
  readonly identity: string
  /** Its position among the targets that share its identity. */
  readonly index: number
}

export interface ProbeResult {
  readonly target: ProbeTarget
  /** Why the click counts as doing something; empty when its only effect was analytics. */
  readonly effects: readonly string[]
  /** The target could not be found or clicked in its fresh load. */
  readonly error?: string
}

/** A 1 x 1 transparent PNG for file choosers. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

/**
 * Every visible, outermost interactive target on the page outside `excludeSelectors` (the tab
 * bar), in document order, with what it takes to find it again. A visually hidden control
 * counts as its rendered label, as in the measure.
 */
/** The attribute that marks the one element a fresh load resolves a target to (Codex #6). */
const MARK = 'data-budget-probe-target'

/**
 * Every visible, outermost interactive target on the page outside `exclude` (the tab bar), in
 * document order, with what it takes to find it again. A visually hidden control counts as its
 * rendered label, as in the measure. With `mark`, the same inventory is taken and the element
 * with the mark's identity and position gets MARK, so a fresh load resolves a target by the very
 * rules that listed it (a hidden copy or a same-name control of another role cannot stand in).
 */
function inventory({
  exclude,
  mark,
  attribute,
}: {
  exclude: readonly string[]
  mark: { identity: string; index: number } | null
  attribute: string
}) {
  const selector = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[tabindex]:not([tabindex^="-"])',
  ].join(', ')
  // Clipped away by itself or an ancestor (an sr-only wrapper): a member cannot click it
  // (CI 61701d25: the skip link inside a clipped wrapper timed out).
  const clipped = (el: Element) => {
    for (
      let node: Element | null = el;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const cs = getComputedStyle(node)
      if (/rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip))
        return true
      if (/inset\(\s*50%/.test(cs.clipPath)) return true
      const box = node.getBoundingClientRect()
      if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true
    }
    return false
  }
  const visible = (el: Element) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return false
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      return false
    return !clipped(el)
  }
  // Text entry is used by typing, not by a click, so a click that only focuses it is no
  // evidence of anything: fields, text areas, selects and editable regions are not probed.
  const BUTTON_INPUTS = [
    'button',
    'submit',
    'reset',
    'image',
    'checkbox',
    'radio',
    'file',
  ]
  const textEntry = (el: Element) =>
    el.matches('textarea, select, [contenteditable]:not([contenteditable="false"])') ||
    (el.tagName === 'INPUT' && !BUTTON_INPUTS.includes((el as HTMLInputElement).type))
  // The current choice of an exclusive set does nothing when chosen again, by design: the
  // selected tab or option, the current page, the checked radio, and the pressed chip of a
  // group of pressable chips (CI a45f15a1 flagged the active chip). A toggle that can be turned
  // off (a standalone pressed button, a checked checkbox, an on switch) is still probed
  // (Codex #5).
  const RADIOS = ['radio', 'menuitemradio']
  const currentChoice = (el: Element) => {
    if (el.getAttribute('aria-selected') === 'true') return true
    if (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false')
      return true
    const radio =
      RADIOS.includes(el.getAttribute('role') ?? '') ||
      (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio')
    if (
      radio &&
      (el.getAttribute('aria-checked') === 'true' || (el as HTMLInputElement).checked)
    )
      return true
    if (el.getAttribute('aria-pressed') !== 'true') return false
    const group = el.parentElement
    return Array.from(group?.querySelectorAll('[aria-pressed]') ?? []).some(
      (other) => other !== el && other.parentElement === group
    )
  }
  const excluded = (el: Element) =>
    textEntry(el) || exclude.some((s) => el.closest(s) !== null)
  // A visually hidden control stands for its rendered labels.
  const standIns = (el: Element) =>
    visible(el)
      ? [el]
      : Array.from((el as HTMLInputElement).labels ?? []).filter(
          (label) => visible(label) && !excluded(label)
        )
  const found = Array.from(document.querySelectorAll(selector))
    .filter((el) => !excluded(el))
    .flatMap(standIns)
  const set = new Set(found)
  const outermost = Array.from(set).filter((el) => {
    for (let node = el.parentElement; node; node = node.parentElement)
      if (set.has(node)) return false
    return true
  })
  const describe = (el: Element) => {
    const testId = el.getAttribute('data-testid')
    const name =
      (el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
      el.getAttribute('aria-label') ||
      ''
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role')
    return { testId, name, tag, role, identity: testId ?? `${tag} ${role ?? ''} ${name}` }
  }
  const seen = new Map<string, number>()
  const targets = []
  for (const el of outermost) {
    const { testId, name, tag, role, identity } = describe(el)
    const index = seen.get(identity) ?? 0
    seen.set(identity, index + 1)
    if (mark?.identity === identity && mark.index === index) {
      el.setAttribute(attribute, '')
      return { marked: true, targets: [] }
    }
    // Skipped after its index is counted, so a current choice keeps the others' positions.
    if (currentChoice(el)) continue
    const base = testId ?? (name ? `${tag} "${name.slice(0, 40)}"` : tag)
    const key = index ? `${base} #${index + 1}` : base
    targets.push({ key, identity, testId, tag, role, name, index })
  }
  return { marked: false, targets }
}

export async function listProbeTargets(
  page: Page,
  excludeSelectors: readonly string[]
): Promise<ProbeTarget[]> {
  const { targets } = await page.evaluate(inventory, {
    exclude: excludeSelectors,
    mark: null,
    attribute: MARK,
  })
  return targets
}

/**
 * Clicks one target in the page `open` has just loaded and reports what the click did.
 * `open` must leave the page settled (gate open, reads answered, fonts ready).
 */
export async function probeTarget(
  page: Page,
  open: () => Promise<void>,
  target: ProbeTarget,
  excludeSelectors: readonly string[]
): Promise<ProbeResult> {
  await open()
  const { marked } = await page.evaluate(inventory, {
    exclude: excludeSelectors,
    mark: { identity: target.identity, index: target.index },
    attribute: MARK,
  })
  if (!marked) return { target, effects: [], error: 'not found in a fresh load' }
  const control = page.locator(`[${MARK}]`)
  // Codex #1: Playwright scrolls a control below the fold into view to click it. That scroll is
  // the probe's, not the control's, so it happens before the scroll baseline is taken.
  await control.scrollIntoViewIfNeeded()
  // A smooth scroll keeps moving after scrollIntoViewIfNeeded resolves (CI 61701d25: every
  // control below the fold read as `scroll`): wait for three still frames first.
  await page.evaluate(async () => {
    let last = ''
    let still = 0
    while (still < 3) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const now = `${window.scrollX},${window.scrollY}`
      still = now === last ? still + 1 : 0
      last = now
    }
  })

  // Baseline: a window with no click marks the nodes that change on their own (P6c).
  await page.evaluate(async (observeMs) => {
    const state = {
      churn: new WeakSet<Node>(),
      childChurn: new WeakMap<Node, number>(),
      after: [] as Node[],
      clicked: false,
    }
    ;(window as unknown as { __budgetProbe: typeof state }).__budgetProbe = state
    new MutationObserver((records) => {
      for (const record of records) {
        const list = record.type === 'childList'
        // Churn is kept per kind: a parent whose children change on their own (a ticking
        // clock) hides later child changes; a parent whose attributes change on its own does
        // not hide a panel inserted into it (CI ffbd7e54: RULE-064 against RULE-068).
        // Children count as churn when they changed twice with no click (a clock ticks); one
        // late insert while the screen settles does not hide a panel the click adds there
        // (CI 64c28254: the style preferences expander read as analytics-only).
        if (!state.clicked) {
          if (list)
            state.childChurn.set(
              record.target,
              (state.childChurn.get(record.target) ?? 0) + 1
            )
          else state.churn.add(record.target)
          continue
        }
        if (
          list
            ? (state.childChurn.get(record.target) ?? 0) >= 2
            : state.churn.has(record.target)
        )
          continue
        state.after.push(
          ...(list && record.addedNodes.length
            ? Array.from(record.addedNodes)
            : [record.target])
        )
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    await new Promise((resolve) => setTimeout(resolve, observeMs))
    state.clicked = true
  }, BASELINE_MS)

  const before = new URL(page.url())
  const scrollBefore = await page.evaluate(() => [window.scrollX, window.scrollY])
  const effects: string[] = []
  // The first effect ends the window early: only a control with none waits the full second
  // (CI a0f4d24b: full windows on every Today control ran a shard past 20 minutes).
  let signal = () => undefined as void
  const nodeEffect = new Promise<void>((resolve) => {
    signal = resolve
  })
  const record = (effect: string) => {
    effects.push(effect)
    signal()
  }
  // A read by itself is no evidence: polls, link prefetches and refetches arrive after any
  // click (CI 61701d25), and a read that matters changes the DOM or the URL, which count. So a
  // request is an effect when it writes (any method but GET and HEAD) or loads a new document.
  const onRequest = (request: Request) => {
    if (isAnalyticsRequest(request.url(), before.href)) return
    const read = request.method() === 'GET' || request.method() === 'HEAD'
    if (read && !(request.isNavigationRequest() && request.frame() === page.mainFrame()))
      return
    const url = new URL(request.url(), before)
    record(`request ${request.method()} ${url.pathname}`)
  }
  const onDialog = (dialog: Dialog) => {
    record(`dialog ${dialog.type()}`)
    void dialog.dismiss()
  }
  const onPopup = () => record('popup')
  const onDownload = () => record('download')
  const onFileChooser = (chooser: FileChooser) => {
    void chooser.setFiles({ name: 'probe.png', mimeType: 'image/png', buffer: PNG })
  }
  page.on('request', onRequest)
  page.on('dialog', onDialog)
  page.on('popup', onPopup)
  page.on('download', onDownload)
  page.on('filechooser', onFileChooser)
  try {
    const handle = await control.elementHandle()
    // A control drawn under its own visual (a styled checkbox) intercepts the pointer: the click
    // lands on what covers it, as a member's would, through a dispatched click.
    await control.click({ timeout: 5_000 }).catch(async (error: unknown) => {
      if (!/intercepts pointer events/.test(String(error))) throw error
      await control.dispatchEvent('click')
    })
    const observation = page.evaluate(
      async ({ el, observeMs, scroll, start, href }) => {
        const deadline = performance.now() + observeMs
        const state = (
          window as unknown as {
            __budgetProbe?: { churn: WeakSet<Node>; after: Node[] }
          }
        ).__budgetProbe
        // A label hands focus to its own control: that is the click landing, not an effect.
        const own = el instanceof HTMLLabelElement ? el.control : null
        const check = () => {
          const found: string[] = []
          // A new document (a reload) has no probe state: that is an effect too.
          if (!state) return ['document replaced']
          const now = `${location.pathname}${location.search}`
          if (now !== start) found.push(`navigation ${now}`)
          // A jump to a fragment with no target (a bare `#`) is the browser's default, not the
          // control's: the D4 matrix row "hash link no-op" (Preview outfits).
          const fragment =
            location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : ''
          // `href="#"` leaves location.hash empty, so the fragment change is read from the URL.
          const deadHash =
            location.href !== href &&
            !(
              fragment &&
              (document.getElementById(fragment) ||
                document.getElementsByName(fragment)[0])
            )
          if ((window.scrollX !== scroll[0] || window.scrollY !== scroll[1]) && !deadHash)
            found.push('scroll')
          const active = document.activeElement
          if (
            active &&
            active !== document.body &&
            !el.contains(active) &&
            active !== own
          )
            found.push(`focus ${active.tagName.toLowerCase()}`)
          const outside = state.after.filter(
            (node) =>
              // A label's own control (its file input) is part of the control it labels.
              !state.churn.has(node) &&
              !el.contains(node) &&
              !(own && (own === node || own.contains(node))) &&
              node.isConnected !== false
          )
          if (outside.length)
            found.push(`dom ${outside.length} change(s) outside the control`)
          return found
        }
        for (;;) {
          const found = check()
          if (found.length || performance.now() >= deadline) return found
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      },
      {
        el: handle,
        observeMs: OBSERVE_MS,
        scroll: scrollBefore,
        start: `${before.pathname}${before.search}`,
        href: before.href,
      }
    )
    // A window the node side ended early keeps running in the page until the next load.
    observation.catch(() => undefined)
    let seen: string[] = []
    try {
      const first = await Promise.race([observation, nodeEffect.then(() => null)])
      seen = first ?? []
    } catch (error) {
      // A full navigation destroys the page the observer lived in: that is an effect.
      if (!/context was destroyed|navigat|Target closed/i.test(String(error))) throw error
      seen = ['document replaced']
    }
    const after = new URL(page.url())
    const navigation = `navigation ${after.pathname}${after.search}`
    if (
      (after.pathname !== before.pathname || after.search !== before.search) &&
      !seen.includes(navigation)
    )
      effects.push(navigation)
    effects.push(...seen)
  } catch (error) {
    return {
      target,
      effects,
      error:
        error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error),
    }
  } finally {
    page.off('request', onRequest)
    page.off('dialog', onDialog)
    page.off('popup', onPopup)
    page.off('download', onDownload)
    page.off('filechooser', onFileChooser)
  }
  return { target, effects }
}

/** Probes every target `open` shows, one fresh load each, and returns each result. */
export async function probeScreen(
  page: Page,
  open: () => Promise<void>,
  excludeSelectors: readonly string[]
): Promise<{ targets: ProbeTarget[]; results: ProbeResult[] }> {
  await open()
  const targets = await listProbeTargets(page, excludeSelectors)
  const results: ProbeResult[] = []
  for (const target of targets)
    results.push(await probeTarget(page, open, target, excludeSelectors))
  return { targets, results }
}

/** The targets whose only effect was analytics, as the verdict's `analyticsOnly`. */
export const analyticsOnly = (results: readonly ProbeResult[]): ScreenBudgetElement[] =>
  results
    .filter((result) => !result.error && result.effects.length === 0)
    .map((result) => ({ key: result.target.key }))

/** Probe errors, as the verdict's `errors`. */
export const probeErrors = (results: readonly ProbeResult[]): string[] =>
  results.flatMap((result) =>
    result.error ? [`probe ${result.target.key}: ${result.error}`] : []
  )
