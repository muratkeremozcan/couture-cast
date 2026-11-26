// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-E2E-044 at unit level and the D13 / P2 history contract
// of `openLayerHistory`: one same-URL entry per open layer, stamped with its position and layer
// id; browser back closes the layers above the position it lands on and nothing else; closing
// any other way consumes the entry; stacked closes traverse once; a link hand-off leaves history
// alone; a layer that refuses to close keeps its entry; a Forward onto a closed layer's entry
// steps back over it (Codex 7.11 #7); sign-out closes all.
// Browser proof: playwright/tests/overlay-close.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AppHistory from '../../lib/app-history'
import type * as ModalStack from './modal-stack'

type Stack = typeof ModalStack
type Layer = ReturnType<Stack['openLayerHistory']>
type Listener = [
  string,
  EventListenerOrEventListenerObject,
  boolean | AddEventListenerOptions | undefined,
]

/**
 * jsdom's own addEventListener on window, taken before any spy replaces it. Vitest binds the
 * window's methods to the jsdom window, so calling EventTarget.prototype's with the test
 * global fails jsdom's brand check ("not a valid instance of EventTarget", CI job 140098473776).
 */
const originalAddEventListener = window.addEventListener.bind(window)
function nativeAddEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
) {
  originalAddEventListener(type, listener, options)
}
let listeners: Listener[] = []

function removeModuleListeners() {
  for (const [type, listener, options] of listeners)
    window.removeEventListener(type, listener, options)
  listeners = []
}

function restoreNativeHistory() {
  Reflect.deleteProperty(window.history, 'pushState')
  Reflect.deleteProperty(window.history, 'replaceState')
}

const routerState = (url: string) => ({ __NA: true, tree: url })

/**
 * A fresh document on the first URL, fresh modules (the layer list and the history positions
 * are module state), then the router pushes the rest. History is jsdom's real one: `pushState`
 * and `go` are spied and call through, and traversals deliver their popstate on later tasks.
 */
async function setup(urls: [string, ...string[]] = ['/community']) {
  removeModuleListeners()
  restoreNativeHistory()
  window.history.replaceState(routerState(urls[0]), '', urls[0])
  vi.resetModules()
  const stack: Stack = await import('./modal-stack')
  const appHistory: typeof AppHistory = await import('../../lib/app-history')
  for (const url of urls.slice(1)) window.history.pushState(routerState(url), '', url)
  const pushState = vi.spyOn(window.history, 'pushState')
  const go = vi.spyOn(window.history, 'go')
  /** The entry on show: its position and the layer that owns it, if any. */
  const entry = () => {
    const state = window.history.state as Record<string, unknown>
    return { index: appHistory.currentAppHistoryIndex(), layer: state.__ccLayer }
  }
  return { stack, appHistory, pushState, go, entry }
}

/**
 * A layer that closes when asked, as AccessibleModal does: the close re-renders and the
 * unmount releases the layer's history after the current task step.
 */
function openClosingLayer(stack: Stack, name: string, closes: string[]): Layer {
  let layer: Layer | null = null
  layer = stack.openLayerHistory(() => {
    closes.push(name)
    queueMicrotask(() => layer?.release())
  })
  return layer
}

/** Waits until queued back steps, jsdom traversal tasks and their popstate have all run. */
async function settle() {
  for (let round = 0; round < 10; round++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

async function browserBack() {
  window.history.back()
  await settle()
}

async function browserForward() {
  window.history.forward()
  await settle()
}

beforeEach(() => {
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    listeners.push([type, listener, options])
    nativeAddEventListener(type, listener, options)
  }) as typeof window.addEventListener)
})

afterEach(async () => {
  await settle()
  // Spies first: restoring the pushState spy puts the module wrapper back, which the native
  // restore then removes.
  vi.restoreAllMocks()
  removeModuleListeners()
  restoreNativeHistory()
})

