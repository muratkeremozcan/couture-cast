'use client'

import { useSyncExternalStore } from 'react'
import {
  APP_SIGNED_OUT_EVENT,
  appHistoryIndexOf,
  currentAppHistoryIndex,
} from '../../lib/app-history'

/**
 * One stack owns everything modals share on the page: which dialog is on top (Escape
 * closes only that one), the inertness of the background behind every open dialog, and
 * the body scroll lock (shared with full-screen surfaces that are not dialogs through
 * acquireScrollLock). Each AccessibleModal registers while it is open and not
 * suspended, so nested and simultaneous suspend, resume and teardown all reduce to
 * entries joining and leaving this one list. The page state is captured when the first
 * entry joins and restored when the last one leaves; no dialog snapshots it itself.
 */
type Entry = { id: string; order: number; close: () => void }
type Prior = { inert: boolean; hidden: string | null }

/** The attribute AccessibleModal puts on its overlay. The stack never touches elements
 * that carry it; React owns their inert and aria-hidden attributes. */
const OVERLAYS = '[data-modal-overlay]'

const entries: Entry[] = []
const listeners = new Set<() => void>()
const background = new Map<HTMLElement, Prior>()
let releaseStackScrollLock: (() => void) | null = null
let scrollHolders = 0
let overflowBeforeLock = ''
let nextOrder = 0

/**
 * The page's one body scroll lock. Every holder, a stacked dialog or a full-screen
 * overlay that is not a dialog, takes the lock here; the overflow value in place before
 * the first holder is restored when the last one releases, whatever the release order.
 */
export function acquireScrollLock(): () => void {
  if (scrollHolders++ === 0) overflowBeforeLock = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    if (--scrollHolders === 0) document.body.style.overflow = overflowBeforeLock
  }
}

/** A rank fixed when a dialog opens, so resuming dialogs regain their relative order. */
export const nextModalOrder = () => ++nextOrder

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const top = entries.at(-1)
  if (!top) return
  event.preventDefault()
  event.stopPropagation()
  top.close()
}

function backgroundElements(): Set<HTMLElement> {
  return new Set<HTMLElement>([
    ...Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.matches(`script,style,link,${OVERLAYS}`)
    ),
    ...Array.from(document.querySelectorAll<HTMLElement>('[data-app-shell]')).filter(
      (element) => !element.matches(OVERLAYS) && !element.querySelector(OVERLAYS)
    ),
  ])
}

function restore(element: HTMLElement, { inert, hidden }: Prior) {
  element.inert = inert
  if (hidden === null) element.removeAttribute('aria-hidden')
  else element.setAttribute('aria-hidden', hidden)
}

