// Learning path Step 70: Calm Today with one primary job.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-70-calm-today-with-one-primary-job
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LookbookPrismLayout } from './lookbook-prism-layout'

vi.mock('next/navigation', () => {
  const router = { push: vi.fn(), replace: vi.fn() }
  return { useRouter: () => router, usePathname: () => '/' }
})

it('shows one guest sample entry and leaves Community to its tab', async () => {
  render(<LookbookPrismLayout />)
  expect(await screen.findByRole('link', { name: 'Try a sample look' })).toHaveAttribute(
    'href',
    '/preview'
  )
  expect(screen.queryByTestId('community-card-grid')).toBeNull()
  expect(screen.queryByTestId('chip-navigation-bar')).toBeNull()
  expect(screen.queryByText(/lookbook prism|daily ritual/i)).toBeNull()
})
