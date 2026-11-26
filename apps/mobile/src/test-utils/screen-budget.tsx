// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): the native half of the screen budget (7.10-NAT-001..015 and
// the probe rules 7.10-NAT-017..022), shared by the four screen-budget-*.test.tsx suites and
// screen-budget-probe.test.tsx. The screens render through react-native-web in Chromium (spec D7,
// P9): `testID` becomes `data-testid` and RN styles computed CSS, so the same
// `measureScreenBudget` and verdict as the web run here unchanged.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
//
// `WithTopBar` and `tabHeader` render AppTopBar, which imports `@expo/vector-icons/FontAwesome`:
// every suite that uses them mocks that module (`vi.mock('@expo/vector-icons/FontAwesome', () =>
// ({ default: () => null }))`), as app-top-bar.test.tsx does.
import {
  evaluateScreenBudget,
  measureScreenBudget,
  screenBudget,
  screenBudgetMeasureConfig,
  type ScreenBudgetAuditMeasurement,
  type ScreenBudgetElement,
  type ScreenBudgetFixture,
  type ScreenBudgetMeasurement,
  type ScreenBudgetScreen,
} from '@couture/utils'
import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { expect } from 'vitest'
import { AppTopBar, type renderTabTopBar } from '@/src/components/app-top-bar'
import { press } from './press'
import { setViewport } from './viewport'

export const NATIVE_BUDGET_FIXTURES = screenBudget.fixtures
export const BUDGET_VIEWPORT = screenBudget.measure.viewport

/** D4's window: a press shows its effect within one second. */
const OBSERVE_MS = 1000
/** The no-press window that marks nodes changing on their own (P6c). */
const BASELINE_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The audit viewport (390 x 844), before the first render. */
export function setBudgetViewport() {
  return setViewport(BUDGET_VIEWPORT.width, BUDGET_VIEWPORT.height)
}

/**
 * The screen under a tab header, as the tab navigator draws it on a device: the bar's 56 px
 * belong to the Closet chrome and the Today height. The root layout's navigation theme is
 * around both, as app/_layout.tsx mounts it (the tab heading reads it).
 */
