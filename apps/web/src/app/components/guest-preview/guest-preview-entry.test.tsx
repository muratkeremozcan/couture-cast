// Story 6.16 D1, D9: the landing entry into the labeled preview, and the hero's example label.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GUEST_PREVIEW_STRINGS } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { GuestPreviewEntry, MemberWardrobeActions } from './guest-preview-entry'
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
