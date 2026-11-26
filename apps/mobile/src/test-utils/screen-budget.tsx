// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): the native half of the screen budget (7.10-NAT-001..015), shared
// by the four screen-budget-*.test.tsx suites. The screens render through react-native-web in
// Chromium (spec D7, P9): `testID` becomes `data-testid` and RN styles computed CSS, so the same
// `measureScreenBudget` and verdict as the web run here unchanged.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
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
import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { expect } from 'vitest'
import { AppTopBar } from '@/src/components/app-top-bar'
import { server } from './msw/server'
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
 * The screen under the tab's top bar, as the tab layout draws it on a device
 * (`renderTabTopBar`): the bar's 56 px belong to the Closet chrome and the Today height. The
 * layout's trailing header controls are not drawn here (Home's About button), so native Today
 * counts one target fewer than the device; recorded in the test design.
 */
export function WithTopBar({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ height: BUDGET_VIEWPORT.height }}>
      <AppTopBar title={title} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  )
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

/** Text entry is typed into, not pressed (as on web): fields are not probed. */
const textEntry = (el: Element) =>
  el.matches('textarea, select, [contenteditable]:not([contenteditable="false"])') ||
  (el.tagName === 'INPUT' &&
    !['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(
      (el as HTMLInputElement).type
    ))

/** Every visible outermost target in document order, with what finds it again. */
function listTargets(): NativeProbeTarget[] {
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
      return { key: index ? `${base} #${index + 1}` : base, testId, name, index }
    })
}

function find(target: NativeProbeTarget): HTMLElement | null {
  const candidates = listTargets()
  const match = candidates.filter((candidate) =>
    target.testId
      ? candidate.testId === target.testId
      : !candidate.testId && candidate.name === target.name
  )[target.index]
  if (!match) return null
  if (match.testId)
    return (
      (Array.from(
        document.querySelectorAll(`[data-testid="${CSS.escape(match.testId)}"]`)
      ).filter(visible)[match.index] as HTMLElement | undefined) ?? null
    )
  return (
    (Array.from(document.body.querySelectorAll(TARGET_SELECTOR)).filter(
      (el) =>
        visible(el) &&
        !el.getAttribute('data-testid') &&
        ((el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
          el.getAttribute('aria-label') ||
          '') === match.name
    )[match.index] as HTMLElement | undefined) ?? null
  )
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

/**
 * Spec D4 on native: each visible target is pressed in a fresh render. An effect is a router or
 * other outside call, a request MSW sees to a path the screen had not read before the press, a
 * DOM change outside the control that did not also happen with no press, or focus moved to
 * another element. Analytics on native is the mocked capture client, which sends nothing.
 */
export async function probeNativeScreen(options: NativeProbeOptions) {
  const unmountFirst = await options.mount()
  const targets = listTargets()
  unmountFirst()
  const results: NativeProbeResult[] = []
  for (const target of targets) {
    const requested = new Set<string>()
    const onRequest = ({ request }: { request: Request }) => {
      requested.add(`${request.method} ${new URL(request.url).pathname}`)
    }
    server.events.on('request:start', onRequest)
    const unmount = await options.mount()
    try {
      const control = find(target)
      if (!control) {
        results.push({ target, effects: [], error: 'not found in a fresh render' })
        continue
      }
      const churn = new WeakSet<Node>()
      const after: Node[] = []
      let pressed = false
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (pressed) after.push(record.target)
          else churn.add(record.target)
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
      pressed = true
      press(control)
      await act(() => sleep(OBSERVE_MS))
      observer.disconnect()
      const effects: string[] = []
      if (options.outsideCalls() > calls) effects.push('outside call')
      // A read the screen already made (a poll, a refetch) is not evidence of the press.
      for (const request of requested)
        if (!before.has(request)) effects.push(`request ${request}`)
      const active = document.activeElement
      if (active && active !== document.body && !control.contains(active))
        effects.push(`focus ${active.tagName.toLowerCase()}`)
      const outside = after.filter(
        (node) => !churn.has(node) && !control.contains(node) && node.isConnected
      )
      if (outside.length)
        effects.push(`dom ${outside.length} change(s) outside the control`)
      results.push({ target, effects })
    } finally {
      unmount()
      server.events.removeListener('request:start', onRequest)
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
