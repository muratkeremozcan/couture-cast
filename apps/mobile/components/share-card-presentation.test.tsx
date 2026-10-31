// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import type * as ReactNativeModule from 'react-native'
import React, { createElement, useEffect, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import {
  ResponseError,
  type PrepareShareCardInput,
  type ShareCardSource,
} from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import i18n, { initI18n } from '@/src/lib/i18n'
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
const boundary = vi.hoisted(() => {
  process.env.EXPO_OS = 'android'
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
    routes: [] as string[],
    links: new Set<(event: { url: string }) => void>(),
    dismissals: [] as (() => void)[],
    closeRequests: [] as (() => void)[],
  }
})
vi.mock('@/src/lib/mobile-auth', () => ({
  mobileApplicationUserId: () => boundary.member,
  subscribeMobileApplicationUser: (listener: () => void) => {
    boundary.subscribers.add(listener)
    return () => boundary.subscribers.delete(listener)
  },
}))
vi.mock('@/src/lib/share-cards', () => ({ prepareShareCardFromMobile: boundary.prepare }))
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
    onRequestClose,
  }: {
    visible: boolean
    children: React.ReactNode
    onShow?: () => void
    onDismiss?: () => void
    onRequestClose?: () => void
  }) => {
    if (visible && onDismiss) boundary.dismissals.push(onDismiss)
    if (visible && onRequestClose) boundary.closeRequests.push(onRequestClose)
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
    Platform: { ...actual.Platform, OS: 'android' },
    Image: ({
      testID,
      accessibilityLabel,
      onLoad,
      onError,
    }: {
      testID: string
      accessibilityLabel: string
      onLoad: () => void
      onError: () => void
    }) => {
      boundary.imageLoads.push(onLoad)
      return createElement('img', {
        'data-testid': testID,
        alt: accessibilityLabel,
        onLoad,
        onError,
      })
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: boundary.focus,
      announceForAccessibilityWithOptions: boundary.announce,
    },
    Linking: {
      ...actual.Linking,
      openSettings: boundary.settings,
      addEventListener: (_event: string, listener: (event: { url: string }) => void) => {
        boundary.links.add(listener)
        return { remove: () => boundary.links.delete(listener) }
      },
    },
    AppState: {
      ...actual.AppState,
      addEventListener: (_event: string, listener: (state: string) => void) => {
        boundary.appState.add(listener)
        return { remove: () => boundary.appState.delete(listener) }
      },
    },
  }
})
vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: () => true,
}))
vi.mock('../modules/modal-system-bars', () => ({
  modalSystemBarsAvailable: () => false,
  setModalDarkStatusBar: () => undefined,
}))
import {
  AndroidShareCardPresentation,
  ScreenShareCardComposer,
  useShareCardPresentationOpener,
  useAndroidNavigationIntent,
} from './android-share-card-presentation'
import {
  commitShareCardSave,
  nativeShareCardSavePending,
  liveShareCardFiles,
} from '@/src/lib/share-card-save-operations'
import { registerShareCardHeading } from '@/src/lib/share-card-focus'
import { shareCardPresentationSnapshot } from '@/src/lib/share-card-presentation'
const sources = [
  { kind: 'outfit', recommendationId: 'owned-outfit' },
  { kind: 'community_post', postId: 'owned-post' },
] as const
const opener = vi.fn(() => 140)
function Export({
  source = sources[0],
  capture,
}: {
  source?: ShareCardSource
  capture?: (open: ReturnType<typeof useShareCardPresentationOpener>) => void
}) {
  const open = useShareCardPresentationOpener()
  capture?.(open)
  return (
    <button
      onClick={() =>
        open(source, source.kind === 'outfit' ? 'outfit' : 'community', opener)
      }
    >
      Export
    </button>
  )
}
function Host({
  source = sources[0],
  pathname = '/',
  capture,
}: {
  source?: ShareCardSource
  pathname?: string
  capture?: (open: ReturnType<typeof useShareCardPresentationOpener>) => void
}) {
  return (
    <AndroidShareCardPresentation pathname={pathname}>
      <Export source={source} capture={capture} />
    </AndroidShareCardPresentation>
  )
}
function HomeIntent({ navigate }: { navigate: () => void }) {
  const intent = useAndroidNavigationIntent()
  return (
    <button
      onClick={() => {
        intent('/')
        navigate()
      }}
    >
      Home intent
    </button>
  )
}
function NavigationHeading({ path }: { path: string }) {
  useEffect(() => {
    if (path === '/community') return registerShareCardHeading('community', () => 840)
  }, [path])
  return null
}
function NavigationHarness({
  initialPath = '/',
  ready = true,
}: {
  initialPath?: string
  ready?: boolean
}) {
  const [path, setPath] = useState(initialPath)
  return (
    <AndroidShareCardPresentation
      pathname={path}
      {...{
        navigationReady: ready,
        onRestoreRoute: (target: string) => {
          boundary.routes.push(target)
          setPath(target)
        },
      }}
    >
      <span data-testid="current-route">{path}</span>
      <NavigationHeading path={path} />
      <HomeIntent navigate={() => setPath('/')} />
      <Export source={sources[1]} />
    </AndroidShareCardPresentation>
  )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function changeIdentity(member: string | null) {
  act(() => {
    boundary.member = member
    boundary.subscribers.forEach((listener) => listener())
  })
}
async function ready() {
  fireEvent.load(await screen.findByTestId('share-card-preview'))
  await waitFor(() =>
    expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  )
}
async function open(source: ShareCardSource = sources[0]) {
  const view = render(<Host source={source} />)
  await userEvent.click(screen.getByRole('button', { name: 'Export' }))
  await ready()
  return view
}
async function watermarkOff() {
  await userEvent.click(screen.getByTestId('share-card-watermark'))
  await waitFor(() =>
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  )
  await ready()
}
beforeEach(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
  changeIdentity(null)
  changeIdentity('member-a')
  boundary.available = true
  boundary.prepare.mockReset().mockResolvedValue(card)
  boundary.permission.mockReset().mockResolvedValue({ granted: true, canAskAgain: true })
  boundary.save.mockReset().mockResolvedValue(undefined)
  boundary.focus.mockClear()
  boundary.announce.mockClear()
  opener.mockClear()
  boundary.imageLoads.length = 0
  boundary.routes.length = 0
  boundary.dismissals.length = 0
  boundary.closeRequests.length = 0
})
describe('Android presentation open outcome', () => {
  it('reports an open it published so the screen keeps its own composer closed', async () => {
    let open!: ReturnType<typeof useShareCardPresentationOpener>
    render(<Host capture={(callback) => (open = callback)} />)
    let handled: boolean | undefined
    act(() => {
      handled = open(sources[0], 'outfit', opener)
    })
    expect(handled).toBe(true)
    expect(shareCardPresentationSnapshot().draft).toMatchObject({ open: true })
    await ready()
  })
  it('reports a root-mismatch drop so the screen falls back instead of silently ignoring the press', () => {
    let oldOpen!: ReturnType<typeof useShareCardPresentationOpener>
    render(<Host capture={(callback) => (oldOpen = callback)} />)
    render(<Host />)
    let handled: boolean | undefined
    act(() => {
      handled = oldOpen(sources[0], 'outfit', opener)
    })
    expect(handled).toBe(false)
    expect(shareCardPresentationSnapshot().draft).toBeNull()
  })
  it('reports a signed-out drop so the screen falls back instead of silently ignoring the press', () => {
    let open!: ReturnType<typeof useShareCardPresentationOpener>
    render(<Host capture={(callback) => (open = callback)} />)
    // Sign-out lands between the render that offered the opener and the press.
    boundary.member = null
    let handled: boolean | undefined
    act(() => {
      handled = open(sources[0], 'outfit', opener)
    })
    expect(handled).toBe(false)
    expect(shareCardPresentationSnapshot().draft).toBeNull()
  })
  it('a screen fallback composer renders under an Android root once the screen opens it', async () => {
    const { rerender } = render(
      <AndroidShareCardPresentation pathname="/">
        <ScreenShareCardComposer
          source={sources[0]}
          open={false}
          onClose={() => undefined}
        />
      </AndroidShareCardPresentation>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <AndroidShareCardPresentation pathname="/">
        <ScreenShareCardComposer source={sources[0]} open onClose={() => undefined} />
      </AndroidShareCardPresentation>
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
describe('Android Activity root replacement', () => {
  it.each(['/community', '/settings'])(
    'restores %s once after the Android root starts at Home',
    async (pathname) => {
      const old = render(<NavigationHarness initialPath={pathname} />)
      old.unmount()
      render(<NavigationHarness />)
      await waitFor(() =>
        expect(screen.getByTestId('current-route')).toHaveTextContent(pathname)
      )
      expect(boundary.routes).toEqual([pathname])
    }
  )
  it('gates a restored Community composer until navigation is ready on Community', async () => {
    const old = render(<NavigationHarness initialPath="/community" />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    await watermarkOff()
    old.unmount()
    const fresh = render(<NavigationHarness ready={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(boundary.routes).toEqual([])
    fresh.rerender(<NavigationHarness ready />)
    await ready()
    expect(screen.getByTestId('current-route')).toHaveTextContent('/community')
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('explicit Home before navigation readiness retires the retained composer without a restore', async () => {
    const old = render(<NavigationHarness initialPath="/community" />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    old.unmount()
    const fresh = render(<NavigationHarness ready={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Home intent' }))
    fresh.rerender(<NavigationHarness ready />)
    expect(boundary.routes).toEqual([])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('a real external intent during readiness wins while isolated fixture control links retain restoration', async () => {
    const old = render(<NavigationHarness initialPath="/community" />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    old.unmount()
    const fresh = render(<NavigationHarness ready={false} />)
    act(() =>
      boundary.links.forEach((fn) =>
        fn({ url: 'couturecast-story68://__story68__/share-card?mode=real' })
      )
    )
    expect(shareCardPresentationSnapshot().draft?.open).toBe(true)
    act(() =>
      boundary.links.forEach((fn) =>
        fn({ url: 'couturecast://settings?source=new-link' })
      )
    )
    fresh.rerender(<NavigationHarness ready />)
    expect(boundary.routes).toEqual([])
    expect(shareCardPresentationSnapshot().draft).toBeNull()
  })
  it('Cancel after restored Community uses its new mounted heading', async () => {
    const old = render(<NavigationHarness initialPath="/community" />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    old.unmount()
    render(<NavigationHarness />)
    await ready()
    boundary.focus.mockClear()
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    await waitFor(() => expect(boundary.focus).toHaveBeenCalledWith(840))
    expect(screen.getByTestId('current-route')).toHaveTextContent('/community')
  })
  it.each(sources)(
    'restores active $kind with watermark OFF and fresh authorization',
    async (source) => {
      const old = await open(source)
      await watermarkOff()
      const lastPreparation = boundary.prepare.mock.calls.at(-1)!
      old.unmount()
      const fresh = deferred<typeof card>()
      boundary.prepare.mockReturnValueOnce(fresh.promise)
      render(<Host />)
      expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
        'aria-checked',
        'false'
      )
      expect(screen.queryByTestId('share-card-preview-loaded')).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-save')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(lastPreparation[1].aborted).toBe(true)
      expect(boundary.prepare.mock.calls.at(-1)?.[0]).toMatchObject({
        source,
        watermark: false,
        purpose: 'preview',
      })
      await act(async () => {
        fresh.resolve(card)
        await fresh.promise
      })
      await ready()
      expect(boundary.permission).not.toHaveBeenCalled()
      expect(boundary.save).not.toHaveBeenCalled()
      // The retained process snapshot contains identifiers/options only.
      expect(shareCardPresentationSnapshot().draft).toEqual({
        serial: expect.any(Number),
        source,
        member: 'member-a',
        scope: source.kind === 'outfit' ? 'outfit' : 'community',
        watermark: false,
        open: true,
      })
    }
  )
  it('successor lease rejects old opener, stale close, pathname effect, dismissal and finalizer', async () => {
    let oldOpen!: ReturnType<typeof useShareCardPresentationOpener>
    const old = render(
      <Host
        capture={(callback) => {
          oldOpen = callback
        }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    await watermarkOff()
    const oldClose = boundary.closeRequests.at(-1)!
    const oldDismiss = boundary.dismissals.at(-1)!
    const fresh = render(<Host />)
    await ready()
    const lease = shareCardPresentationSnapshot().root
    act(() => {
      oldOpen(sources[1], 'community', opener)
      oldClose()
      oldDismiss()
    })
    old.rerender(<Host pathname="/community" />)
    expect(shareCardPresentationSnapshot().root).toBe(lease)
    expect(shareCardPresentationSnapshot().draft).toMatchObject({
      source: sources[0],
      open: true,
      watermark: false,
    })
    old.unmount()
    expect(shareCardPresentationSnapshot().root).toBe(lease)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(boundary.focus).not.toHaveBeenCalledWith(140)
    fresh.unmount()
  })
  it('recreated host restores focus to the fresh heading after Cancel', async () => {
    const removeOldHeading = registerShareCardHeading('outfit', () => 240)
    const old = await open()
    old.unmount()
    const removeNewHeading = registerShareCardHeading('outfit', () => 340)
    removeOldHeading()
    try {
      render(<Host />)
      await ready()
      boundary.focus.mockClear()
      await userEvent.click(screen.getByTestId('share-card-cancel'))
      await waitFor(() => expect(boundary.focus).toHaveBeenCalledWith(340))
      expect(boundary.focus).not.toHaveBeenCalledWith(140)
      expect(boundary.focus).not.toHaveBeenCalledWith(240)
    } finally {
      removeNewHeading()
    }
  })
  it.each([null, 'member-b'])(
    'identity %s during the root gap destroys the prior draft permanently',
    async (member) => {
      const old = await open()
      await watermarkOff()
      old.unmount()
      changeIdentity(member)
      changeIdentity('member-a')
      render(<Host />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(shareCardPresentationSnapshot().draft).toBeNull()
    }
  )
  it('a live identity transition clears the composer, including a return to the same ID', async () => {
    await open()
    changeIdentity(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    changeIdentity('member-a')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
  it('Cancel remains closed across replacement and explicit reopen retains composition', async () => {
    const old = await open()
    await watermarkOff()
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    old.unmount()
    render(<Host />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
  it('actual navigation clears a visit while the replacement initial route preserves it', async () => {
    const old = await open(sources[1])
    old.unmount()
    const fresh = render(<Host pathname="/" />)
    await ready()
    expect(shareCardPresentationSnapshot().draft?.source).toEqual(sources[1])
    fresh.rerender(<Host pathname="/settings" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fresh.unmount()
    render(<Host pathname="/community" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(shareCardPresentationSnapshot().draft).toBeNull()
  })
  it('restoration revalidates eligibility and cannot display cached pixels after refusal', async () => {
    const old = await open(sources[1])
    old.unmount()
    boundary.prepare.mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 404 }))
    )
    render(<Host />)
    expect(
      await screen.findByText(i18n.t('shareCard.sourceUnavailable'))
    ).toBeInTheDocument()
    expect(screen.queryByTestId('share-card-preview-loaded')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    expect(boundary.save).not.toHaveBeenCalled()
  })
  it('old-root fresh save authorization aborts before import and cannot settle into the successor', async () => {
    const old = await open()
    await watermarkOff()
    const held = deferred<typeof card>()
    boundary.prepare.mockImplementation((input: PrepareShareCardInput) =>
      input.purpose === 'save' ? held.promise : Promise.resolve(card)
    )
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() =>
      expect(boundary.prepare.mock.calls.at(-1)?.[0].purpose).toBe('save')
    )
    const signal = boundary.prepare.mock.calls.at(-1)![1] as AbortSignal
    old.unmount()
    expect(signal.aborted).toBe(true)
    render(<Host />)
    await ready()
    await act(async () => {
      held.resolve(card)
      await held.promise
    })
    expect(boundary.save).not.toHaveBeenCalled()
    expect(screen.queryByText(i18n.t('shareCard.saving'))).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shareCard.saved'))).not.toBeInTheDocument()
    expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
  it('committed native save keeps its real manager file and pending guard through root replacement', async () => {
    const native = deferred<void>()
    const cleanup = vi.fn(() => Promise.resolve())
    boundary.save.mockImplementation((_card, _signal, _current, owner) =>
      commitShareCardSave({
        fileUri: 'cc68-root-replacement.png',
        owner,
        save: () => native.promise,
        cleanup,
      })
    )
    const old = await open()
    await watermarkOff()
    await userEvent.click(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(true))
    try {
      old.unmount()
      render(<Host />)
      fireEvent.load(await screen.findByTestId('share-card-preview'))
      expect(liveShareCardFiles().has('cc68-root-replacement.png')).toBe(true)
      expect(screen.getByTestId('share-card-save')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(
        await screen.findByText(i18n.t('shareCard.finishingSave'))
      ).toBeInTheDocument()
      expect(boundary.save).toHaveBeenCalledOnce()
      await act(async () => {
        native.resolve()
        await native.promise
      })
      await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
      expect(liveShareCardFiles().has('cc68-root-replacement.png')).toBe(false)
      expect(cleanup).toHaveBeenCalledOnce()
      expect(screen.queryByText(i18n.t('shareCard.saved'))).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
        'aria-checked',
        'false'
      )
    } finally {
      native.resolve()
      await native.promise
    }
  })
})
