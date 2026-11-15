// Story 6.16 D1, D9: the landing entry into the labeled preview, and the hero's example label.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GUEST_PREVIEW_STRINGS } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { GuestPreviewEntry } from './guest-preview-entry'
import { SampleGarmentArt } from './sample-garment-art'

describe('guest preview entry', () => {
  it('links to the preview and to sign-in in the active locale', async () => {
    await getI18n().changeLanguage('tr-TR')
    render(<GuestPreviewEntry />)
    const entry = screen.getByTestId('guest-preview-entry')
    expect(entry.getAttribute('href')).toBe('/preview')
    expect(entry.textContent).toBe(GUEST_PREVIEW_STRINGS['tr-TR'].chrome.entry)
    expect(screen.getByTestId('landing-sign-in').getAttribute('href')).toBe('/signin')
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
