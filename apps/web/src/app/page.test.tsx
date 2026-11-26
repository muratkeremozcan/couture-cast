// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): five desktop tabs in keyboard order (D1), Today title.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { getI18n } from '../i18n'
import Home from './page'

// Story CC-7.11 D11: the top bar's back reads the router.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}))

it('puts the top-level destinations in keyboard order and offers a sample on Home', async () => {
  const user = userEvent.setup()
  render(<Home />)

  const primary = within(screen.getByRole('navigation', { name: 'Main navigation' }))
  // Story CC-7.11 D1: Today, Closet, Looks, Community, Profile, in that order.
  for (const [name, href] of [
    ['Today', '/'],
    ['Closet', '/wardrobe'],
    ['Looks', '/looks'],
    ['Community', '/community'],
    ['Profile', '/settings'],
  ] as const) {
    await user.tab()
    const link = primary.getByRole('link', { name })
    expect(link).toHaveFocus()
    expect(link).toHaveAttribute('href', href)
  }

  expect(
    within(screen.getByRole('region', { name: 'Outfit idea' })).getByRole('link', {
      name: 'Try a sample look',
    })
  ).toHaveAttribute('href', '/preview')
  expect(screen.queryByTestId('health-indicator')).not.toBeInTheDocument()
  expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Today')
})

afterEach(async () => {
  await act(async () => {
    await getI18n().changeLanguage('en-US')
  })
})

// Story CC-7.9 P2-11: Home's legal navigation reads the catalogs; the documents stay English.
it('7.9 P2-11 shows the legal links and their landmark in the reader language', async () => {
  await act(async () => {
    await getI18n().changeLanguage('de-DE')
  })
  render(<Home />)

  const legal = within(screen.getByRole('navigation', { name: 'Rechtliches' }))
  expect(legal.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute(
    'href',
    '/privacy'
  )
  expect(legal.getByRole('link', { name: 'Nutzungsbedingungen' })).toHaveAttribute(
    'href',
    '/terms'
  )
  expect(screen.queryByRole('navigation', { name: 'Legal' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull()
})
