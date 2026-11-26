// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-STYLE-01 and 7.11-CMP-STYLE-02 (D7, D10, P5: Profile >
// Style holds Silhouette, Closet setup and Color palette, with back to Profile).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../../i18n'
import deDE from '../../../i18n/locales/de-DE.json'
import SettingsStylePage from './page'

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/style',
  useRouter: () => router,
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

afterEach(async () => {
  await act(async () => {
    await getI18n().changeLanguage('en-US')
  })
})

describe('7.11 Profile > Style (D7)', () => {
  it('7.11-CMP-STYLE-01 titles the screen Style with back to Profile and lists Silhouette, Closet setup and Color palette in order', () => {
    render(<SettingsStylePage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Style')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const back = screen.getByTestId('app-top-bar-back')
    expect(back).toHaveAttribute('href', '/settings')
    expect(back).toHaveTextContent('Back')
    expect(screen.getByTestId('bottom-nav-settings')).toHaveAttribute(
      'aria-current',
      'page'
    )

    const rows = within(screen.getByRole('navigation', { name: 'Style' })).getAllByRole(
      'link'
    )
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'style-row-silhouette',
      'style-row-setup',
      'style-row-palette',
    ])
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/wardrobe/silhouette',
      '/wardrobe/onboarding',
      '/palette',
    ])
    expect(rows.map((row) => row.textContent)).toEqual([
      'Silhouette',
      'Closet setup',
      'Color palette',
    ])
    expect(screen.getByRole('main')).toContainElement(rows[0]!)
  })

  it('7.11-CMP-STYLE-02 reads the title and rows from the catalog in the reader language', async () => {
    await act(async () => {
      await getI18n().changeLanguage('de-DE')
    })

    render(<SettingsStylePage />)

    const style = deDE.settings.style
    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent(style.title)
    expect(screen.getByTestId('style-row-silhouette')).toHaveTextContent(style.silhouette)
    expect(screen.getByTestId('style-row-setup')).toHaveTextContent(style.closetSetup)
    expect(screen.getByTestId('style-row-palette')).toHaveTextContent(style.palette)
    expect(screen.getByTestId('style-row-palette')).not.toHaveTextContent('Color palette')
  })
})
