import type * as ReactNativeModule from 'react-native'
import React, { createElement, useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import {
  abortError,
  ResponseError,
  type PrepareShareCardInput,
} from '@couture/api-client'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import i18n, { initI18n } from '@/src/lib/i18n'
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
// The Android status-bar stack is a native window concern; Story 6.9 cases simulate Android.
vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: (open: boolean) => open,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
const boundary = vi.hoisted(() => {
  process.env.EXPO_OS = 'ios'
  return {
    prepare: vi.fn(),
    permission: vi.fn(),
    save: vi.fn(),
    available: true,
    member: 'member-a' as string | null,
    subscribers: new Set<() => void>(),
    appState: new Set<(state: string) => void>(),
    focus: vi.fn(),
    announce: vi.fn(),
    settings: vi.fn(),
    imageLoads: [] as (() => void)[],
    capabilities: vi.fn(),
    shareModule: true,
    shareFile: vi.fn(),
    capture: vi.fn(),
    files: new Map<string, string>(),
    write: vi.fn(),
  }
})
vi.mock('@/src/lib/mobile-auth', () => ({
  mobileApplicationUserId: () => boundary.member,
  subscribeMobileApplicationUser: (listener: () => void) => {
    boundary.subscribers.add(listener)
    return () => boundary.subscribers.delete(listener)
  },
}))
vi.mock('@/src/lib/share-cards', () => ({
  prepareShareCardFromMobile: boundary.prepare,
  shareCardCapabilitiesFromMobile: boundary.capabilities,
}))
// Story 6.9: the real share flow runs against a mocked file system, digest and module.
vi.mock('@/src/lib/share-card-share', () =>
  vi.importActual('../src/lib/share-card-share.native')
)
vi.mock('../modules/share-card-native-share', () => ({
  shareCardNativeShareModule: () =>
    boundary.shareModule ? { shareFile: boundary.shareFile } : null,
}))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  mobileAnalyticsClient: { capture: boundary.capture },
}))
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: () => Promise.resolve(),
  writeAsStringAsync: boundary.write,
  deleteAsync: (uri: string) => {
    boundary.files.delete(uri)
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
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: (_algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
    crypto.subtle.digest('SHA-256', bytes),
  randomUUID: () => crypto.randomUUID(),
}))
vi.mock('@/src/lib/share-card-save', () => ({
  nativeShareCardSaveAvailable: () => boundary.available,
  shareCardSavePermission: boundary.permission,
  saveShareCard: boundary.save,
}))
vi.mock('@/src/lib/accessibility-focus', () => ({
  safeFindNodeHandle: (node: HTMLElement | null) =>
    ({
      'share-card-title': 41,
      'share-card-save': 42,
      'share-card-retry': 43,
      'share-card-refresh': 43,
      'share-card-settings': 43,
      'share-card-cancel': 44,
      'share-card-share': 45,
    })[node?.getAttribute('data-testid') ?? ''] ?? 41,
}))
vi.mock('../modules/accessibility-focus', () => ({
  focusAccessibilityElement: (tag: number) => {
    boundary.focus(tag)
    return Promise.resolve(true)
  },
}))
vi.mock('./edge-to-edge-modal', () => ({
  useModalInsets: () => ({ top: 10, bottom: 10, left: 0, right: 0 }),
  EdgeToEdgeModal: ({
    visible,
    children,
    onShow,
    onDismiss,
  }: {
    visible: boolean
    children: React.ReactNode
    onShow?: () => void
    onDismiss?: () => void
  }) => {
    useEffect(() => {
      if (visible) onShow?.()
      return () => {
        if (visible) onDismiss?.()
      }
    }, [visible])
    return visible ? createElement('div', { role: 'dialog' }, children) : null
  },
}))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNativeModule>()
  return {
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
  }
})
import { Platform } from 'react-native'
import { ShareCardComposer } from './share-card-composer'
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
}
import {
  commitShareCardSave,
  nativeShareCardSavePending,
  liveShareCardFiles,
} from '@/src/lib/share-card-save-operations'
const source = { kind: 'outfit', recommendationId: 'owned-outfit' } as const
// The save manager's pending guard is process-wide, so a test that fails while a native
// save is held would make every later save in this file fail with finishingSave.
const unsettled = new Set<() => void>()
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  unsettled.add(() => resolve(undefined as T))
  return { promise, resolve }
}
function Harness({ restore = vi.fn() }: { restore?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      <ShareCardComposer
        source={source}
        open={open}
        onClose={() => setOpen(false)}
        onRestoreFocus={restore}
      />
    </>
  )
}
async function ready() {
  const image = await screen.findByTestId('share-card-preview')
  fireEvent.load(image)
  await waitFor(() =>
    expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  )
  return image
}
function changeIdentity(member: string | null) {
  act(() => {
    boundary.member = member
    boundary.subscribers.forEach((listener) => listener())
  })
}
beforeEach(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
  boundary.member = 'member-a'
  boundary.available = true
  boundary.prepare.mockReset().mockResolvedValue(card)
  boundary.permission.mockReset().mockResolvedValue({ granted: true, canAskAgain: true })
  boundary.save.mockReset().mockResolvedValue(undefined)
  boundary.focus.mockClear()
  boundary.announce.mockClear()
  boundary.settings.mockClear()
  boundary.imageLoads.length = 0
  boundary.capabilities.mockReset().mockResolvedValue({ nativeShare: false })
  boundary.shareModule = true
  boundary.shareFile
    .mockReset()
    .mockResolvedValue({ target: 'instagram', outcome: 'completed' })
  boundary.capture.mockReset()
  boundary.files.clear()
  boundary.write.mockReset().mockImplementation((uri: string, bytes: string) => {
    boundary.files.set(uri, bytes)
    return Promise.resolve()
  })
  setOS('ios')
})
afterEach(async () => {
  cleanup()
  await act(async () => {
    unsettled.forEach((settle) => settle())
    unsettled.clear()
    await Promise.resolve()
  })
  await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
  expect(liveShareCardFiles().size).toBe(0)
})
describe('share-card composer lifecycle', () => {
  it('simulates iOS for Expo packages as well as react-native', () => {
    // Expo packages read process.env.EXPO_OS when they load; the suite default is 'web'.
    expect(process.env.EXPO_OS).toBe('ios')
    expect(Platform.OS).toBe('ios')
  })
  it('U-SAVE U-A11Y: loaded image and explicit permission precede final save authorization; native resolution owns success', async () => {
    const native = deferred<void>()
    boundary.save.mockReturnValue(native.promise)
    render(<Harness />)
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(boundary.save).toHaveBeenCalledOnce())
    expect(boundary.permission).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(boundary.prepare.mock.calls[1]?.[0]).toMatchObject({
      purpose: 'save',
      expectedSha256: card.sha256,
    })
    expect(screen.queryByText(i18n.t('shareCard.saved'))).not.toBeInTheDocument()
    native.resolve()
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    expect(screen.getByTestId('share-card-watermark')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await waitFor(() =>
      expect(
        boundary.announce.mock.calls.filter(
          ([text]) => text === i18n.t('shareCard.saved')
        )
      ).toEqual([[i18n.t('shareCard.saved'), { queue: true }]])
    )
    expect(boundary.focus).toHaveBeenCalledWith(41)
  })
  it('M3: the real manager keeps this save on Saving without moving focus to Cancel', async () => {
    const native = deferred<void>()
    boundary.save.mockImplementation((_card, _signal, _isCurrent, owner) =>
      commitShareCardSave({
        fileUri: 'cc68-own-save.png',
        owner,
        save: () => native.promise,
        cleanup: () => Promise.resolve(),
      })
    )
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(true))
    try {
      expect(screen.getByText(i18n.t('shareCard.saving'))).toBeInTheDocument()
      expect(
        screen.queryByText(i18n.t('shareCard.finishingSave'))
      ).not.toBeInTheDocument()
      expect(boundary.focus).not.toHaveBeenCalledWith(44)
    } finally {
      await act(async () => {
        native.resolve()
        await native.promise
      })
    }
  })
  it('U-A11Y: modal show keeps Cancel focused when reopening an older committed save', async () => {
    const native = deferred<void>()
    boundary.save.mockImplementation((_card, _signal, _isCurrent, owner) =>
      commitShareCardSave({
        fileUri: 'cc68-reopen-modal-focus.png',
        owner,
        save: () => native.promise,
        cleanup: () => Promise.resolve(),
      })
    )
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(true))
    try {
      await userEvent.click(screen.getByTestId('share-card-cancel'))
      boundary.focus.mockClear()
      await userEvent.click(screen.getByText('Reopen'))
      expect(
        await screen.findByText(i18n.t('shareCard.finishingSave'))
      ).toBeInTheDocument()
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(44))
    } finally {
      await act(async () => {
        native.resolve()
        await native.promise
      })
    }
  })
  it('L5: reopening an older committed save re-enables the watermark after settlement', async () => {
    const native = deferred<void>()
    boundary.save.mockImplementation((_card, _signal, _isCurrent, owner) =>
      commitShareCardSave({
        fileUri: 'cc68-reopen-watermark.png',
        owner,
        save: () => native.promise,
        cleanup: () => Promise.resolve(),
      })
    )
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(true))
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    await userEvent.click(screen.getByText('Reopen'))
    await act(async () => {
      native.resolve()
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    expect(screen.getByTestId('share-card-watermark')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await userEvent.click(screen.getByTestId('share-card-watermark'))
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
  it.each([
    ['render', 'render'],
    ['invalid_file', 'render'],
    ['finishingSave', 'finishingSave'],
  ])('L4: native %s retains its precise recovery message', async (failure, key) => {
    boundary.save.mockRejectedValueOnce(new Error(failure))
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t(`shareCard.${key}`))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shareCard.storage'))).not.toBeInTheDocument()
  })
  it('L4: a native rejection uses its stable code when the message contains context', async () => {
    boundary.save.mockRejectedValueOnce(
      Object.assign(new Error('The original PNG was rejected'), { code: 'invalid_file' })
    )
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.render'))).toBeInTheDocument()
  })
  it.each([true, false])(
    'L4: Android ERR_PERMISSIONS rechecks canAskAgain=%s',
    async (canAskAgain) => {
      boundary.permission
        .mockResolvedValueOnce({ granted: true, canAskAgain: true })
        .mockResolvedValueOnce({ granted: false, canAskAgain })
      boundary.save.mockRejectedValueOnce(
        Object.assign(new Error('Missing MEDIA_LIBRARY write permission.'), {
          code: 'ERR_PERMISSIONS',
        })
      )
      render(<Harness />)
      await ready()
      await userEvent.click(screen.getByTestId('share-card-save'))
      expect(
        await screen.findByText(
          i18n.t(`shareCard.${canAskAgain ? 'permissionDenied' : 'permissionPermanent'}`)
        )
      ).toBeInTheDocument()
      expect(boundary.permission).toHaveBeenLastCalledWith(false)
    }
  )
  it('L4: a plain storage failure with permission words stays storage', async () => {
    boundary.save.mockRejectedValueOnce(
      new Error('Missing MEDIA_LIBRARY write permission.')
    )
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.storage'))).toBeInTheDocument()
    expect(boundary.permission).toHaveBeenCalledTimes(1)
  })
  it.each([true, false])(
    'L4: native permission denial rechecks canAskAgain=%s',
    async (canAskAgain) => {
      boundary.permission
        .mockResolvedValueOnce({ granted: true, canAskAgain: true })
        .mockResolvedValueOnce({ granted: false, canAskAgain })
      boundary.save.mockRejectedValueOnce(new Error('permission_denied'))
      render(<Harness />)
      await ready()
      await userEvent.click(screen.getByTestId('share-card-save'))
      expect(
        await screen.findByText(
          i18n.t(`shareCard.${canAskAgain ? 'permissionDenied' : 'permissionPermanent'}`)
        )
      ).toBeInTheDocument()
      expect(boundary.permission).toHaveBeenLastCalledWith(false)
    }
  )
  it('L3: European Portuguese uses Guardar in the live composer', async () => {
    await i18n.changeLanguage('pt-PT')
    render(<Harness />)
    await ready()
    expect(screen.getByTestId('share-card-save')).toHaveTextContent(
      'Guardar nas Fotografias'
    )
  })
  it('U-A11Y-CANCEL: dismissal restores the invoking control once after its modal closes', async () => {
    const restore = vi.fn()
    render(<Harness restore={restore} />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    await waitFor(() => expect(restore).toHaveBeenCalledOnce())
    expect(screen.queryByTestId('share-card-title')).not.toBeInTheDocument()
    await act(async () => {
      await Promise.resolve()
    })
    expect(restore).toHaveBeenCalledOnce()
  })
  it('U-PERMISSION-DENIED U-PERMISSION-PERMANENT: denied retry retains preview; settings return checks without saving', async () => {
    boundary.permission.mockResolvedValue({ granted: false, canAskAgain: true })
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(
      await screen.findByText(i18n.t('shareCard.permissionDenied'))
    ).toBeInTheDocument()
    expect(boundary.prepare).toHaveBeenCalledOnce()
    expect(boundary.save).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    boundary.permission.mockResolvedValue({ granted: false, canAskAgain: false })
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(
      await screen.findByText(i18n.t('shareCard.permissionPermanent'))
    ).toBeInTheDocument()
    await waitFor(() => expect(boundary.appState.size).toBe(1))
    await userEvent.click(screen.getByText(i18n.t('shareCard.openSettings')))
    expect(boundary.settings).toHaveBeenCalledOnce()
    boundary.permission.mockResolvedValue({ granted: true, canAskAgain: true })
    await act(async () => {
      boundary.appState.forEach((listener) => listener('active'))
      await Promise.resolve()
    })
    await waitFor(() => expect(boundary.permission).toHaveBeenLastCalledWith(false))
    expect(boundary.save).not.toHaveBeenCalled()
    expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
  })
  it('U-REVALIDATE: consent changes during a deferred OS permission dialog block import after grant', async () => {
    const permission = deferred<{ granted: boolean; canAskAgain: boolean }>()
    boundary.permission.mockReturnValue(permission.promise)
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(boundary.prepare).toHaveBeenCalledOnce()
    boundary.prepare.mockRejectedValueOnce(
      new ResponseError(new Response('{}', { status: 403 }))
    )
    permission.resolve({ granted: true, canAskAgain: true })
    expect(
      await screen.findByText(i18n.t('shareCard.sourceUnavailable'))
    ).toBeInTheDocument()
    expect(boundary.save).not.toHaveBeenCalled()
  })
  it.each(['close', 'identity'])(
    'U-IDENTITY U-PENDING-FILE: %s then returning to same composition suppresses old native completion',
    async (reason) => {
      const native = deferred<void>()
      boundary.save.mockImplementation(() =>
        commitShareCardSave({
          fileUri: 'cc68-composer.png',
          save: () => native.promise,
          cleanup: () => Promise.resolve(),
        })
      )
      render(<Harness />)
      await ready()
      await userEvent.click(screen.getByTestId('share-card-save'))
      await waitFor(() => expect(boundary.save).toHaveBeenCalledOnce())
      if (reason === 'close') {
        await userEvent.click(screen.getByTestId('share-card-cancel'))
        await userEvent.click(screen.getByText('Reopen'))
      } else {
        changeIdentity('member-b')
        changeIdentity('member-a')
      }
      expect(
        await screen.findByText(i18n.t('shareCard.finishingSave'))
      ).toBeInTheDocument()
      native.resolve()
      await waitFor(() =>
        expect(
          screen.queryByText(i18n.t('shareCard.finishingSave'))
        ).not.toBeInTheDocument()
      )
      expect(screen.queryByText(i18n.t('shareCard.saved'))).not.toBeInTheDocument()
      expect(screen.queryByText(i18n.t('shareCard.saving'))).not.toBeInTheDocument()
      expect(
        boundary.announce.mock.calls.some(([text]) => text === i18n.t('shareCard.saved'))
      ).toBe(false)
      expect(boundary.save).toHaveBeenCalledOnce()
    }
  )
  it.each([409, 404, 503])(
    'U-PREPARE-ERROR: final authorization%d retains preview and requires explicit recovery',
    async (status) => {
      render(<Harness />)
      await ready()
      boundary.prepare.mockRejectedValueOnce(
        new ResponseError(new Response('{}', { status }))
      )
      await userEvent.click(screen.getByTestId('share-card-save'))
      expect(
        await screen.findByText(
          i18n.t(
            `shareCard.${status === 409 ? 'previewChanged' : status === 404 ? 'sourceUnavailable' : 'render'}`
          )
        )
      ).toBeInTheDocument()
      expect(boundary.save).not.toHaveBeenCalled()
      await userEvent.click(
        screen.getByText(i18n.t(`shareCard.${status === 409 ? 'refresh' : 'retry'}`))
      )
      await waitFor(() => expect(boundary.prepare).toHaveBeenCalledTimes(3))
      expect(boundary.prepare.mock.calls[2]?.[0]).toMatchObject({ purpose: 'preview' })
    }
  )
  it('U-NATIVE-UNAVAILABLE: keeps loaded preview and disables Save before permission activation', async () => {
    boundary.available = false
    render(<Harness />)
    fireEvent.load(await screen.findByTestId('share-card-preview'))
    expect(
      screen.getByText(i18n.t('shareCard.nativeSaveUnavailable'))
    ).toBeInTheDocument()
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    // Playwright refuses to click an aria-disabled control; force models the user's tap anyway.
    await userEvent.click(screen.getByTestId('share-card-save'), { force: true })
    expect(boundary.permission).not.toHaveBeenCalled()
    expect(boundary.save).not.toHaveBeenCalled()
  })
  it('U-A11Y: iOS error announcements are immediate, deduplicated and identity scoped', async () => {
    boundary.permission.mockResolvedValue({ granted: false, canAskAgain: false })
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    const text = i18n.t('shareCard.permissionPermanent')
    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() =>
      expect(
        boundary.announce.mock.calls.filter(([message]) => message === text)
      ).toEqual([[text, { queue: false }]])
    )
    await userEvent.click(screen.getByText(i18n.t('shareCard.openSettings')))
    expect(
      boundary.announce.mock.calls.filter(([message]) => message === text)
    ).toHaveLength(1)
    changeIdentity('member-b')
    await waitFor(() => expect(screen.queryByText(text)).not.toBeInTheDocument())
    expect(
      boundary.announce.mock.calls.filter(([message]) => message === text)
    ).toHaveLength(1)
  })
  it('M1: pending preparation keeps exact feedback through watermark OFF and ON without a response', async () => {
    boundary.prepare.mockReturnValue(new Promise(() => undefined))
    render(<Harness />)
    const preparing = i18n.t('shareCard.preparing')
    expect(await screen.findByText(preparing)).toBeInTheDocument()
    expect(boundary.prepare).toHaveBeenCalledTimes(1)
    for (const checked of ['false', 'true']) {
      await userEvent.click(screen.getByTestId('share-card-watermark'))
      expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
        'aria-checked',
        checked
      )
      expect(screen.getByText(preparing)).toBeInTheDocument()
      expect(screen.queryByTestId('share-card-preview-loaded')).not.toBeInTheDocument()
      expect(screen.queryByTestId('share-card-error')).not.toBeInTheDocument()
    }
    expect(boundary.prepare).toHaveBeenCalledTimes(3)
    const calls = boundary.prepare.mock.calls as [PrepareShareCardInput, AbortSignal][]
    expect(calls.map(([input]) => input.watermark)).toEqual([true, false, true])
    expect(calls.slice(0, 2).every(([, signal]) => signal.aborted)).toBe(true)
    expect(calls[2]![1].aborted).toBe(false)
  })
  it.each(supportedLocales)(
    'U-A11Y-PREPARING: %s posts its exact localized preparation announcement and title target',
    async (locale) => {
      await i18n.changeLanguage(locale)
      boundary.prepare.mockReturnValue(new Promise(() => undefined))
      render(<Harness />)
      const text = i18n.t('shareCard.preparing')
      expect(await screen.findByText(text)).toBeInTheDocument()
      await waitFor(() =>
        expect(
          boundary.announce.mock.calls.filter(([message]) => message === text)
        ).toEqual([[text, { queue: true }]])
      )
      expect(boundary.focus).toHaveBeenCalledWith(41)
    }
  )
  it.each(
    supportedLocales.flatMap((locale) =>
      // The modal show focuses the title (41); the result then moves focus to Save (42),
      // the recovery action (43) or Cancel (44). Unavailable moves nothing past the title.
      (
        [
          ['saved', true, 42],
          ['storage', false, 43],
          ['offline', false, 43],
          ['permissionDenied', false, 43],
          ['permissionPermanent', false, 43],
          ['limited', true, 42],
          ['finishingSave', true, 44],
          ['nativeSaveUnavailable', false, null],
        ] as const
      ).map(([state, polite, focus]) => ({ locale, state, polite, focus }))
    )
  )(
    'U-A11Y: $locale $state posts its exact localized announcement with the correct queue',
    async ({ locale, state, polite, focus }) => {
      await i18n.changeLanguage(locale)
      if (state === 'nativeSaveUnavailable') boundary.available = false
      render(<Harness />)
      fireEvent.load(await screen.findByTestId('share-card-preview'))
      let pending: ReturnType<typeof deferred<void>> | undefined
      let committed: Promise<void> | undefined
      if (state === 'finishingSave') {
        pending = deferred<void>()
        committed = commitShareCardSave({
          fileUri: 'file:///owned-announcement.png',
          save: () => pending!.promise,
          cleanup: () => Promise.resolve(),
        })
      } else if (state !== 'nativeSaveUnavailable') {
        if (state === 'storage') boundary.save.mockRejectedValueOnce(new Error('storage'))
        if (state === 'offline')
          boundary.prepare.mockRejectedValueOnce(new Error('offline'))
        if (state === 'permissionDenied' || state === 'permissionPermanent')
          boundary.permission.mockResolvedValueOnce({
            granted: false,
            canAskAgain: state === 'permissionDenied',
          })
        if (state === 'limited')
          boundary.permission.mockResolvedValueOnce({
            granted: true,
            canAskAgain: true,
            accessPrivileges: 'limited',
          })
        await waitFor(() =>
          expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
            'aria-disabled',
            'true'
          )
        )
        await userEvent.click(screen.getByTestId('share-card-save'))
      }
      const key = state === 'limited' ? 'saved' : state
      const text = i18n.t(`shareCard.${key}`)
      try {
        expect(await screen.findByText(text)).toBeInTheDocument()
        await waitFor(() =>
          expect(
            boundary.announce.mock.calls.filter(([message]) => message === text)
          ).toEqual([[text, { queue: polite }]])
        )
        expect(boundary.focus.mock.calls).toEqual(
          focus === null ? [[41]] : [[41], [focus]]
        )
      } finally {
        pending?.resolve()
        await committed
      }
    }
  )
  it('U-OPTIONS: a delayed old image callback with an identical digest cannot enable a replacement presentation', async () => {
    render(<Harness />)
    await ready()
    const oldLoad = boundary.imageLoads.at(-1)!
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(boundary.prepare).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByTestId('share-card-preview')).toBeInTheDocument()
    )
    act(() => oldLoad())
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.load(screen.getByTestId('share-card-preview'))
    await waitFor(() =>
      expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  })
  it('U-OPTIONS U-CANCEL: cached ON/OFF/ON remounts image and close/reopen requires fresh image load', async () => {
    render(<Harness />)
    const image = await ready()
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(screen.getByRole('switch'))
    expect(screen.getByTestId('share-card-preview')).not.toBe(image)
    fireEvent.load(screen.getByTestId('share-card-preview'))
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    await userEvent.click(screen.getByText('Reopen'))
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    expect(boundary.save).not.toHaveBeenCalled()
  })
  it('unmount after retained-preview reopen cancels current authorization before import', async () => {
    const held = deferred<typeof card>()
    const view = render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    await userEvent.click(screen.getByText('Reopen'))
    await ready()
    boundary.prepare.mockReturnValueOnce(held.promise)
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(boundary.prepare).toHaveBeenCalledTimes(2))
    const signal = boundary.prepare.mock.calls[1]?.[1] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => {
      held.resolve(card)
      await held.promise
    })
    expect(boundary.save).not.toHaveBeenCalled()
  })
  it('unmount retains committed native file and pending guard until actual settlement', async () => {
    const native = deferred<void>()
    boundary.save.mockImplementation(() =>
      commitShareCardSave({
        fileUri: 'cc68-unmounted-committed.png',
        save: () => native.promise,
        cleanup: () => Promise.resolve(),
      })
    )
    const view = render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(boundary.save).toHaveBeenCalledOnce())
    view.unmount()
    expect(nativeShareCardSavePending()).toBe(true)
    expect(liveShareCardFiles().has('cc68-unmounted-committed.png')).toBe(true)
    await act(async () => {
      native.resolve()
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    expect(liveShareCardFiles().has('cc68-unmounted-committed.png')).toBe(false)
  })
  it('U-STORAGE: a storage rejection keeps the preview, reports once, and Retry needs a fresh save authorization', async () => {
    boundary.save.mockRejectedValueOnce(new Error('storage'))
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.storage'))).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('shareCard.storage'))).toHaveLength(1)
    expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('share-card-retry'))
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    const calls = boundary.prepare.mock.calls as [PrepareShareCardInput, AbortSignal][]
    expect(calls.map(([input]) => input.purpose)).toEqual([
      'preview',
      'save',
      'preview',
      'save',
    ])
    expect(calls[3]![0]).toMatchObject({ expectedSha256: card.sha256 })
    expect(boundary.permission).toHaveBeenCalledTimes(2)
    expect(boundary.save).toHaveBeenCalledTimes(2)
  })
  it.each(['preview', 'save'] as const)(
    'U-OFFLINE: an offline %s request recovers to a loaded preview for the same member',
    async (stage) => {
      if (stage === 'preview')
        boundary.prepare.mockRejectedValueOnce(new Error('offline'))
      render(<Harness />)
      if (stage === 'save') {
        await ready()
        boundary.prepare.mockRejectedValueOnce(new Error('offline'))
        await userEvent.click(screen.getByTestId('share-card-save'))
      }
      expect(await screen.findByText(i18n.t('shareCard.offline'))).toBeInTheDocument()
      expect(boundary.save).not.toHaveBeenCalled()
      await userEvent.click(screen.getByTestId('share-card-retry'))
      await ready()
      expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
      expect(screen.queryByText(i18n.t('shareCard.offline'))).not.toBeInTheDocument()
      await userEvent.click(screen.getByTestId('share-card-save'))
      expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
      expect(boundary.save).toHaveBeenCalledExactlyOnceWith(
        card,
        expect.any(AbortSignal),
        expect.any(Function),
        expect.any(Object)
      )
    }
  )
  it('U-OPTIONS: a superseded ON preview that resolves after the newer OFF preview is dropped', async () => {
    const on = deferred<typeof card>()
    const off = deferred<typeof card>()
    const offCard = {
      ...card,
      sha256: 'f'.repeat(64),
      accessibilityLabel: 'Share card without watermark',
    }
    boundary.prepare
      .mockReturnValueOnce(on.promise)
      .mockReturnValueOnce(off.promise)
      .mockResolvedValueOnce(offCard)
    render(<Harness />)
    await waitFor(() => expect(boundary.prepare).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByTestId('share-card-watermark'))
    await waitFor(() => expect(boundary.prepare).toHaveBeenCalledTimes(2))
    await act(async () => {
      off.resolve(offCard)
      await off.promise
    })
    expect(await screen.findByAltText(offCard.accessibilityLabel)).toBeInTheDocument()
    // The mock ignores the abort signal, so the superseded ON response really arrives.
    await act(async () => {
      on.resolve(card)
      await on.promise
    })
    expect(screen.getByAltText(offCard.accessibilityLabel)).toBeInTheDocument()
    expect(screen.queryByAltText(card.accessibilityLabel)).not.toBeInTheDocument()
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    expect(boundary.prepare.mock.calls[2]?.[0]).toMatchObject({
      purpose: 'save',
      watermark: false,
      expectedSha256: offCard.sha256,
    })
    expect(boundary.save).toHaveBeenCalledOnce()
    expect(boundary.save.mock.calls[0]?.[0]).toBe(offCard)
  })
  it('U-SINGLE-WRITE: a second Save tap while saving writes once and shows Saving, never finishingSave', async () => {
    const native = deferred<void>()
    boundary.save.mockImplementation((_card, _signal, _isCurrent, owner) =>
      commitShareCardSave({
        fileUri: 'cc68-double-save.png',
        owner,
        save: () => native.promise,
        cleanup: () => Promise.resolve(),
      })
    )
    render(<Harness />)
    await ready()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(true))
    // Save is aria-disabled now; force models the user tapping it again anyway.
    await userEvent.click(screen.getByTestId('share-card-save'), { force: true })
    expect(screen.getByText(i18n.t('shareCard.saving'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shareCard.finishingSave'))).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-card-error')).not.toBeInTheDocument()
    await act(async () => {
      native.resolve()
      await native.promise
    })
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    expect(boundary.permission).toHaveBeenCalledOnce()
    expect(boundary.prepare).toHaveBeenCalledTimes(2)
    expect(boundary.save).toHaveBeenCalledOnce()
  })
  it('U-SINGLE-WRITE: two Save activations in one task pass the composer guard once', async () => {
    render(<Harness />)
    await ready()
    const save = screen.getByTestId('share-card-save')
    // Both presses run before React re-renders, so only the save guard can stop the second.
    act(() => {
      save.click()
      save.click()
    })
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    expect(boundary.permission).toHaveBeenCalledOnce()
    expect(boundary.prepare).toHaveBeenCalledTimes(2)
    expect(boundary.save).toHaveBeenCalledOnce()
  })
})

