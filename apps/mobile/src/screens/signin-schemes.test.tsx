// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 device review: the sign-in screen in both OS schemes. The dark capture showed the
// Email label black on the black page, because the plain React Native text carried no color.
import type * as ReactNativeModule from 'react-native'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '@couture/utils'

const scheme = vi.hoisted(() => ({ current: 'light' as 'dark' | 'light' }))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return { ...actual, useColorScheme: () => scheme.current }
})
vi.mock('@/src/lib/native-session', () => ({
  requestNativeOtp: vi.fn(),
  verifyNativeOtp: vi.fn(),
  startNativeGoogleSignIn: vi.fn(),
}))
vi.mock('expo-router', () => ({
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
  useLocalSearchParams: () => ({}),
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))

import Colors from '@/constants/colors'
import i18n, { initI18n } from '@/src/lib/i18n'
import SignInScreen from '../../app/signin'

/** The `rgb(r, g, b)` a browser computes for a `#rgb` or `#rrggbb` token. */
function rgb(hex: string) {
  const digits = hex.replace('#', '')
  const full = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})

describe('sign-in screen in both schemes', () => {
  for (const name of ['light', 'dark'] as const)
    it(`${name}: page, label, field text and button follow the scheme`, () => {
      scheme.current = name
      const colors = Colors[name]
      render(<SignInScreen />)
      expect(getComputedStyle(screen.getByTestId('signin-screen')).backgroundColor).toBe(
        rgb(colors.page)
      )
      expect(getComputedStyle(screen.getByText('Email')).color).toBe(rgb(colors.ink))
      const field = getComputedStyle(screen.getByTestId('signin-email-input'))
      expect(field.color).toBe(rgb(colors.ink))
      expect(field.borderTopColor).toBe(rgb(colors.lineStrong))
      expect(contrastRatio(colors.ink, colors.page)).toBeGreaterThanOrEqual(4.5)
      const send = getComputedStyle(screen.getByText('Send sign-in code'))
      expect(send.color).toBe(rgb(colors.onPrimary))
      expect(send.fontWeight).toBe('700')
    })
})
