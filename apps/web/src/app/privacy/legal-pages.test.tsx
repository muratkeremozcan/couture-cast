// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Story 6.17 D12: the public legal pages render one h1, their sections as named regions, the
// contact address and the links between them; legal-pages.spec.ts proves the served pages.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PrivacyPage from './page'
import TermsPage from '../terms/page'
import { LEGAL_CONTACT_EMAIL } from '../components/legal-page'

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
  it('LEGAL-LOC-01 discloses the approximate position Use my location sends to OpenWeather', () => {
    render(<PrivacyPage />)
    const processors = screen.getByRole('region', {
      name: 'Who processes your information',
    })
    const openWeather = within(processors)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.startsWith('OpenWeather'))
    expect(openWeather?.textContent?.replace(/\s+/g, ' ')).toContain(
      'When you tap Use my location, it also receives your approximate position, rounded to about 1 km, to find the city near you; that position is not stored.'
    )
  })
})