const purposes = () =>
  (boundary.prepare.mock.calls as [PrepareShareCardInput][]).map(
    ([input]) => input.purpose
  )
const shareFiles = () =>
  [...boundary.files.keys()].filter((uri) =>
    /^file:\/\/\/cache\/share-cards\/cc69-share-[a-f0-9-]+\.png$/.test(uri)
  )
const shareCaptures = () =>
  boundary.capture.mock.calls.filter(([event]) => event === 'share_card_shared')
const announced = (key: string) =>
  boundary.announce.mock.calls.filter(([text]) => text === i18n.t(`shareCard.${key}`))
async function readyShare() {
  boundary.capabilities.mockResolvedValue({ nativeShare: true })
  render(<Harness />)
  await ready()
  await waitFor(() =>
    expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  )
}
async function tapShare() {
  await userEvent.click(screen.getByTestId('share-card-share'))
}
async function settledEvent(event: Record<string, unknown>) {
  await waitFor(() => expect(shareCaptures()).toHaveLength(1))
  expect(shareCaptures()[0]).toEqual([
    'share_card_shared',
    { ...event, duration_ms: expect.any(Number) },
  ])
}
function expectSaveUsable() {
  expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(nativeShareCardSavePending()).toBe(false)
}

describe('Story 6.9 composer Share', () => {
  it('C-COMP-SHARE-GATE: Share renders only for the current member with capability on and the module present', async () => {
    render(<Harness />)
    await ready()
    expect(boundary.capabilities).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    cleanup()
    boundary.prepare.mockClear()
    boundary.capabilities.mockResolvedValue({ nativeShare: true })
    render(<Harness />)
    expect(await screen.findByTestId('share-card-share')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    // Disabled until the preview validates; a press emits nothing and sends no prepare.
    await userEvent.click(screen.getByTestId('share-card-share'), { force: true })
    expect(purposes()).toEqual(['preview'])
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    expect(screen.getByTestId('share-card-share')).toHaveTextContent(
      i18n.t('shareCard.share')
    )
    expect(boundary.capture).not.toHaveBeenCalled()
  })
  it.each([
    ['a rejected read', () => Promise.reject(new Error('timeout'))],
    ['an off answer', () => Promise.resolve({ nativeShare: false })],
    ['a malformed answer', () => Promise.resolve({ nativeShare: 'yes' })],
  ])('C-COMP-SHARE-GATE: %s hides Share', async (_name, answer) => {
    boundary.capabilities.mockImplementation(answer)
    render(<Harness />)
    await ready()
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
  })
  it('C-COMP-SHARE-GATE: identity change clears capability and a late answer for the previous member is ignored', async () => {
    const first = deferred<{ nativeShare: boolean }>()
    const second = deferred<{ nativeShare: boolean }>()
    boundary.capabilities
      .mockResolvedValueOnce({ nativeShare: true })
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(<Harness />)
    expect(await screen.findByTestId('share-card-share')).toBeInTheDocument()
    changeIdentity('member-b')
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    changeIdentity('member-c')
    await act(async () => {
      first.resolve({ nativeShare: true })
      await first.promise
    })
    // member-b's answer arrived while member-c is signed in.
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    changeIdentity(null)
    await act(async () => {
      second.resolve({ nativeShare: true })
      await second.promise
    })
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    expect(boundary.capabilities).toHaveBeenCalledTimes(3)
  })
  it('C-COMP-SHARE-GATE: an absent module shows a statically disabled Share with its reason, and presses do nothing', async () => {
    boundary.shareModule = false
    boundary.capabilities.mockResolvedValue({ nativeShare: true })
    render(<Harness />)
    await ready()
    const share = await screen.findByTestId('share-card-share')
    expect(share).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('share-card-share-unavailable')).toHaveTextContent(
      i18n.t('shareCard.shareUnavailable')
    )
    await userEvent.click(share, { force: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(boundary.prepare).toHaveBeenCalledOnce()
    expect(boundary.shareFile).not.toHaveBeenCalled()
    expect(boundary.capture).not.toHaveBeenCalled()
    expect(shareFiles()).toEqual([])
  })
  it('C-COMP-SHARE-COMPLETED: iOS completed announces Shared once, focuses Share and records instagram/completed', async () => {
    await readyShare()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    expect(boundary.prepare.mock.calls[1]?.[0]).toMatchObject({
      purpose: 'share',
      expectedSha256: card.sha256,
    })
    const [uri, digest] = boundary.shareFile.mock.calls[0] as [string, string]
    expect(uri).toMatch(/cc69-share-/)
    expect(digest).toBe(card.sha256)
    await waitFor(() =>
      expect(announced('shared')).toEqual([[i18n.t('shareCard.shared'), { queue: true }]])
    )
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
    await settledEvent({ client: 'ios', target: 'instagram', outcome: 'completed' })
    expectSaveUsable()
  })
  it('C-COMP-SHARE-CHOSEN: Android target chosen says Sent to the app, never Shared, and records pinterest/target_chosen', async () => {
    setOS('android')
    boundary.shareFile.mockResolvedValue({
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    await readyShare()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.sentToApp'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shareCard.shared'))).not.toBeInTheDocument()
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
    await settledEvent({
      client: 'android',
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    // The handoff file stays leased after settlement while the lock is already released.
    expect(shareFiles()).toHaveLength(1)
    expectSaveUsable()
  })
  it.each([
    ['ios', { target: 'pinterest', outcome: 'cancelled' }],
    ['ios', { target: 'none', outcome: 'cancelled' }],
    ['android', { target: 'none', outcome: 'not_confirmed' }],
  ])(
    'C-COMP-SHARE-CLOSED: %s %j keeps the composition and returns focus to Share',
    async (os, result) => {
      setOS(os)
      boundary.shareFile.mockResolvedValue(result)
      await readyShare()
      await userEvent.click(screen.getByTestId('share-card-watermark'))
      await ready()
      await waitFor(() =>
        expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
          'aria-disabled',
          'true'
        )
      )
      await tapShare()
      expect(await screen.findByText(i18n.t('shareCard.shareClosed'))).toBeInTheDocument()
      expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
      expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
        'aria-checked',
        'false'
      )
      expect(boundary.prepare.mock.calls.at(-1)?.[0]).toMatchObject({
        purpose: 'share',
        watermark: false,
        source,
      })
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
      await settledEvent({ client: os, ...result })
      expectSaveUsable()
    }
  )
  it.each([
    ['native error', () => boundary.shareFile.mockRejectedValue(new Error('bridge'))],
    ['write error', () => boundary.write.mockRejectedValue(new Error('disk_full'))],
    [
      '403',
      () =>
        boundary.prepare
          .mockResolvedValueOnce(card)
          .mockRejectedValueOnce(new ResponseError(new Response('{}', { status: 403 }))),
    ],
    [
      'offline',
      () =>
        boundary.prepare
          .mockResolvedValueOnce(card)
          .mockRejectedValueOnce(new Error('offline')),
    ],
    [
      // The client's own deadline aborts the request while the composer stays current.
      'request deadline',
      () =>
        boundary.prepare
          .mockResolvedValueOnce(card)
          .mockRejectedValueOnce(abortError('Request deadline')),
    ],
  ])(
    'C-COMP-SHARE-FAIL: %s shows merlot shareFailed, focuses Save and keeps the preview',
    async (_name, arrange) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      arrange()
      await readyShare()
      await tapShare()
      const error = await screen.findByTestId('share-card-error')
      expect(error).toHaveTextContent(i18n.t('shareCard.shareFailed'))
      expect(screen.queryByTestId('share-card-retry')).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(42))
      await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
      expectSaveUsable()
    }
  )
  it('C-COMP-SHARE-UNAVAILABLE: a runtime unavailable result says so, focuses Save and records one event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setOS('android')
    boundary.shareFile.mockResolvedValue({
      target: 'none',
      outcome: 'unavailable',
      code: 'chooser_unavailable',
    })
    await readyShare()
    await tapShare()
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.shareUnavailable')
    )
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(42))
    await settledEvent({ client: 'android', target: 'none', outcome: 'unavailable' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(shareCaptures()).toHaveLength(1)
  })
  it('C-COMP-SHARE-STALE: 409 keeps the 6.8 stale path, disables Save and Share until a fresh preview, and records failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await readyShare()
    boundary.prepare.mockRejectedValueOnce(
      new ResponseError(new Response('{}', { status: 409 }))
    )
    await tapShare()
    expect(
      await screen.findByText(i18n.t('shareCard.previewChanged'))
    ).toBeInTheDocument()
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(43))
    expect(screen.getByAltText(card.accessibilityLabel)).toBeInTheDocument()
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('share-card-share')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(boundary.shareFile).not.toHaveBeenCalled()
    await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
    await userEvent.click(screen.getByTestId('share-card-refresh'))
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  })
  it('C-COMP-SHARE-ONE-EVENT: closing during the share prepare still records one failed event', async () => {
    await readyShare()
    boundary.prepare.mockImplementationOnce(
      (_input: PrepareShareCardInput, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError('cancelled')), {
            once: true,
          })
        })
    )
    await tapShare()
    await waitFor(() => expect(purposes()).toEqual(['preview', 'share']))
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    // Only an identity change suppresses the event; a closed composer is not one.
    await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
    expect(boundary.shareFile).not.toHaveBeenCalled()
    expect(nativeShareCardSavePending()).toBe(false)
  })
  it('C-COMP-SHARE-IDENTITY: sign-out while the sheet is open clears the preview and drops the late result', async () => {
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    changeIdentity(null)
    expect(screen.queryByTestId('share-card-preview-loaded')).not.toBeInTheDocument()
    boundary.announce.mockClear()
    await act(async () => {
      native.resolve({ target: 'instagram', outcome: 'completed' })
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByText(i18n.t('shareCard.shared'))).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-card-feedback')).not.toBeInTheDocument()
    expect(boundary.announce).not.toHaveBeenCalled()
    expect(boundary.capture).not.toHaveBeenCalled()
    expect(shareFiles()).toHaveLength(1)
  })
  it.each(['throws', 'rejects'])(
    'C-COMP-SHARE-ANALYTICS-DOWN: a capture that %s leaves copy, focus and the lock unchanged',
    async (mode) => {
      const unhandled = vi.fn()
      window.addEventListener('unhandledrejection', unhandled)
      boundary.capture.mockImplementation(() => {
        if (mode === 'throws') throw new Error('analytics down')
        return Promise.reject(new Error('analytics down'))
      })
      try {
        await readyShare()
        await tapShare()
        expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
        await waitFor(() => expect(boundary.capture).toHaveBeenCalledOnce())
        await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
        expectSaveUsable()
        await userEvent.click(screen.getByTestId('share-card-save'))
        expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('unhandledrejection', unhandled)
      }
    }
  )
  it('C-COMP-SHARE-ONE-EVENT: duplicate taps are ignored, nothing is recorded before settlement, and Share blocks Save', async () => {
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    const share = screen.getByTestId('share-card-share')
    act(() => {
      share.click()
      share.click()
    })
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    expect(screen.getByText(i18n.t('shareCard.sharing'))).toBeInTheDocument()
    await userEvent.click(share, { force: true })
    await userEvent.click(screen.getByTestId('share-card-save'), { force: true })
    expect(boundary.permission).not.toHaveBeenCalled()
    expect(boundary.save).not.toHaveBeenCalled()
    expect(boundary.capture).not.toHaveBeenCalled()
    expect(nativeShareCardSavePending()).toBe(true)
    await act(async () => {
      native.resolve({ target: 'none', outcome: 'cancelled' })
      await native.promise
    })
    await settledEvent({ client: 'ios', target: 'none', outcome: 'cancelled' })
    expect(purposes()).toEqual(['preview', 'share'])
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(shareCaptures()).toHaveLength(1)
  })
  it('C-COMP-SHARE-ANCHOR: every attempt passes the Share frame measured at handoff', async () => {
    await readyShare()
    const button: HTMLElement & {
      measureInWindow?: (callback: (...frame: number[]) => void) => void
    } = screen.getByTestId('share-card-share')
    const frames = [
      [16, 600, 343, 48],
      [16, 664, 343, 48],
    ]
    let attempt = 0
    button.measureInWindow = (callback) => callback(...frames[attempt]!)
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    expect(boundary.shareFile.mock.calls[0]?.[2]).toEqual({
      x: 16,
      y: 600,
      width: 343,
      height: 48,
    })
    // Long copy that wraps can still move the button: the next attempt measures again.
    attempt = 1
    await waitFor(() => expect(shareCaptures()).toHaveLength(1))
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledTimes(2))
    expect(boundary.shareFile.mock.calls[1]?.[2]).toEqual({
      x: 16,
      y: 664,
      width: 343,
      height: 48,
    })
  })
  it('C-COMP-SHARE-ANCHOR: the anchor is the real window frame after the pending copy renders', async () => {
    const frames: DOMRect[] = []
    boundary.shareFile.mockImplementation(() => {
      frames.push(screen.getByTestId('share-card-share').getBoundingClientRect())
      return Promise.resolve({ target: 'none', outcome: 'cancelled' })
    })
    await readyShare()
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    const anchor = boundary.shareFile.mock.calls[0]?.[2] as Record<string, number>
    expect(anchor.x).toBeCloseTo(frames[0]!.left, 0)
    expect(anchor.y).toBeCloseTo(frames[0]!.top, 0)
    expect(anchor.width).toBeCloseTo(frames[0]!.width, 0)
    expect(anchor.height).toBeCloseTo(frames[0]!.height, 0)
  })
  it('C-COMP-SHARE-A11Y: 44-point target, one announcement, Back keeps the operation, neutral finishing copy', async () => {
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    expect(
      screen.getByTestId('share-card-share').getBoundingClientRect().height
    ).toBeGreaterThanOrEqual(44)
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    // Android Back and Cancel share the modal's close handler.
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    expect(nativeShareCardSavePending()).toBe(true)
    await userEvent.click(screen.getByText('Reopen'))
    expect(await screen.findByText(i18n.t('shareCard.finishingSave'))).toBeInTheDocument()
    expect(i18n.t('shareCard.finishingSave')).not.toMatch(/save|share/i)
    await act(async () => {
      native.resolve({ target: 'instagram', outcome: 'completed' })
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    // The member is unchanged, so the closed composer's attempt still records once.
    await settledEvent({ client: 'ios', target: 'instagram', outcome: 'completed' })
    expect(announced('shared')).toEqual([])
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    boundary.shareFile.mockResolvedValue({ target: 'other', outcome: 'completed' })
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(announced('shared')).toHaveLength(1)
  })
})

