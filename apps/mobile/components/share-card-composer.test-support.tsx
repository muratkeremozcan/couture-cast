import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { PrepareShareCardInput } from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import { Platform } from 'react-native'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  liveShareCardFiles,
  nativeShareCardSavePending,
} from '@/src/lib/share-card-save-operations'
import { drainMacrotask } from '@/src/test-utils/drain-macrotask'
import { ShareCardComposer } from './share-card-composer'
import { boundary } from './share-card-composer.test-boundary'

/**
 * Harness and helpers shared by the share-card composer test files. Import it only from a
 * file that has registered the composer mocks (see share-card-composer.test-boundary.ts).
 */
export { boundary }
export const source = { kind: 'outfit', recommendationId: 'owned-outfit' } as const

export function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
}

// The save manager's pending guard is process-wide, so a test that fails while a native
// save is held would make every later save in this file fail with finishingSave.
const unsettled = new Set<() => void>()
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  unsettled.add(() => resolve(undefined as T))
  return { promise, resolve }
}

export function Harness({ restore = vi.fn() }: { restore?: () => void }) {
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

export async function ready() {
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

export function changeIdentity(member: string | null) {
  act(() => {
    boundary.member = member
    boundary.subscribers.forEach((listener) => listener())
  })
}

/** Resets the boundary before each test and proves no save or file is left behind. */
export function installComposerHooks() {
  beforeEach(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
    boundary.member = 'member-a'
    boundary.available = true
    boundary.prepare.mockReset().mockResolvedValue(card)
    boundary.permission
      .mockReset()
      .mockResolvedValue({ granted: true, canAskAgain: true })
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
    boundary.captureResult = () => undefined
    boundary.files.clear()
    boundary.deleted.length = 0
    boundary.requestClose = undefined
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
}

export const purposes = () =>
  (boundary.prepare.mock.calls as [PrepareShareCardInput][]).map(
    ([input]) => input.purpose
  )
export const shareFiles = () =>
  [...boundary.files.keys()].filter((uri) =>
    /^file:\/\/\/cache\/share-cards\/cc69-share-[a-f0-9-]+\/couturecast-card\.png$/.test(
      uri
    )
  )
export const shareCaptures = () =>
  boundary.capture.mock.calls.filter(([event]) => event === 'share_card_shared')
export const announced = (key: string) =>
  boundary.announce.mock.calls.filter(([text]) => text === i18n.t(`shareCard.${key}`))

export async function readyShare() {
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
export async function tapShare() {
  await userEvent.click(screen.getByTestId('share-card-share'))
}
export async function settledEvent(event: Record<string, unknown>) {
  await waitFor(() => expect(shareCaptures()).toHaveLength(1))
  expect(shareCaptures()[0]).toEqual([
    'share_card_shared',
    { ...event, duration_ms: expect.any(Number) as number },
  ])
}
export function expectSaveUsable() {
  expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(nativeShareCardSavePending()).toBe(false)
}

/**
 * Settles everything a finished share attempt can still emit. The composer loads analytics
 * with a dynamic import after settlement; this test's own import of the same module resolves
 * after the composer's, and the macrotask that follows drains every promise chain in flight.
 * An absence assertion made after this has seen every late event, announcement and render.
 */
export async function settleShareAttempt() {
  await act(async () => {
    await import('@/src/analytics/mobile-analytics.js')
    await drainMacrotask()
  })
}