export function WithTabHeader({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  return (
    // The navigation themes type as `error` under the lint program, as in app/_layout.tsx.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    <ThemeProvider value={DefaultTheme}>
      <View style={{ height: BUDGET_VIEWPORT.height }}>
        {header}
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </ThemeProvider>
  )
}

/**
 * The screen under a plain AppTopBar with the tab title. Closet, Community and Profile declare
 * no trailing header control in app/(tabs)/_layout.tsx, so their bar is this one; Home declares
 * the About button and draws its header with `tabHeader` instead.
 */
export function WithTopBar({ title, children }: { title: string; children: ReactNode }) {
  return <WithTabHeader header={<AppTopBar title={title} />}>{children}</WithTabHeader>
}

type TabHeaderProps = Parameters<typeof renderTabTopBar>[0]

/**
 * What app/(tabs)/_layout.tsx hands its navigator, read through an expo-router `Tabs` double
 * (as profile-tab.test.tsx reads it): the navigator `screenOptions` and each `Tabs.Screen`.
 */
export interface CapturedTabLayout {
  screenOptions: Record<string, unknown>
  readonly screens: Map<string, { readonly options?: Record<string, unknown> }>
}

/**
 * The header the tab navigator draws for `route`: the layout's own `header` called with the
 * navigator options merged under the route's, as React Navigation merges them. A tab root has
 * nothing below it, so there is no back control.
 */
export function tabHeader(layout: CapturedTabLayout, route: string): ReactNode {
  const header = layout.screenOptions.header as
    | ((props: TabHeaderProps) => ReactNode)
    | undefined
  const routeOptions = layout.screens.get(route)?.options
  if (!header || !routeOptions)
    throw new Error(`the tab layout declared no header or no options for "${route}"`)
  return header({
    options: { ...layout.screenOptions, ...routeOptions } as TabHeaderProps['options'],
    route: { key: `${route}-screen-budget`, name: route },
    navigation: {
      goBack: () => undefined,
      canGoBack: () => false,
      getState: () => ({ routes: [] }),
    },
  })
}

/** The shared measure on what is rendered now, with the native config for `screen`. */
export function measureNativeScreen(
  screen: ScreenBudgetScreen
): Promise<ScreenBudgetMeasurement> {
  return measureScreenBudget(screenBudgetMeasureConfig('native', screen))
}

/**
 * Floors so an audit cannot pass on a measure that saw nothing (risk R1). The native suites
 * render no tab bar, so there is no tab bar floor here.
 */
export function expectNativeMeasureFloors(
  measurement: ScreenBudgetMeasurement,
  screen: ScreenBudgetScreen
) {
  expect(
    measurement.targetsAboveFold.length,
    'targets counted above the fold'
  ).toBeGreaterThan(0)
  if (screen === 'today')
    expect(measurement.todayHeight, 'Today height').toBeGreaterThan(0)
  if (screen === 'closet') {
    expect(measurement.closetChrome, 'Closet anchor top').toBeGreaterThanOrEqual(56)
    expect(measurement.primaryButtons.length, 'Closet gold Add').toBeGreaterThan(0)
  }
}

/** The verdict for one native audit; every failure line names screen, fixture, rule and value. */
export function expectNativeWithinBudget(
  screen: ScreenBudgetScreen,
  fixture: ScreenBudgetFixture,
  measurement: ScreenBudgetAuditMeasurement
) {
  const evaluation = evaluateScreenBudget({
    platform: 'native',
    screen,
    fixture,
    measurement,
  })
  // One line the baseline harvest reads from the CI log (spec D5: `known` comes from CI).
  // eslint-disable-next-line no-console
  console.info(`SCREEN_BUDGET ${JSON.stringify({ evaluation, measurement })}`)
  expect(
    evaluation.failures.map((failure) => failure.message),
    `screen budget: native ${screen} (${fixture})`
  ).toEqual([])
  return evaluation
}

interface NativeProbeTarget {
  readonly key: string
  readonly testId: string | null
  readonly name: string
  readonly index: number
  /** An exclusive set's current choice: listed so the others keep their places, not pressed. */
  readonly skip: boolean
}

const TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
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

function visible(el: Element) {
  if (el.closest('[aria-hidden="true"], [inert]')) return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1) return false
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}

/**
 * The current choice of an exclusive set, which does nothing when chosen again by design: the
 * selected tab or option, the current page, the checked radio, and the pressed chip of a group
 * (a parent holding at least one other `aria-pressed` control, an exclusive filter or chip row).
 * Everything that can still be turned off is probed: a standalone pressed toggle, a checked
 * checkbox, an on switch.
 */
