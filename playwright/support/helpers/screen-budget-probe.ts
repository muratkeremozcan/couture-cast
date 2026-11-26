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
  /** Its position among the targets that share its testid or tag and name. */
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
export function listProbeTargets(
  page: Page,
  excludeSelectors: readonly string[]
): Promise<ProbeTarget[]> {
  return page.evaluate((exclude) => {
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
    const visible = (el: Element) => {
      if (el.closest('[aria-hidden="true"], [inert]')) return false
      const rect = el.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) return false
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
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
    // An option that is already selected does nothing when chosen again, by design: it is
    // the current state, not a control to prove (CI a45f15a1 flagged the active chip).
    const selected = (el: Element) =>
      ['aria-pressed', 'aria-selected', 'aria-checked'].some(
        (attribute) => el.getAttribute(attribute) === 'true'
      ) ||
      (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false')
    const excluded = (el: Element) =>
      textEntry(el) || exclude.some((s) => el.closest(s) !== null)
    const found: Element[] = []
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (excluded(el)) continue
      if (visible(el)) found.push(el)
      else
        for (const label of Array.from((el as HTMLInputElement).labels ?? []))
          if (visible(label) && !excluded(label)) found.push(label)
    }
    const set = new Set(found)
    const outermost = found.filter((el) => {
      for (let node = el.parentElement; node; node = node.parentElement)
        if (set.has(node)) return false
      return true
    })
    const seen = new Map<string, number>()
    return Array.from(new Set(outermost))
      .map((el) => {
        const testId = el.getAttribute('data-testid')
        const name =
          (el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
          el.getAttribute('aria-label') ||
          ''
        const tag = el.tagName.toLowerCase()
        const identity = testId ?? `${tag} ${name}`
        const index = seen.get(identity) ?? 0
        seen.set(identity, index + 1)
        const base = testId ?? (name ? `${tag} "${name.slice(0, 40)}"` : tag)
        return {
          key: index ? `${base} #${index + 1}` : base,
          testId,
          tag,
          role: el.getAttribute('role'),
          name,
          index,
          // Skipped after its index is counted, so a selected twin keeps the others' positions.
          skip: selected(el),
        }
      })
      .filter((target) => !target.skip)
      .map(({ skip: _skip, ...target }) => target)
  }, excludeSelectors)
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every element with the target's identity in this load; the target is `.nth(index)`. */
function candidates(page: Page, target: ProbeTarget) {
  if (target.testId) return page.getByTestId(target.testId)
  const exact = new RegExp(`^\\s*${escapeRegExp(target.name).replace(/ /g, '\\s+')}\\s*$`)
  // A control named only by aria-label has no text to match.
  return page
    .locator(target.tag)
    .filter({ hasText: exact })
    .or(page.locator(`${target.tag}[aria-label=${JSON.stringify(target.name)}]`))
}

/**
 * Clicks one target in the page `open` has just loaded and reports what the click did.
 * `open` must leave the page settled (gate open, reads answered, fonts ready).
 */
export async function probeTarget(
  page: Page,
  open: () => Promise<void>,
  target: ProbeTarget
): Promise<ProbeResult> {
  await open()
  const all = candidates(page, target)
  const count = await all.count()
  if (count <= target.index)
    return { target, effects: [], error: `not found in a fresh load (${count} matches)` }
  const control = all.nth(target.index)

  // Baseline: a window with no click marks the nodes that change on their own (P6c).
  await page.evaluate(async (observeMs) => {
    const state = {
      churn: new WeakSet<Node>(),
      after: [] as Node[],
      clicked: false,
    }
    ;(window as unknown as { __budgetProbe: typeof state }).__budgetProbe = state
    new MutationObserver((records) => {
      for (const record of records) {
        // Inserted nodes are new, so a parent that also changes on its own cannot hide them.
        const nodes =
          record.type === 'childList' && record.addedNodes.length
            ? Array.from(record.addedNodes)
            : [record.target]
        for (const node of nodes) {
          if (state.clicked) state.after.push(node)
          else state.churn.add(node)
        }
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
  const seenPaths = new Set(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name, location.href).pathname)
    )
  )
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
  const onRequest = (request: Request) => {
    if (isAnalyticsRequest(request.url(), before.href)) return
    const url = new URL(request.url(), before)
    if (request.method() === 'GET' && seenPaths.has(url.pathname)) return
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
    await control.click()
    const observation = page.evaluate(
      async ({ el, observeMs, scroll, start }) => {
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
          if (window.scrollX !== scroll[0] || window.scrollY !== scroll[1])
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
              !state.churn.has(node) && !el.contains(node) && node.isConnected !== false
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
  for (const target of targets) results.push(await probeTarget(page, open, target))
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
