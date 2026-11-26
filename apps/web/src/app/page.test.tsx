import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
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
