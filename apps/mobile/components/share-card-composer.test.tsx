import type * as ReactNativeModule from 'react-native'
import React, { createElement, useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { ResponseError, type PrepareShareCardInput } from '@couture/api-client'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import i18n, { initI18n } from '@/src/lib/i18n'
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
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
import { ShareCardComposer } from './share-card-composer'
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
      // focus: 41 title, 42 Save, 43 recovery action, 44 Cancel. Unavailable keeps the title.
      (
        [
          ['saved', true, 42],
          ['storage', false, 43],
          ['offline', false, 43],
          ['permissionDenied', false, 43],
          ['permissionPermanent', false, 43],
          ['limited', true, 42],
          ['finishingSave', true, 44],
          ['nativeSaveUnavailable', false, 41],
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
        expect(boundary.focus).toHaveBeenLastCalledWith(focus)
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
  it('U-SINGLE-WRITE: a double Save tap writes once and shows Saving, never finishingSave', async () => {
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
    await userEvent.dblClick(screen.getByTestId('share-card-save'))
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(true))
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
