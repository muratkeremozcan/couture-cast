import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'

type Listener = (online: boolean) => void
export type NetworkConnectivityProbe = (signal: AbortSignal) => Promise<boolean>

const PROBE_TIMEOUT_MS = 4_000
const OFFLINE_RECOVERY_POLL_MS = 10_000

let currentOnline = readBrowserOnline()
const listeners = new Set<Listener>()
let windowListenersBound = false
let customProbe: NetworkConnectivityProbe | null = null

function readBrowserOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine
  }
  return true
}

export function hasReliableBrowserOnline(): boolean {
  return (
    Platform.OS === 'web' ||
    (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean')
  )
}

function getDefaultNativeProbe(): NetworkConnectivityProbe | null {
  if (Platform.OS === 'web') return null
  const apiUrl =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_URL : undefined
  if (!apiUrl || typeof fetch !== 'function') return null
  const healthUrl = `${apiUrl.replace(/\/$/, '')}/api/health`
  return async (signal) => {
    try {
      await fetch(healthUrl, { method: 'HEAD', signal })
      return true
    } catch {
      return false
    }
  }
}

function resolveProbe(): NetworkConnectivityProbe | null {
  return customProbe ?? getDefaultNativeProbe()
}

function notify(next: boolean) {
  if (currentOnline === next) return
  currentOnline = next
  listeners.forEach((listener) => listener(currentOnline))
}

function ensureWindowListeners() {
  if (windowListenersBound) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return
  }
  windowListenersBound = true
  window.addEventListener('online', () => notify(true))
  window.addEventListener('offline', () => notify(false))
}

export function setNetworkConnectivityProbe(
  probe: NetworkConnectivityProbe | null
): void {
  customProbe = probe
}

export function getNetworkOnline(): boolean {
  ensureWindowListeners()
  return currentOnline
}

export function reportNetworkOffline(): void {
  notify(false)
}

export function reportNetworkOnline(): void {
  notify(true)
}

export function subscribeNetworkStatus(listener: Listener): () => void {
  ensureWindowListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function probeNetworkConnectivity(
  externalSignal?: AbortSignal
): Promise<boolean> {
  if (externalSignal?.aborted) return false
  const probe = resolveProbe()
  if (!probe) {
    if (hasReliableBrowserOnline()) {
      const online = readBrowserOnline()
      notify(online)
      return online
    }
    return currentOnline
  }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const reachable = await probe(controller.signal)
    if (externalSignal?.aborted) return false
    if (reachable) {
      reportNetworkOnline()
      return true
    }
    return false
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Checks connectivity before running a network-backed save action.
 * On web / browsers with `navigator.onLine`, offline strictly short-circuits.
 * On native without `navigator.onLine`, runs the configured probe (if any) or allows
 * an explicit user retry to attempt the request so the app never deadlocks offline.
 */
export async function checkNetworkOnlineForAction(): Promise<boolean> {
  if (getNetworkOnline()) return true
  if (hasReliableBrowserOnline()) {
    return readBrowserOnline()
  }
  const probe = resolveProbe()
  if (probe) {
    return probeNetworkConnectivity()
  }
  return true
}

/** Resets store state and custom probe cleanly between tests. */
export function resetNetworkStatusForTests(online: boolean = readBrowserOnline()): void {
  customProbe = null
  currentOnline = online
  listeners.forEach((listener) => listener(currentOnline))
}

export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => getNetworkOnline())

  useEffect(() => {
    const unsubscribe = subscribeNetworkStatus(setOnline)
    setOnline(getNetworkOnline())

    if (Platform.OS === 'web') {
      return unsubscribe
    }

    let activeController: AbortController | null = null
    const runProbe = () => {
      if (getNetworkOnline()) return
      activeController?.abort()
      activeController = new AbortController()
      void probeNetworkConnectivity(activeController.signal)
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
          notify(navigator.onLine)
        } else {
          runProbe()
        }
      }
    })

    return () => {
      activeController?.abort()
      unsubscribe()
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (online || hasReliableBrowserOnline()) return
    if (!resolveProbe()) return

    let activeController: AbortController | null = null
    const interval = setInterval(() => {
      if (getNetworkOnline()) return
      activeController?.abort()
      activeController = new AbortController()
      void probeNetworkConnectivity(activeController.signal)
    }, OFFLINE_RECOVERY_POLL_MS)

    return () => {
      clearInterval(interval)
      activeController?.abort()
    }
  }, [online])

  return online
}
