import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { resolveMobileApiBaseUrl } from '@/src/lib/api-client'

type Listener = (online: boolean) => void
export type NetworkConnectivityProbe = (signal: AbortSignal) => Promise<boolean>

const PROBE_TIMEOUT_MS = 4_000
const OFFLINE_RECOVERY_POLL_MS = 10_000

type ActiveProbe = {
  controller: AbortController
  promise: Promise<boolean>
  waiters: number
}

let currentOnline = readBrowserOnline()
const listeners = new Set<Listener>()
let windowListenersBound = false
let customProbe: NetworkConnectivityProbe | null = null
let inFlightProbe: ActiveProbe | null = null

export function readBrowserOnline(): boolean {
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
  if (typeof fetch !== 'function') return null
  let baseUrl: string
  try {
    baseUrl = resolveMobileApiBaseUrl()
  } catch {
    return null
  }
  const healthUrl = `${baseUrl}/api/health`
  return async (signal) => {
    try {
      // Any HTTP response (including 503) proves network connectivity; only a transport
      // exception indicates the device is offline.
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
  if (inFlightProbe) {
    inFlightProbe.controller.abort()
    inFlightProbe = null
  }
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

export function probeNetworkConnectivity(externalSignal?: AbortSignal): Promise<boolean> {
  if (externalSignal?.aborted) return Promise.resolve(false)

  let entry = inFlightProbe
  if (!entry) {
    const probe = resolveProbe()
    if (!probe) {
      if (hasReliableBrowserOnline()) {
        const online = readBrowserOnline()
        notify(online)
        return Promise.resolve(online)
      }
      return Promise.resolve(currentOnline)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const activeEntry: ActiveProbe = {
      controller,
      waiters: 0,
      promise: Promise.resolve(false),
    }

    activeEntry.promise = (async () => {
      try {
        const reachable = await probe(controller.signal)
        if (controller.signal.aborted) return false
        if (reachable) {
          reportNetworkOnline()
          return true
        }
        return false
      } catch {
        return false
      }
    })().finally(() => {
      clearTimeout(timeout)
      if (inFlightProbe === activeEntry) {
        inFlightProbe = null
      }
    })

    inFlightProbe = activeEntry
    entry = activeEntry
  }

  const shared = entry
  shared.waiters += 1

  if (!externalSignal) {
    return shared.promise.finally(() => {
      shared.waiters = Math.max(0, shared.waiters - 1)
    })
  }

  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (value: boolean, cancelledByCaller: boolean) => {
      if (settled) return
      settled = true
      externalSignal.removeEventListener('abort', onAbort)
      shared.waiters = Math.max(0, shared.waiters - 1)
      if (cancelledByCaller && shared.waiters === 0) {
        shared.controller.abort()
      }
      resolve(value)
    }
    const onAbort = () => settle(false, true)
    externalSignal.addEventListener('abort', onAbort, { once: true })
    void shared.promise.then((value) => settle(value, false))
  })
}

/**
 * Checks connectivity before running a network-backed save action.
 * On web / browsers with `navigator.onLine`, offline strictly short-circuits.
 * On native without `navigator.onLine`, shares the single in-flight probe (if configured)
 * or allows an explicit user retry to attempt the request so the app never deadlocks offline.
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
  if (inFlightProbe) {
    inFlightProbe.controller.abort()
    inFlightProbe = null
  }
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