describe('Story 6.9 composer layout', () => {
  afterEach(async () => {
    await browserPage.viewport(414, 896)
  })
  const frame = (id: string) => screen.getByTestId(id).getBoundingClientRect()
  const tops = () => ({
    save: frame('share-card-save').top,
    share: frame('share-card-share').top,
  })
  it('C-COMP-LAYOUT-STABLE: Save and Share keep their frames while feedback appears and changes', async () => {
    const shared = deferred<unknown>()
    boundary.shareFile.mockReturnValue(shared.promise)
    const saved = deferred<void>()
    boundary.save.mockReturnValue(saved.promise)
    await readyShare()
    // The resting slot reserves one line with no node in it: a hidden placeholder Text made
    // Android TalkBack leave the title for the next element when the composer opened.
    expect(screen.queryByTestId('share-card-feedback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-card-error')).not.toBeInTheDocument()
    const slot = screen.getByTestId('share-card-save').previousElementSibling
    expect(slot?.childElementCount).toBe(0)
    expect(slot?.textContent).toBe('')
    expect(slot?.getBoundingClientRect().height).toBeGreaterThan(0)
    const resting = tops()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.sharing'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
    await act(async () => {
      shared.resolve({ target: 'none', outcome: 'cancelled' })
      await shared.promise
    })
    expect(await screen.findByText(i18n.t('shareCard.shareClosed'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
    await waitFor(expectSaveUsable)
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.saving'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
    await act(async () => {
      saved.resolve()
      await saved.promise
    })
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
  })
  it('C-COMP-LAYOUT-STABLE: a one-line error takes the same slot and Retry follows Share', async () => {
    boundary.save.mockRejectedValue(new Error('render'))
    await readyShare()
    const resting = tops()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.render')
    )
    expect(screen.getByTestId('share-card-retry')).toBeInTheDocument()
    expect(tops()).toEqual(resting)
  })
  it.each([
    ['a phone', 414, 896],
    ['the largest phone', 440, 956],
  ])(
    'C-COMP-LAYOUT-WIDTH: %s keeps the full-width column and preview',
    async (_name, width, height) => {
      await browserPage.viewport(width, height)
      await readyShare()
      const column = screen.getByRole('dialog').getBoundingClientRect().width - 48
      expect(frame('share-card-save').width).toBeCloseTo(column, 0)
      expect(frame('share-card-preview-loaded').width).toBeCloseTo(column, 0)
    }
  )
  it.each([
    ['an iPad in portrait', 820, 1180, 420],
    // 45% of an 820-pt-high window: a 369-pt-high preview, 295 pt wide.
    ['an iPad in landscape', 1180, 820, 295],
  ])(
    'C-COMP-LAYOUT-WIDTH: %s centers a 420-pt column and keeps every action on screen',
    async (_name, width, height, preview) => {
      await browserPage.viewport(width, height)
      await readyShare()
      const dialog = screen.getByRole('dialog').getBoundingClientRect()
      for (const id of ['share-card-save', 'share-card-share', 'share-card-cancel']) {
        const action = frame(id)
        expect(action.width).toBeCloseTo(420, 0)
        expect(action.left - dialog.left).toBeCloseTo(dialog.right - action.right, 0)
      }
      const image = frame('share-card-preview-loaded')
      expect(image.width).toBeCloseTo(preview, 0)
      expect(image.left - dialog.left).toBeCloseTo(dialog.right - image.right, 0)
      expect(frame('share-card-cancel').bottom).toBeLessThanOrEqual(window.innerHeight)
    }
  )
})