describe('CC-7.11 D13 layer history', () => {
  it('opening pushes one same-URL entry that carries the router state, its position and its layer id (P2)', async () => {
    const { stack, pushState, entry } = await setup()

    stack.openLayerHistory(() => undefined)

    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState).toHaveBeenCalledWith(
      { ...routerState('/community'), __ccIdx: 0, __ccLayer: 1 },
      '',
      window.location.href
    )
    expect(window.history.state).toEqual({
      ...routerState('/community'),
      __ccIdx: 1,
      __ccLayer: 1,
    })
    expect(entry()).toEqual({ index: 1, layer: 1 })
    expect(window.location.pathname).toBe('/community')
  })

  it('browser back closes the top layer only; a second back closes the next (E2E-044)', async () => {
    const { stack, go, entry } = await setup()
    const closes: string[] = []
    openClosingLayer(stack, 'detail', closes)
    openClosingLayer(stack, 'share', closes)

    await browserBack()
    expect(closes).toEqual(['share'])
    expect(entry()).toEqual({ index: 1, layer: 1 })

    await browserBack()
    expect(closes).toEqual(['share', 'detail'])
    expect(entry()).toEqual({ index: 0, layer: undefined })
    // Both entries were consumed by the browser, so closing steps back over nothing.
    expect(go).not.toHaveBeenCalled()
  })

  it('closing the top layer by X, Escape, swipe or the back arrow steps back over its entry once; that step closes nothing below', async () => {
    const { stack, go, entry } = await setup()
    const closes: string[] = []
    openClosingLayer(stack, 'detail', closes)
    const share = stack.openLayerHistory(() => closes.push('share'))

    share.release()
    await settle()

    expect(go).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith(-1)
    expect(entry()).toEqual({ index: 1, layer: 1 })
    expect(closes, 'the detail under it stays open').toEqual([])
  })

  it('two layers closed in one task traverse once, two steps back', async () => {
    const { stack, go, entry } = await setup()
    const detail = stack.openLayerHistory(() => undefined)
    const share = stack.openLayerHistory(() => undefined)

    share.release()
    detail.release()
    await settle()

    expect(go).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith(-2)
    expect(entry()).toEqual({ index: 0, layer: undefined })
  })

  it('a layer opened while a close is still stepping back pushes only after that step lands', async () => {
    const { stack, pushState, entry } = await setup()
    const first = stack.openLayerHistory(() => undefined)
    expect(pushState).toHaveBeenCalledTimes(1)

    first.release()
    stack.openLayerHistory(() => undefined)
    await Promise.resolve()
    expect(pushState, 'no push below the step in flight').toHaveBeenCalledTimes(1)

    await settle()
    expect(pushState).toHaveBeenCalledTimes(2)
    // The new layer's entry sits on the position the first one left, not below it.
    expect(entry()).toEqual({ index: 1, layer: 2 })
  })

  it('a link hand-off leaves history to the navigation: release steps back over nothing (P2)', async () => {
    const { stack, go } = await setup()
    const layer = stack.openLayerHistory(() => undefined)

    layer.handOff()
    window.history.replaceState(routerState('/looks/plan'), '', '/looks/plan')
    layer.release()
    await settle()

    expect(go).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/looks/plan')
  })

  it('a layer released after a replace to another URL does not step back', async () => {
    const { stack, go } = await setup()
    const layer = stack.openLayerHistory(() => undefined)

    window.history.replaceState(routerState('/looks/plan'), '', '/looks/plan')
    layer.release()
    await settle()

    expect(go).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/looks/plan')
  })

  it('a layer released after a navigation pushed above it does not step back', async () => {
    const { stack, go, entry } = await setup()
    const layer = stack.openLayerHistory(() => undefined)

    window.history.pushState(routerState('/looks/plan'), '', '/looks/plan')
    layer.release()
    await settle()

    expect(go).not.toHaveBeenCalled()
    expect(entry()).toEqual({ index: 2, layer: undefined })
  })

  it('a layer that refuses to close on back gets its entry again', async () => {
    const { stack, pushState, entry } = await setup()
    // An upload in flight: close() is a no-op, the layer stays open.
    stack.openLayerHistory(() => undefined)
    expect(pushState).toHaveBeenCalledTimes(1)

    await browserBack()

    expect(pushState, 'entry restored for the next back').toHaveBeenCalledTimes(2)
    expect(entry()).toEqual({ index: 1, layer: 1 })
  })

  it('a layer that did close on back is not given a new entry', async () => {
    const { stack, pushState, entry } = await setup()
    openClosingLayer(stack, 'detail', [])

    await browserBack()

    expect(pushState).toHaveBeenCalledTimes(1)
    expect(entry()).toEqual({ index: 0, layer: undefined })
  })

  it('a popstate with no open layer changes nothing', async () => {
    const { stack, pushState, go } = await setup(['/looks', '/community'])
    const layer = stack.openLayerHistory(() => undefined)
    layer.handOff()
    layer.release()

    await browserBack()

    expect(pushState).toHaveBeenCalledTimes(1)
    expect(go).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/community')
  })

  it('sign-out closes every open layer, top first (P8)', async () => {
    const { stack } = await setup()
    const closes: string[] = []
    stack.openLayerHistory(() => closes.push('detail'))
    stack.openLayerHistory(() => closes.push('share'))

    window.dispatchEvent(new Event('couture:signed-out'))
    expect(closes).toEqual(['share', 'detail'])
  })

  it('[Codex 7.11 #7] after an X close, Forward onto the stale layer entry steps back over it, so the next Back leaves the page', async () => {
    const { stack, go, entry } = await setup(['/looks', '/community'])
    const closes: string[] = []
    const layer = stack.openLayerHistory(() => closes.push('detail'))
    expect(entry()).toEqual({ index: 2, layer: 1 })

    layer.release()
    await settle()
    expect(go).toHaveBeenCalledTimes(1)
    expect(entry()).toEqual({ index: 1, layer: undefined })

    await browserForward()
    expect(go, 'stepped back over the closed layer entry').toHaveBeenCalledTimes(2)
    expect(go).toHaveBeenLastCalledWith(-1)
    expect(entry()).toEqual({ index: 1, layer: undefined })
    expect(window.location.pathname).toBe('/community')

    // No dead Back: one press leaves Community for the page below it.
    await browserBack()
    expect(window.location.pathname).toBe('/looks')
    expect(entry().index).toBe(0)
    expect(closes, 'a closed layer is never closed again').toEqual([])
  })

  it('[Codex 7.11 #7] Forward onto a stale entry above a live stacked layer leaves that layer open', async () => {
    const { stack, go, entry } = await setup()
    const closes: string[] = []
    openClosingLayer(stack, 'detail', closes)
    openClosingLayer(stack, 'share', closes)

    await browserBack()
    expect(closes).toEqual(['share'])

    await browserForward()
    expect(closes, 'the traversal and its step back do not close the detail').toEqual([
      'share',
    ])
    expect(go).toHaveBeenCalledTimes(1)
    expect(entry()).toEqual({ index: 1, layer: 1 })

    await browserBack()
    expect(closes).toEqual(['share', 'detail'])
    expect(entry()).toEqual({ index: 0, layer: undefined })
  })

  it('[Codex 7.11 #7] a popstate onto a live layer entry (no layer above it) closes nothing', async () => {
    const { stack, go, pushState } = await setup()
    const closes: string[] = []
    openClosingLayer(stack, 'detail', closes)

    // A traversal that lands on the entry already on show, as a fragment traversal does.
    window.dispatchEvent(
      new PopStateEvent('popstate', { state: window.history.state as unknown })
    )
    await settle()

    expect(closes).toEqual([])
    expect(go).not.toHaveBeenCalled()
    expect(pushState).toHaveBeenCalledTimes(1)
  })

  it('[Codex 7.11 #7] a suspended layer gives up its entry and takes a new one on resume', async () => {
    const { stack, go, entry } = await setup()
    const closes: string[] = []
    // The detail suspends while the share sheet opens over it, in one task.
    const detail = stack.openLayerHistory(() => closes.push('detail'))
    detail.release()
    openClosingLayer(stack, 'share', closes)
    await settle()
    expect(go).toHaveBeenCalledTimes(1)
    expect(entry(), 'the share entry replaces the suspended detail entry').toEqual({
      index: 1,
      layer: 2,
    })

    await browserBack()
    expect(closes).toEqual(['share'])
    expect(entry()).toEqual({ index: 0, layer: undefined })

    // The detail resumes and owns a new entry, which the next back closes.
    openClosingLayer(stack, 'detail', closes)
    expect(entry()).toEqual({ index: 1, layer: 3 })
    await browserBack()
    expect(closes).toEqual(['share', 'detail'])
    expect(entry()).toEqual({ index: 0, layer: undefined })
    expect(go).toHaveBeenCalledTimes(1)
  })
})
