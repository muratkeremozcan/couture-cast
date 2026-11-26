// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Story 6.17 D12: the public legal pages render one h1, their sections as named regions, the
// contact address and the links between them; legal-pages.spec.ts proves the served pages.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the top bar's history-aware back reads the router (D11).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type * as NextNavigation from 'next/navigation'
import PrivacyPage from './page'
import TermsPage from '../terms/page'
import { LEGAL_CONTACT_EMAIL } from '../components/legal-page'

// Story CC-7.11 D11: the top bar's back reads the router. Outside a mounted app router the real
// hook throws, so the test supplies one and keeps the rest of next/navigation.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => ({
    back: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

describe.each([
  ['Privacy Policy', PrivacyPage, 'Terms of Service'],
  ['Terms of Service', TermsPage, 'Privacy Policy'],
])('%s', (title, Page, other) => {
  it('renders one h1, the contact address and the legal links', () => {
    render(<Page />)
    expect(
      screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)
    ).toEqual([title])
    const contact = screen.getAllByRole('link', { name: LEGAL_CONTACT_EMAIL })[0]!
    expect(contact.getAttribute('href')).toBe(`mailto:${LEGAL_CONTACT_EMAIL}`)
    const legal = screen.getByRole('navigation', { name: 'Legal' })
    expect(within(legal).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe(
      '/'
    )
    expect(within(legal).getByRole('link', { name: other }).getAttribute('href')).toBe(
      other === 'Privacy Policy' ? '/privacy' : '/terms'
    )
    for (const region of screen.getAllByRole('region'))
      expect(region.getAttribute('aria-labelledby')).toMatch(/^legal-/)
  })
})

// Production follow-up (2026-11-19): Use my location sends an approximate position to the
// weather provider, so the processor line says so.
describe('Privacy Policy processors', () => {
  const processorText = (name: string) => {
    const processors = screen.getByRole('region', {
      name: 'Who processes your information',
    })
    return within(processors)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.startsWith(name))
      ?.textContent?.replace(/\s+/g, ' ')
  }

  it('LEGAL-LOC-01 discloses the approximate position to whichever weather provider is in use', () => {
    render(<PrivacyPage />)

    expect(processorText('OpenWeather')).toContain(
      'When you tap Use my location, the weather provider in use (OpenWeather, or WeatherAPI when that provider is in use) receives your approximate position, rounded to about 1 km, to find the city near you. CoutureCast stores only the place you pick.'
    )
    expect(processorText('WeatherAPI')).toContain(
      'when CoutureCast uses it in place of OpenWeather'
    )
  })
})
