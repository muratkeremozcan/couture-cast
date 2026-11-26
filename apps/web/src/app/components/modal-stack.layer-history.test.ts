// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-E2E-044 at unit level and the D13 / P2 history contract
// of `openLayerHistory`: one same-URL entry per open layer, browser back closes the top layer
// only, closing any other way consumes the entry, stacked closes traverse once, a link hand-off
// leaves history alone, a layer that refuses to close keeps its entry, sign-out closes all.
// Browser proof: playwright/tests/overlay-close.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ModalStack from './modal-stack'

type Stack = typeof ModalStack

/**
 * A fresh module per test (its layer list is module state) and a recorded history: pushState
 * and go are spied, and a test delivers each popstate itself, as the browser does later.
 */
async function setup() {
  vi.resetModules()
  const stack: Stack = await import('./modal-stack')
  const pushState = vi.spyOn(window.history, 'pushState')
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined)
  const popstate = () => window.dispatchEvent(new PopStateEvent('popstate'))
  const flushMicrotasks = () => Promise.resolve()
  return { stack, pushState, go, popstate, flushMicrotasks }
}

let listeners: [string, EventListenerOrEventListenerObject][] = []
const addEventListener = window.addEventListener.bind(window)

beforeEach(() => {
  // Each fresh module installs its own popstate listener; remove them after every test so a
  // previous test's module never answers this test's popstate.
  listeners = []
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    listeners.push([type, listener])
    addEventListener(type, listener, options)
  }) as typeof window.addEventListener)
})

afterEach(() => {
  for (const [type, listener] of listeners) window.removeEventListener(type, listener)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CC-7.11 D13 layer history', () => {
  it('opening pushes one same-URL entry that carries the router state (P2)', async () => {
    const { stack, pushState } = await setup()
    window.history.replaceState({ __NA: true, tree: 'parent' }, '', '/community')

    stack.openLayerHistory(() => undefined)

    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState).toHaveBeenCalledWith(
      { __NA: true, tree: 'parent' },
      '',
      window.location.href
    )
    expect(window.location.pathname).toBe('/community')
  })

  it('browser back closes the top layer only; a second back closes the next (E2E-044)', async () => {
    const { stack, popstate, go } = await setup()
    const closes: string[] = []
    const detail = stack.openLayerHistory(() => closes.push('detail'))
    const share = stack.openLayerHistory(() => closes.push('share'))

    popstate()
    expect(closes).toEqual(['share'])
    share.release()
    popstate()
    expect(closes).toEqual(['share', 'detail'])
    detail.release()
    await Promise.resolve()
    // Both entries were consumed by the browser, so closing steps back over nothing.
    expect(go).not.toHaveBeenCalled()
  })

  it('closing by X, Escape, swipe or the back arrow steps back over the entry once', async () => {
    const { stack, popstate, go, flushMicrotasks } = await setup()
    const closes: string[] = []
    const layer = stack.openLayerHistory(() => closes.push('layer'))

    layer.release()
    await flushMicrotasks()
    expect(go).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith(-1)

    // That step's own popstate is ignored: nothing else closes.
    popstate()
    expect(closes).toEqual([])
  })

  it('two layers closed in one task traverse once, two steps back', async () => {
    const { stack, go, flushMicrotasks } = await setup()
    const detail = stack.openLayerHistory(() => undefined)
    const share = stack.openLayerHistory(() => undefined)

    share.release()
    detail.release()
    await flushMicrotasks()
    expect(go).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith(-2)
  })

  it('a layer opened while a close is still stepping back pushes only after that step lands', async () => {
    const { stack, pushState, popstate, flushMicrotasks } = await setup()
    const first = stack.openLayerHistory(() => undefined)
    expect(pushState).toHaveBeenCalledTimes(1)

    first.release()
    stack.openLayerHistory(() => undefined)
    await flushMicrotasks()
    expect(pushState, 'no push below the step in flight').toHaveBeenCalledTimes(1)

    popstate()
    expect(pushState).toHaveBeenCalledTimes(2)
  })

  it('a link hand-off leaves history to the navigation: release steps back over nothing (P2)', async () => {
    const { stack, go, flushMicrotasks } = await setup()
    const layer = stack.openLayerHistory(() => undefined)

    layer.handOff()
    layer.release()
    await flushMicrotasks()
    expect(go).not.toHaveBeenCalled()
  })

  it('a layer released after the URL changed does not step back', async () => {
    const { stack, go, flushMicrotasks } = await setup()
    const layer = stack.openLayerHistory(() => undefined)

    window.history.replaceState(null, '', '/looks/plan')
    layer.release()
    await flushMicrotasks()
    expect(go).not.toHaveBeenCalled()
  })

  it('a layer that refuses to close on back gets its entry again', async () => {
    vi.useFakeTimers()
    const { stack, pushState, popstate } = await setup()
    // An upload in flight: close() is a no-op, the layer stays open.
    stack.openLayerHistory(() => undefined)
    expect(pushState).toHaveBeenCalledTimes(1)

    popstate()
    vi.runAllTimers()
    expect(pushState, 'entry restored for the next back').toHaveBeenCalledTimes(2)
  })

  it('a layer that did close on back is not given a new entry', async () => {
    vi.useFakeTimers()
    const { stack, pushState, popstate } = await setup()
    let layer: ReturnType<Stack['openLayerHistory']> | null = null
    layer = stack.openLayerHistory(() => layer?.release())

    popstate()
    vi.runAllTimers()
    expect(pushState).toHaveBeenCalledTimes(1)
  })

  it('a popstate with no open layer changes nothing', async () => {
    const { stack, pushState, popstate, go } = await setup()
    const layer = stack.openLayerHistory(() => undefined)
    layer.handOff()
    layer.release()

    popstate()
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(go).not.toHaveBeenCalled()
  })

  it('sign-out closes every open layer, top first (P8)', async () => {
    const { stack } = await setup()
    const closes: string[] = []
    stack.openLayerHistory(() => closes.push('detail'))
    stack.openLayerHistory(() => closes.push('share'))

    window.dispatchEvent(new Event('couture:signed-out'))
    expect(closes).toEqual(['share', 'detail'])
  })
})
