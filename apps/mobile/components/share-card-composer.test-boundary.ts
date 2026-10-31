import type * as ReactNativeModule from 'react-native'
import { createElement, useEffect, type ReactNode } from 'react'
import { vi } from 'vitest'

/**
 * The share-card composer tests' mocked boundary: the state every mock reads and the factory
 * bodies. Each composer test file registers its own `vi.mock` calls and loads this module
 * inside the factories (`await import(...)`), the same split `community-screen/mock-state`
 * uses, so the entrypoint's mock registration still precedes every case import.
 */
export const boundary = {
  prepare: vi.fn(),
  permission: vi.fn(),
  save: vi.fn(),
  available: true,
  member: 'member-a' as string | null,
  identityEpoch: 0,
  subscribers: new Set<() => void>(),
  appState: new Set<(state: string) => void>(),
  focus: vi.fn(),
  announce: vi.fn(),
  settings: vi.fn(),
  imageLoads: [] as (() => void)[],
  capabilities: vi.fn(),
  shareModule: true,
  shareFile: vi.fn(),
  /** Records each analytics capture; it returns nothing. */
  capture: vi.fn(),
  /**
   * What the analytics client's capture hands back, from a plain function: a `vi.fn` that
   * returned a rejecting promise would subscribe to it and hide a missing catch.
   */
  captureResult: (): unknown => undefined,
  files: new Map<string, string>(),
  deleted: [] as string[],
  write: vi.fn(),
  /** The mocked modal's `onRequestClose`, the handler Android Back invokes. */
  requestClose: undefined as (() => void) | undefined,
}

// Distinct tags, so a focus on the wrong recovery action cannot pass for the right one.
const focusTags: Record<string, number> = {
  'share-card-title': 41,
  'share-card-save': 42,
  'share-card-retry': 43,
  'share-card-cancel': 44,
  'share-card-share': 45,
  'share-card-refresh': 46,
  'share-card-settings': 47,
}

export const composerMocks = {
  mobileAuth: () => ({
    mobileApplicationUserId: () => boundary.member,
    mobileIdentityEpoch: () => boundary.identityEpoch,
    subscribeMobileApplicationUser: (listener: () => void) => {
      boundary.subscribers.add(listener)
      return () => boundary.subscribers.delete(listener)
    },
  }),
  shareCards: () => ({
    prepareShareCardFromMobile: boundary.prepare,
    shareCardCapabilitiesFromMobile: boundary.capabilities,
  }),
  nativeShare: () => ({
    shareCardNativeShareModule: () =>
      boundary.shareModule ? { shareFile: boundary.shareFile } : null,
  }),
  analytics: () => ({
    mobileAnalyticsClient: {
      capture: (...args: unknown[]) => {
        boundary.capture(...args)
        return boundary.captureResult()
      },
    },
  }),
  fileSystem: () => ({
    cacheDirectory: 'file:///cache/',
    EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: () => Promise.resolve(),
    writeAsStringAsync: boundary.write,
    // Deleting a directory deletes the files under it, as on a device.
    deleteAsync: (uri: string) => {
      boundary.deleted.push(uri)
      const directory = uri.endsWith('/') ? uri : `${uri}/`
      for (const file of [...boundary.files.keys()])
        if (file === uri || file.startsWith(directory)) boundary.files.delete(file)
      return Promise.resolve()
    },
    getInfoAsync: (uri: string) =>
      Promise.resolve(
        uri.endsWith('/')
          ? { exists: true, isDirectory: true }
          : boundary.files.has(uri)
            ? { exists: true, isDirectory: false, modificationTime: Date.now() / 1000 }
            : { exists: false }
      ),
    readDirectoryAsync: () =>
      Promise.resolve([...boundary.files.keys()].map((uri) => uri.split('/').at(-1))),
  }),
  crypto: () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: (_algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
      crypto.subtle.digest('SHA-256', bytes),
    randomUUID: () => crypto.randomUUID(),
  }),
  save: () => ({
    nativeShareCardSaveAvailable: () => boundary.available,
    shareCardSavePermission: boundary.permission,
    saveShareCard: boundary.save,
  }),
  accessibilityFocusHandles: () => ({
    safeFindNodeHandle: (node: HTMLElement | null) =>
      focusTags[node?.getAttribute('data-testid') ?? ''] ?? 41,
  }),
  accessibilityFocusModule: () => ({
    focusAccessibilityElement: (tag: number) => {
      boundary.focus(tag)
      return Promise.resolve(true)
    },
  }),
  modal: () => ({
    useModalInsets: () => ({ top: 10, bottom: 10, left: 0, right: 0 }),
    EdgeToEdgeModal: ({
      visible,
      children,
      onShow,
      onDismiss,
      onRequestClose,
    }: {
      visible: boolean
      children: ReactNode
      onShow?: () => void
      onDismiss?: () => void
      onRequestClose?: () => void
    }) => {
      boundary.requestClose = visible ? onRequestClose : undefined
      useEffect(() => {
        if (visible) onShow?.()
        return () => {
          if (visible) onDismiss?.()
        }
      }, [visible])
      return visible ? createElement('div', { role: 'dialog' }, children) : null
    },
  }),
  reactNative: (actual: typeof ReactNativeModule) => ({
    ...actual,
    Platform: { ...actual.Platform, OS: 'ios' },
    Image: ({
      testID,
      accessibilityLabel,
      style,
      onLoad,
      onError,
    }: {
      testID: string
      accessibilityLabel: string
      style: ReactNativeModule.StyleProp<ReactNativeModule.ImageStyle>
      onLoad: () => void
      onError: () => void
    }) => {
      boundary.imageLoads.push(onLoad)
      // The composer's own size and alignment, so layout cases measure the real frame.
      const { width, aspectRatio, alignSelf } = actual.StyleSheet.flatten(style)
      return createElement('img', {
        'data-testid': testID,
        alt: accessibilityLabel,
        style: { width, aspectRatio, alignSelf },
        onLoad,
        onError,
      })
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: boundary.focus,
      announceForAccessibilityWithOptions: boundary.announce,
    },
    Linking: { ...actual.Linking, openSettings: boundary.settings },
    AppState: {
      ...actual.AppState,
      addEventListener: (_event: string, listener: (state: string) => void) => {
        boundary.appState.add(listener)
        return { remove: () => boundary.appState.delete(listener) }
      },
    },
  }),
}
