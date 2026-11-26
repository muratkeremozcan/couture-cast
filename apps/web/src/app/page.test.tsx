import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { getI18n } from '../i18n'
import Home from './page'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

it('puts the top-level destinations in keyboard order and offers a sample on Home', async () => {
  const user = userEvent.setup()
  render(<Home />)

  const primary = within(screen.getByRole('navigation', { name: 'Main navigation' }))
  for (const [name, href] of [
    ['Home', '/'],
    ['Wardrobe', '/wardrobe'],
    ['Community', '/community'],
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
