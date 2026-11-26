// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D5: the sign-in door after a Google round trip. W-FAIL-NO-RAW-ERROR and
// W-FAIL-CANCEL: only a fixed outcome name selects a fixed localized message; provider text in
// the URL is never rendered.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the top bar's history-aware back reads the router (D11).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NextNavigation from 'next/navigation'
import { getFederatedSignInStrings } from '@couture/utils'
import { getI18n } from '../../i18n'
import SignInPage from './page'

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

const strings = getFederatedSignInStrings('en-US')
const realLocation = window.location
const raw = '<img src=x onerror=alert(1)> Provider free text that must stay unseen'

function at(search: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, search },
  })
}

beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('W-FAIL-NO-RAW-ERROR: the door renders a fixed message only', () => {
  it.each([
    ['unavailable', strings.unavailable],
    ['cancelled', strings.cancelled],
    ['refused', strings.refused],
  ])(
    'google=%s with provider text shows only its fixed message',
    async (outcome, text) => {
      at(
        `?google=${outcome}&error=server_error&error_description=${encodeURIComponent(raw)}`
      )
      render(<SignInPage />)
      expect(await screen.findByTestId('google-sign-in-status')).toHaveTextContent(text)
      expect(screen.getByTestId('google-sign-in-status')).toHaveAttribute('role', 'alert')
      const html = document.body.innerHTML
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('Provider free text')
    }
  )

  it.each([encodeURIComponent(raw), 'toString', '__proto__', 'constructor'])(
    'an unknown outcome name (%s) shows no Google message at all',
    async (outcome) => {
      at(`?google=${outcome}`)
      render(<SignInPage />)
      await waitFor(() => expect(screen.getByTestId('google-sign-in')).toBeVisible())
      expect(screen.queryByTestId('google-sign-in-status')).toBeNull()
      expect(document.body.innerHTML).not.toContain('onerror')
    }
  )
})
