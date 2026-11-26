// Story 6.16 D1, D9: the landing entry into the labeled preview, and the hero's example label.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GUEST_PREVIEW_STRINGS } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { GuestPreviewEntry, MemberWardrobeActions } from './guest-preview-entry'

const webSession = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }))
vi.mock('../../../lib/web-session', () => ({ signOutWebSession: webSession.signOut }))
import { SampleGarmentArt } from './sample-garment-art'

describe('guest preview entry', () => {
  it('localizes the guest links and keeps the signup analytics label stable', async () => {
    await getI18n().changeLanguage('tr-TR')
    render(<GuestPreviewEntry />)
    const entry = screen.getByTestId('guest-preview-entry')
    expect(entry.getAttribute('href')).toBe('/preview')
    expect(entry.textContent).toBe(GUEST_PREVIEW_STRINGS['tr-TR'].firstUse.sampleEntry)
    const signup = screen.getByRole('link', {
      name: GUEST_PREVIEW_STRINGS['tr-TR'].chrome.createAccount,
    })
    expect(signup).toHaveAttribute('href', '/signup')
    expect(signup).toHaveAttribute('data-ph-cta-label', 'Start signup')
    expect(screen.getByTestId('landing-sign-in').getAttribute('href')).toBe('/signin')
    await getI18n().changeLanguage('en-US')
  })

  // Owner report 2026-11-16: the member set exists beside the signed-out set; globals.css shows
  // the one that matches <html data-session> (lib/landing-session.ts).
  it('marks each action with the session it belongs to, in the active locale', async () => {
    await getI18n().changeLanguage('de-DE')
    render(
      <>
        <GuestPreviewEntry />
        <MemberWardrobeActions />
      </>
    )
    const chrome = GUEST_PREVIEW_STRINGS['de-DE'].chrome
    const landing = (id: string) => screen.getByTestId(id).getAttribute('data-landing')
    expect(landing('guest-preview-entry')).toBe('guest')
    expect(landing('landing-sign-in')).toBe('guest')
    expect(landing('landing-open-wardrobe')).toBe('member')
    expect(landing('landing-sign-out')).toBe('member')
    expect(screen.getByTestId('landing-open-wardrobe').getAttribute('href')).toBe(
      '/wardrobe'
    )
    expect(screen.getByTestId('landing-open-wardrobe').textContent).toBe(
      chrome.openWardrobe
    )
    expect(screen.getByTestId('landing-sign-out').textContent).toBe(chrome.signOut)
    await getI18n().changeLanguage('en-US')
  })
})

describe('member landing Sign out before hydration', () => {
  // CI real-session L-4 on webkit (fd692390, 40ee2f90): the head script shows the member actions
  // from first paint, Playwright clicked the server-rendered Sign out while the page hydrated,
  // and nothing signed out: the member ritual and community actions stayed rendered.
  it('7.9-CMP-SIGNOUT-001 ships Sign out disabled in the server HTML and enables it once hydrated', async () => {
    webSession.signOut.mockClear()
    const container = document.createElement('div')
    container.innerHTML = renderToString(<MemberWardrobeActions />)
    document.body.appendChild(container)
    const serverButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="landing-sign-out"]'
    )
    expect(serverButton?.disabled).toBe(true)
    // The link needs no script, so it stays usable from first paint.
    expect(
      container
        .querySelector('[data-testid="landing-open-wardrobe"]')
        ?.getAttribute('href')
    ).toBe('/wardrobe')

    let root: ReturnType<typeof hydrateRoot> | undefined
    // Hydration and the post-hydration snapshot update flush inside act.
    await act(() => {
      root = hydrateRoot(container, <MemberWardrobeActions />)
      return Promise.resolve()
    })
    const hydratedButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="landing-sign-out"]'
    )
    expect(hydratedButton).toBe(serverButton)
    expect(hydratedButton?.disabled).toBe(false)
    fireEvent.click(hydratedButton!)
    expect(webSession.signOut).toHaveBeenCalledTimes(1)
    act(() => root?.unmount())
    container.remove()
  })
})

describe('sample garment art', () => {
  it('draws a labeled image, or a decorative one with no label', () => {
    const { rerender } = render(
      <SampleGarmentArt
        garment={{
          category: 'top',
          art: { key: 'tee', primary: '#111111', secondary: '#222222' },
        }}
        label="Off-white tee"
      />
    )
    expect(screen.getByRole('img', { name: 'Off-white tee' })).toBeInTheDocument()
    rerender(
      <SampleGarmentArt
        garment={{
          category: 'top',
          art: { key: 'tee', primary: '#111111', secondary: '#222222' },
        }}
      />
    )
    expect(screen.getByTestId('sample-garment-art').getAttribute('aria-hidden')).toBe(
      'true'
    )
  })

  it('falls back to the category glyph for an unknown art key (W-ART-FALLBACK)', () => {
    render(
      <SampleGarmentArt
        garment={{
          category: 'shoes',
          art: { key: 'missing' as never, primary: '#111111', secondary: '#222222' },
        }}
        label="Shoes"
      />
    )
    const art = screen.getByRole('img', { name: 'Shoes' })
    expect(art.dataset.artFallback).toBe('true')
    expect(art.querySelectorAll('path').length).toBeGreaterThan(0)
  })
})
