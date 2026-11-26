// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-CLOSET-008 (D4, D5: a visitor's Closet top bar keeps
// Add as the one gold primary beside a neutral More menu whose Silhouette item is a route link).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 add-on B (builder test, 7.9-E2E-012 is TEA's browser check): a visitor who never
// signed in (`<html data-session="none">`, no member) sees no "session expired", account or
// setup error on the Closet; one Sign in link is offered and Add leads to sign-in. A page that
// held a session keeps the member error, so an expiry still says so.
// @vitest-environment jsdom
import React from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import type * as WebSession from '../../lib/web-session'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import enUS from '../../i18n/locales/en-US.json'

const SIGNED_OUT_MESSAGE = enUS.wardrobe.capture.errors.signedOut

const wardrobe = vi.hoisted(() => ({
  listGarmentsFromWeb: vi.fn<(signal?: AbortSignal) => Promise<GarmentItemContract[]>>(),
  getOnboardingStateFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<WardrobeOnboardingStateContract>>(),
  resolveCurrentUserId: vi.fn<() => Promise<string>>(),
}))

// Story CC-7.11 D11: the top bar back reads the router.
const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  forward: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/wardrobe',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('../../lib/wardrobe', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...wardrobe,
}))
/** The member the session bridge names; null for a page with no verified member. */
const session = vi.hoisted(() => ({ member: null as string | null }))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.member,
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
  session.member = null
  screenSnapshot.clear()
  for (const mock of Object.values(wardrobe)) mock.mockReset()
  noBearer()
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-session')
  window.localStorage.clear()
  window.sessionStorage.clear()
})

function setLanding(state: 'member' | 'pending' | 'none') {
  document.documentElement.setAttribute('data-session', state)
}

/** The member alerts a page that held a session keeps, with no sign-in offer in their place. */
async function expectMemberErrors() {
  expect(await screen.findByText(SIGNED_OUT_MESSAGE)).toBeInTheDocument()
  expect(await screen.findByText(enUS.wardrobe.hub.setupFailed)).toBeInTheDocument()
  expect(screen.queryByTestId('wardrobe-sign-in')).not.toBeInTheDocument()
  expect(screen.queryByTestId('wardrobe-visitor-offer')).not.toBeInTheDocument()
  expect(screen.getByTestId('garment-capture-open').tagName).toBe('BUTTON')
}

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
    // CC-7.11 D4: Add sits in the top bar as the one gold primary, "+ Add" with the full name.
    const header = screen.getByTestId('app-header')
    expect(header).toContainElement(add)
    expect(add).toHaveAccessibleName(enUS.wardrobe.hub.addGarment)
    expect(add).toHaveTextContent(`+ ${enUS.wardrobe.menu.add}`)
    expect(add).toHaveAttribute('data-gold', 'primary')
    expect(document.querySelectorAll('[data-gold="primary"]')).toHaveLength(1)
    // CC-7.11 D5, D6: Silhouette is no Closet button any more; the neutral More menu links to
    // its route, which offers a visitor sign-in.
    expect(
      screen.queryByRole('button', { name: enUS.wardrobe.silhouette.title })
    ).toBeNull()
    const more = within(header).getByTestId('closet-more-menu')
    expect(more).not.toHaveAttribute('data-gold')
    fireEvent.click(more)
    expect(screen.getByTestId('closet-more-silhouette')).toHaveAttribute(
      'href',
      '/wardrobe/silhouette'
    )
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

// Review P2-2: the Closet carries evidence of a prior session across verification and the
// owner-keyed remount, so only a page that never saw one treats the person as a visitor.
describe('7.9 P2-2: prior-session evidence decides visitor or member', () => {
  it('a fresh visitor (none from the start, nothing stored) gets the sign-in offer and no alerts', async () => {
    setLanding('none')
    render(<WardrobePage />)

    expect(await screen.findByTestId('wardrobe-sign-in')).toHaveAttribute(
      'href',
      '/signin'
    )
    await waitFor(() => expect(wardrobe.listGarmentsFromWeb).toHaveBeenCalled())
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(screen.queryByText(SIGNED_OUT_MESSAGE)).not.toBeInTheDocument()
  })

  it('a returning session that fails before verification keeps the member errors', async () => {
    // The head script found a stored session (`pending`); verification then refused it and the
    // session bridge wrote `none` before any owner resolved. Storage stays empty so the landing
    // attribute is the only evidence this case proves.
    setLanding('pending')
    render(<WardrobePage />)
    act(() => setLanding('none'))

    await waitFor(() => expect(wardrobe.listGarmentsFromWeb).toHaveBeenCalled())
    await expectMemberErrors()
  })

  it('a verified session that ends with the Closet open keeps the member errors', async () => {
    // The landing attribute stays `none` throughout, so the member who held the Closet is the
    // only evidence; the owner change remounts the keyed view.
    setLanding('none')
    session.member = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'member-token')
    render(<WardrobePage />)
    expect(screen.queryByTestId('wardrobe-visitor-offer')).not.toBeInTheDocument()

    act(() => {
      session.member = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })

    await expectMemberErrors()
  })
})
