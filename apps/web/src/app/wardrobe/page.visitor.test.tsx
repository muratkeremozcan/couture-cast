// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 add-on B (builder test, 7.9-E2E-012 is TEA's browser check): a visitor who never
// signed in (`<html data-session="none">`, no member) sees no "session expired", account or
// setup error on the Closet; one Sign in link is offered and Add leads to sign-in. A page that
// held a session keeps the member error, so an expiry still says so.
// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import type * as WebSession from '../../lib/web-session'
import { screenSnapshot } from '../../lib/screen-snapshot'
import enUS from '../../i18n/locales/en-US.json'

const SIGNED_OUT_MESSAGE = enUS.wardrobe.capture.errors.signedOut

const wardrobe = vi.hoisted(() => ({
  listGarmentsFromWeb: vi.fn<(signal?: AbortSignal) => Promise<GarmentItemContract[]>>(),
  getOnboardingStateFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<WardrobeOnboardingStateContract>>(),
  resolveCurrentUserId: vi.fn<() => Promise<string>>(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/wardrobe',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('../../lib/wardrobe', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...wardrobe,
}))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => null,
}))

import WardrobePage from './page'

/** Every member read fails the way it does with no bearer at all. */
function noBearer() {
  const refused = () => Promise.reject(new Error(SIGNED_OUT_MESSAGE))
  wardrobe.resolveCurrentUserId.mockImplementation(refused)
  wardrobe.getOnboardingStateFromWeb.mockImplementation(refused)
  wardrobe.listGarmentsFromWeb.mockImplementation(refused)
}

beforeEach(() => {
  screenSnapshot.clear()
  for (const mock of Object.values(wardrobe)) mock.mockReset()
  noBearer()
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-session')
})

describe('7.9 add-on B: the Closet for a visitor who never signed in', () => {
  it('shows no error, offers one Sign in link and sends Add to sign-in', async () => {
    document.documentElement.setAttribute('data-session', 'none')
    render(<WardrobePage />)

    const main = screen.getByRole('main')
    const signIn = await within(main).findByRole('link', {
      name: enUS.community.notifications.signin,
    })
    expect(signIn).toHaveAttribute('href', '/signin')
    await waitFor(() => expect(wardrobe.listGarmentsFromWeb).toHaveBeenCalled())

    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    for (const message of [
      SIGNED_OUT_MESSAGE,
      enUS.wardrobe.hub.accountFailed,
      enUS.wardrobe.hub.setupFailed,
    ])
      expect(screen.queryByText(message)).not.toBeInTheDocument()

    const add = screen.getByTestId('garment-capture-open')
    expect(add.tagName).toBe('A')
    expect(add).toHaveAttribute('href', '/signin')
    expect(
      screen.getByRole('button', { name: enUS.wardrobe.silhouette.title })
    ).toBeDisabled()
  })

  it('keeps the member errors on a page that held a session', async () => {
    // No `none` from the landing script: a stored session was found at load and has gone.
    render(<WardrobePage />)

    expect(await screen.findByText(SIGNED_OUT_MESSAGE)).toBeInTheDocument()
    expect(await screen.findByText(enUS.wardrobe.hub.setupFailed)).toBeInTheDocument()
    expect(screen.queryByTestId('wardrobe-sign-in')).not.toBeInTheDocument()
    expect(screen.getByTestId('garment-capture-open').tagName).toBe('BUTTON')
  })
})
