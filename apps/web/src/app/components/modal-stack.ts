'use client'

import { useSyncExternalStore } from 'react'

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