function engage() {
  if (!releaseStackScrollLock) {
    releaseStackScrollLock = acquireScrollLock()
    document.addEventListener('keydown', handleEscape, true)
  }
  const next = backgroundElements()
  for (const [element, prior] of background)
    if (!next.has(element)) {
      restore(element, prior)
      background.delete(element)
    }
  for (const element of next)
    if (!background.has(element)) {
      background.set(element, {
        inert: element.inert ?? false,
        hidden: element.getAttribute('aria-hidden'),
      })
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
}

function release() {
  if (!releaseStackScrollLock) return
  document.removeEventListener('keydown', handleEscape, true)
  releaseStackScrollLock()
  releaseStackScrollLock = null
  for (const [element, prior] of background) restore(element, prior)
  background.clear()
}

function update() {
  if (entries.length > 0) engage()
  else release()
  for (const listener of [...listeners]) listener()
}

/** Puts a dialog on the stack by its open order; the returned function removes it. */
export function registerModal(entry: Entry): () => void {
  entries.push(entry)
  entries.sort((a, b) => a.order - b.order)
  update()
  return () => {
    const index = entries.indexOf(entry)
    if (index === -1) return
    entries.splice(index, 1)
    update()
  }
}

const isCovered = (id: string) => {
  const index = entries.findIndex((entry) => entry.id === id)
  return index !== -1 && index < entries.length - 1
}

/** Whether another open dialog sits above this one, which must then be inert. */
export const useModalCovered = (id: string) =>
  useSyncExternalStore(
    subscribe,
    () => isCovered(id),
    () => false
  )

/*
 * Story CC-7.11 D13, P2, P8: every open layer owns one same-URL history entry, so browser or
 * system back closes the top layer and history does not grow.
 *
 * Opening pushes `history.pushState({...history.state, __ccLayer: id}, '', location.href)`: the
 * copy carries the app router's own state, so its popstate restores the same tree with no
 * navigation, refetch or remount, and lib/app-history.ts stamps the entry's position. A popstate
 * closes exactly the live layers whose entries sit above the position it landed on (review #7):
 * a Forward or any other traversal that leaves them in place closes nothing. Closing any other
 * way (X, Escape, swipe, the back arrow) steps back over the layer's entry. A Forward onto the
 * entry of a layer that already closed steps back over it again, so the next Back is never dead.
 * History moves are serialized: a push waits until every back step this module started has
 * landed, so a layer opening right after another closed never lands below it.
 */
type Layer = {
  id: number
  /** The position of its entry, or null while it has none. */
  index: number | null
  /** The address its entry was pushed for; a navigation since then owns the history. */
  url: string
  close: () => void
  live: boolean
}

/** The state key naming the layer an entry belongs to. */
const LAYER_KEY = '__ccLayer'

const layers: Layer[] = []
let nextLayerId = 0
/** Steps of the back traversal this module started whose popstate has not arrived yet. */
let stepsInFlight = 0
/** Back steps requested in this task, flushed as one traversal. */
let backsToFlush = 0
let waitingPushes: Layer[] = []

function flushBacks() {
  const steps = backsToFlush
  backsToFlush = 0
  if (steps === 0) return
  stepsInFlight += steps
  window.history.go(-steps)
}

function requestBack() {
  if (backsToFlush++ === 0) queueMicrotask(flushBacks)
}

function pushEntry(layer: Layer) {
  if (!layer.live) return
  if (stepsInFlight > 0 || backsToFlush > 0) {
    if (!waitingPushes.includes(layer)) waitingPushes.push(layer)
    return
  }
  const state: unknown = window.history.state
  const base = state !== null && typeof state === 'object' ? state : {}
  window.history.pushState({ ...base, [LAYER_KEY]: layer.id }, '', window.location.href)
  layer.index = currentAppHistoryIndex()
  layer.url = window.location.href
}

function flushWaitingPushes() {
  const waiting = waitingPushes
  waitingPushes = []
  for (const layer of waiting) pushEntry(layer)
}

function layerIdOf(state: unknown): number | undefined {
  if (state === null || typeof state !== 'object') return undefined
  const id = (state as Record<string, unknown>)[LAYER_KEY]
  return typeof id === 'number' ? id : undefined
}

function handleLayerPopState(event: PopStateEvent) {
  stepsInFlight = 0
  const landed = appHistoryIndexOf(event.state) ?? currentAppHistoryIndex()
  const above = layers.filter((layer) => layer.index !== null && layer.index > landed)
  for (const layer of above.reverse()) {
    layer.index = null
    layer.close()
    // A layer that refused to close (an upload in flight, a discard prompt) keeps its place in
    // history, so the next back step still reaches it. A timeout, so a layer that did close has
    // rendered and unmounted first.
    window.setTimeout(() => {
      if (layer.live && layers.includes(layer) && layer.index === null) pushEntry(layer)
    }, 0)
  }
  const owner = layerIdOf(event.state)
  if (owner !== undefined && !layers.some((layer) => layer.id === owner && layer.live)) {
    // A traversal onto the entry of a layer that already closed: step back over it.
    requestBack()
    return
  }
  if (backsToFlush === 0) flushWaitingPushes()
}

function closeEveryLayer() {
  for (const layer of [...layers].reverse()) layer.close()
}

let layerListenersInstalled = false
function installLayerListeners() {
  if (layerListenersInstalled || typeof window === 'undefined') return
  layerListenersInstalled = true
  window.addEventListener('popstate', handleLayerPopState)
  // P8: sign-out closes every open layer.
  window.addEventListener(APP_SIGNED_OUT_EVENT, closeEveryLayer)
}

/** What an open layer holds of its history entry. */
export interface LayerHistory {
  /** The layer closed: step back over its entry unless back already consumed it. */
  release: () => void
  /**
   * A link inside the layer is about to replace the layer's entry with another URL (TEA P2), so
   * closing must not step back over it.
   */
  handOff: () => void
}

/**
 * Gives an open layer its history entry, for as long as it stays open and is not suspended.
 */
export function openLayerHistory(close: () => void): LayerHistory {
  installLayerListeners()
  const layer: Layer = { id: ++nextLayerId, index: null, url: '', close, live: true }
  layers.push(layer)
  pushEntry(layer)
  return {
    release: () => {
      if (!layer.live) return
      layer.live = false
      layers.splice(layers.indexOf(layer), 1)
      waitingPushes = waitingPushes.filter((waiting) => waiting !== layer)
      // Only an entry still on top is stepped over: back already left one below it, and a
      // navigation since it was pushed (another address) owns the history from there. Back
      // steps already requested in this task count, so layers closing together step back once
      // each.
      const top = currentAppHistoryIndex() - stepsInFlight - backsToFlush
      if (
        layer.index !== null &&
        layer.index === top &&
        window.location.href === layer.url
      )
        requestBack()
      layer.index = null
    },
    handOff: () => {
      layer.index = null
    },
  }
}
