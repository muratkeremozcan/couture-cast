// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D2, device review: the signup screen's Google entry follows the OS scheme. The
// light capture showed Google's dark button on the white card and an "or" rule at about 1.5:1
// with invisible lines, because the entry was fixed to the dark theme.
import type * as ReactNativeModule from 'react-native'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { contrastRatio, GOOGLE_BUTTON_THEME } from '@couture/utils'

const scheme = vi.hoisted(() => ({ current: 'light' as 'dark' | 'light' }))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return { ...actual, useColorScheme: () => scheme.current }
})
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))

import Colors from '@/constants/colors'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  SIGN_IN_DIVIDER_LINE,
  SignupGoogleEntry,
} from '@/src/features/signup/google-sign-in-button'

/** The `rgb(r, g, b)` a browser computes for a `#rrggbb` token. */
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

describe('signup Google entry in both schemes', () => {
  it('uses Google neutral light on the light page', () => {
    expect(GOOGLE_BUTTON_THEME.light).toEqual({
      background: '#FFFFFF',
      border: '#747775',
      text: '#1F1F1F',
    })
  })

  for (const name of ['light', 'dark'] as const)
    it(`${name}: draws Google's ${name} button and a legible "or" rule`, () => {
      scheme.current = name
      render(
        <SignupGoogleEntry fromPreview={false} onSignedIn={vi.fn()} onFailure={vi.fn()} />
      )
      const button = screen.getByTestId('google-sign-in')
      const buttonStyle = getComputedStyle(button)
      expect(buttonStyle.backgroundColor).toBe(rgb(GOOGLE_BUTTON_THEME[name].background))
      expect(buttonStyle.borderTopColor).toBe(rgb(GOOGLE_BUTTON_THEME[name].border))
      expect(getComputedStyle(screen.getByText('Continue with Google')).color).toBe(
        rgb(GOOGLE_BUTTON_THEME[name].text)
      )

      const page = Colors[name].page
      const rule = screen.getAllByTestId('sign-in-divider-rule')[0]!
      expect(getComputedStyle(rule).backgroundColor).toBe(rgb(SIGN_IN_DIVIDER_LINE[name]))
      expect(contrastRatio(SIGN_IN_DIVIDER_LINE[name], page)).toBeGreaterThanOrEqual(3)
      expect(getComputedStyle(screen.getByText('or')).color).toBe(
        rgb(Colors[name].inkMuted)
      )
      expect(contrastRatio(Colors[name].inkMuted, page)).toBeGreaterThanOrEqual(4.5)
    })
})