function currentChoice(el: Element) {
  if (el.getAttribute('aria-selected') === 'true') return true
  if (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false')
    return true
  const role = el.getAttribute('role')
  if (
    el.getAttribute('aria-checked') === 'true' &&
    (role === 'radio' || role === 'menuitemradio')
  )
    return true
  if (el instanceof HTMLInputElement && el.type === 'radio' && el.checked) return true
  if (el.getAttribute('aria-pressed') !== 'true') return false
  const siblings = Array.from(el.parentElement?.children ?? [])
  return siblings.some(
    (other) =>
      other !== el && other.hasAttribute('aria-pressed') && other.matches(TARGET_SELECTOR)
  )
}

/** Text entry is typed into, not pressed (as on web): fields are not probed. */
const textEntry = (el: Element) =>
  el.matches('textarea, select, [contenteditable]:not([contenteditable="false"])') ||
  (el.tagName === 'INPUT' &&
    !['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(
      (el as HTMLInputElement).type
    ))

/** Every visible outermost target in document order, each with its element. */
function collectTargets(): { target: NativeProbeTarget; el: HTMLElement }[] {
  const found = Array.from(document.body.querySelectorAll(TARGET_SELECTOR)).filter(
    (el) => !textEntry(el) && visible(el)
  )
  const set = new Set(found)
  const seen = new Map<string, number>()
  return found
    .filter((el) => {
      for (let node = el.parentElement; node; node = node.parentElement)
        if (set.has(node)) return false
      return true
    })
    .map((el) => {
      const testId = el.getAttribute('data-testid')
      const name =
        (el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
        el.getAttribute('aria-label') ||
        ''
      const identity = testId ?? `text ${name}`
      const index = seen.get(identity) ?? 0
      seen.set(identity, index + 1)
      const base =
        testId ??
        (name
          ? `${el.tagName.toLowerCase()} "${name.slice(0, 40)}"`
          : el.tagName.toLowerCase())
      const target = {
        key: index ? `${base} #${index + 1}` : base,
        testId,
        name,
        index,
        skip: currentChoice(el),
      }
      return { target, el: el as HTMLElement }
    })
}

/** The same target in a fresh render: same identity, same position among its twins. */
function find(target: NativeProbeTarget): HTMLElement | null {
  const same = (other: NativeProbeTarget) =>
    other.index === target.index &&
    (target.testId
      ? other.testId === target.testId
      : !other.testId && other.name === target.name)
  return collectTargets().find(({ target: other }) => same(other))?.el ?? null
}

export interface NativeProbeOptions {
  /** Renders the screen fresh and resolves once its gate is open; returns its unmount. */
  readonly mount: () => Promise<() => void>
  /**
   * Calls the press could make that leave no DOM trace: the router mock (push, replace,
   * setParams, back), Linking and the in-app browser. A count that grows is an effect.
   */
  readonly outsideCalls: () => number
}

export interface NativeProbeResult {
  readonly target: NativeProbeTarget
  readonly effects: readonly string[]
  readonly error?: string
}

/** The Navigation API's `navigate` event, which TypeScript 5.9's DOM lib does not declare yet. */
interface NavigateEventLike extends Event {
  readonly destination: { readonly url: string }
  readonly hashChange: boolean
}

/** The window's Navigation API (Chromium), where every navigation the page starts is announced. */
function windowNavigation(): EventTarget {
  const navigation = (window as Window & { navigation?: EventTarget }).navigation
  if (!navigation)
    throw new Error(
      'probeNativeScreen needs the Navigation API (Chromium) to hold a followed link'
    )
  return navigation
}

/** A fragment that names nothing on the page scrolls nowhere: no target, a bare `#`, `#top`. */
function hashTargetExists(url: URL) {
  const id = decodeURIComponent(url.hash.slice(1))
  if (!id || id.toLowerCase() === 'top') return false
  return Boolean(document.getElementById(id) ?? document.getElementsByName(id)[0])
}

/**
 * A link that opens another window would start its navigation where the probe cannot hold it:
 * for the press only, the link targets this window, so the hold below sees and cancels it.
 * Returns the restore.
 */
function retargetNewWindowLinks(): () => void {
  const restores: (() => void)[] = []
  const retarget = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a[href][target]')
    const target = link?.getAttribute('target')
    if (!link || !target || target === '_self') return
    link.removeAttribute('target')
    restores.push(() => link.setAttribute('target', target))
  }
  document.addEventListener('click', retarget, true)
  return () => {
    document.removeEventListener('click', retarget, true)
    for (const restore of restores) restore()
  }
}

/**
 * Spec D4 on native: each visible target is pressed in a fresh render. An effect is a router or
 * other outside call, a write request (not GET or HEAD) the screen had not made before the
 * press, a DOM change outside the control that did not also happen with no press, focus moved
 * by the press to another element, or a link the press followed. Analytics on native is the
 * mocked capture client, which sends nothing.
 *
 * A followed link is read from the Navigation API's `navigate` event. It fires only once every
 * click handler has run and the click's default action really navigates: a link whose handler
 * called `preventDefault` never fires it (an expo-router Link routes through the router mock
 * instead, an outside call). The probe cancels the navigation there to keep the test frame, and
 * credits it unless it is a fragment that names no element. A document click listener cannot
 * judge this: react-native-web's Pressable stops the click's propagation at the React root.
 */
export async function probeNativeScreen(options: NativeProbeOptions) {
  const navigation = windowNavigation()
  const unmountFirst = await options.mount()
  const targets = collectTargets()
    .map(({ target }) => target)
    .filter((target) => !target.skip)
  unmountFirst()
  const results: NativeProbeResult[] = []
  for (const target of targets) {
    // The browser MSW shim has no lifecycle events, so the probe reads requests at fetch itself
    // (the app's only transport), then hands each call on unchanged.
    const requested = new Set<string>()
    const realFetch = globalThis.fetch
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requested.add(
        `${request.method} ${new URL(request.url, window.location.href).pathname}`
      )
      return realFetch(input, init)
    }
    // Held for the whole render: no navigation leaves the test frame, pressed or not.
    let pressed = false
    const followed: string[] = []
    const holdNavigation = (event: Event) => {
      const { destination, hashChange } = event as NavigateEventLike
      event.preventDefault()
      if (!pressed) return
      const url = new URL(destination.url)
      if (hashChange) {
        if (hashTargetExists(url)) followed.push(url.hash)
        return
      }
      followed.push(`${url.pathname}${url.search}${url.hash}`)
    }
    navigation.addEventListener('navigate', holdNavigation)
    const release = () => {
      navigation.removeEventListener('navigate', holdNavigation)
      globalThis.fetch = realFetch
    }
    const unmount = await options.mount().catch((error: unknown) => {
      release()
      throw error
    })
    try {
      const control = find(target)
      if (!control) {
        results.push({ target, effects: [], error: 'not found in a fresh render' })
        continue
      }
      const churn = new WeakSet<Node>()
      const childChurn = new WeakSet<Node>()
      const after: Node[] = []
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const list = record.type === 'childList'
          // Churn is kept per kind, as on web: children that change on their own hide later
          // child changes there; attributes that change on their own do not hide an insert.
          if (!pressed) {
            ;(list ? childChurn : churn).add(record.target)
            continue
          }
          if (list ? childChurn.has(record.target) : churn.has(record.target)) continue
          after.push(
            ...(list && record.addedNodes.length
              ? Array.from(record.addedNodes)
              : [record.target])
          )
        }
      })
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      })
      await act(() => sleep(BASELINE_MS))
      const before = new Set(requested)
      const calls = options.outsideCalls()
      // Focus the screen already held elsewhere is not evidence of the press.
      const focusBefore = document.activeElement
      const restoreTargets = retargetNewWindowLinks()
      pressed = true
      try {
        press(control)
      } finally {
        restoreTargets()
      }
      await act(() => sleep(OBSERVE_MS))
      observer.disconnect()
      const effects: string[] = []
      for (const url of followed) effects.push(`link ${url}`)
      if (options.outsideCalls() > calls) effects.push('outside call')
      // A read is no effect by itself: polls, prefetches and refetches fire with or without a
      // press, and a read that matters shows as a DOM change, a router call or a navigation.
      // A write (any method but GET and HEAD) the screen had not made before the press counts.
      for (const request of requested)
        if (!before.has(request) && !/^(GET|HEAD) /.test(request))
          effects.push(`request ${request}`)
      const active = document.activeElement
      if (
        active &&
        active !== focusBefore &&
        active !== document.body &&
        !control.contains(active)
      )
        effects.push(`focus ${active.tagName.toLowerCase()}`)
      const outside = after.filter(
        (node) => !churn.has(node) && !control.contains(node) && node.isConnected
      )
      if (outside.length)
        effects.push(`dom ${outside.length} change(s) outside the control`)
      results.push({ target, effects })
    } finally {
      unmount()
      release()
    }
  }
  return { targets, results }
}

/** The targets whose only effect was analytics, as the verdict's `analyticsOnly`. */
export const nativeAnalyticsOnly = (
  results: readonly NativeProbeResult[]
): ScreenBudgetElement[] =>
  results
    .filter((result) => !result.error && result.effects.length === 0)
    .map((result) => ({ key: result.target.key }))

/** Probe errors, as the verdict's `errors`. */
export const nativeProbeErrors = (results: readonly NativeProbeResult[]): string[] =>
  results.flatMap((result) =>
    result.error ? [`probe ${result.target.key}: ${result.error}`] : []
  )
