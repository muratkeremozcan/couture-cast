// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 D1: the signed-out Home card leads into the preview, signup and sign-in.
import { configure, screen } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { GUEST_PREVIEW_STRINGS } from '@couture/utils'
import { press } from '@/src/test-utils/press'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('expo-router', () => ({ router: navigation }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
import i18n, { initI18n } from '@/src/lib/i18n'
import { SignedOutWelcome } from './signed-out-welcome'

beforeAll(async () => {
  configure({ asyncUtilTimeout: 5_000 })
  await initI18n()
})

describe('signed-out Home welcome', () => {
  it('names the three ways forward in the active locale and opens each', async () => {
    await i18n.changeLanguage('de-DE')
    await render(<SignedOutWelcome />)
    const de = GUEST_PREVIEW_STRINGS['de-DE']
    expect(screen.getByTestId('home-signed-out-welcome').textContent).toContain(
      de.chrome.welcomeHeading
    )
    expect(screen.getByTestId('home-try-sample').textContent).toBe(
      de.firstUse.sampleEntry
    )
    press(screen.getByTestId('home-try-sample'))
    press(screen.getByTestId('home-create-account'))
    press(screen.getByTestId('home-sign-in'))
    expect(navigation.push.mock.calls.map(([href]) => href as string)).toEqual([
      '/preview',
      '/signup',
      '/signin',
    ])
    await i18n.changeLanguage('en-US')
  })
})
