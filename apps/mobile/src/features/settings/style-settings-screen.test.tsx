// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type * as ReactNative from 'react-native'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import {
  styleProfileResponseSchema,
  updateStyleProfileInputSchema,
  type StyleProfile,
  type UpdateStyleProfileInput,
} from '@couture/api-client/contracts/http'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { server } from '@/src/test-utils/msw/server'
import { AppThemeProvider } from '@/src/theme/theme-context'
import { StyleMoodRow } from '@/src/features/preview/style-profile-controls'
import { StyleSettingsScreen } from './style-settings-screen'

const device = vi.hoisted(() => ({ fontScale: 1 }))
vi.mock('react-native', async (original) => ({
  ...(await original<typeof ReactNative>()),
  useWindowDimensions: () => ({ width: 320, height: 640, scale: 2, ...device }),
}))
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }))

const EMPTY_PROFILE: StyleProfile = {
  mood: null,
  palette: null,
  texture: null,
  fit: null,
  avoid: [],
}
const MEMBER = 'style-profile-native-member'
const TOKEN = 'style-profile-native-member-token'
const PATH = '*/api/v1/personalization/style-profile'

function renderStyleSettings() {
  return render(
    <AppThemeProvider>
      <StyleSettingsScreen />
    </AppThemeProvider>
  )
}

describe('CC-7.20 Profile style on native', () => {
  let restoreToken: () => void

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    restoreToken = setMobileAccessTokenResolver(() => TOKEN)
    setMobileApplicationUserId(MEMBER)
  })

  afterEach(async () => {
    setMobileApplicationUserId(null)
    restoreToken()
    device.fontScale = 1
    await i18n.changeLanguage('en-US')
  })

  it('[7.20-NATIVE] keeps all four German mood choices reachable at 2x text size', async () => {
    await i18n.changeLanguage('de-DE')
    const onSelect = vi.fn()
    const choices = [
      ['active', 'Sportlich'],
      ['chic', 'Schick'],
      ['cozy', 'Gemütlich'],
      ['classic', 'Klassisch'],
    ] as const
    const row = () => (
      <div style={{ width: 320 }}>
        <AppThemeProvider>
          <StyleMoodRow selected="cozy" onSelect={onSelect} />
        </AppThemeProvider>
      </div>
    )
    const moodGroup = () => screen.getByText('Stilrichtung').nextElementSibling!
    const view = render(row())
    expect(getComputedStyle(moodGroup()).overflowX).not.toBe('auto')

    device.fontScale = 2
    view.rerender(row())
    const scroll = moodGroup()
    expect(getComputedStyle(scroll).overflowX).toBe('auto')
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)

    for (const [value, label] of choices) {
      const control = screen.getByRole('button', { name: label })
      expect(control).toHaveAttribute('data-testid', `style-mood-${value}`)
      expect(control).toHaveAttribute('aria-pressed', String(value === 'cozy'))
      expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(160)
      control.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      await userEvent.click(control)
      expect(onSelect).toHaveBeenLastCalledWith(value)
    }
    expect(scroll.scrollLeft).toBeGreaterThan(0)
  })

  it.each([
    [1, 'row'],
    [2, 'column'],
  ] as const)(
    'keeps the German Tune style title and Close readable at %ix',
    async (fontScale, direction) => {
      device.fontScale = fontScale
      await i18n.changeLanguage('de-DE')
      server.use(http.get(PATH, () => HttpResponse.json({ data: EMPTY_PROFILE })))
      renderStyleSettings()

      await userEvent.click(await screen.findByTestId('style-tune-open'))
      const close = await screen.findByRole('button', { name: 'Schließen' })
      const heading = screen.getByRole('heading', { name: 'Meinen Stil anpassen' })
      const header = screen.getByTestId('layer-swipe-handle')
      expect(header).toContainElement(heading)
      expect(header).toContainElement(close)
      expect(getComputedStyle(header).flexDirection).toBe(direction)

      await userEvent.click(close)
      await waitFor(() => expect(close).not.toBeInTheDocument())
    }
  )

  it('[P1] [7.20-NATIVE] retries the same answers after a save failure, then reads and clears them', async () => {
    let profile: StyleProfile = {
      ...EMPTY_PROFILE,
      mood: 'cozy',
      palette: 'neutral',
      texture: 'smooth',
      fit: 'fitted',
      avoid: ['crop-top'],
    }
    const writes: (UpdateStyleProfileInput | 'clear')[] = []
    const reply = () =>
      HttpResponse.json(styleProfileResponseSchema.parse({ data: profile }))
    const unauthorized = () => new HttpResponse(null, { status: 401 })
    const isMember = (request: Request) =>
      request.headers.get('authorization') === `Bearer ${TOKEN}`
    server.use(
      http.get(PATH, ({ request }) => (isMember(request) ? reply() : unauthorized())),
      http.patch(PATH, async ({ request }) => {
        if (!isMember(request)) return unauthorized()
        const patch = updateStyleProfileInputSchema.parse(await request.json())
        writes.push(patch)
        if (writes.length === 1) return new HttpResponse(null, { status: 503 })
        profile = { ...profile, ...patch }
        return reply()
      }),
      http.delete(PATH, ({ request }) => {
        if (!isMember(request)) return unauthorized()
        writes.push('clear')
        profile = EMPTY_PROFILE
        return reply()
      })
    )

    const view = renderStyleSettings()
    const control = (name: string) => screen.getByTestId(`style-${name}`)
    const click = (name: string) => userEvent.click(control(name))
    await waitFor(() =>
      expect(control('mood-cozy')).toHaveAttribute('aria-pressed', 'true')
    )
    await click('tune-open')
    expect(control('palette-neutral')).toHaveAttribute('aria-pressed', 'true')
    await click('tune-skip')
    expect(control('texture-smooth')).toHaveAttribute('aria-pressed', 'true')
    expect(control('fit-fitted')).toHaveAttribute('aria-pressed', 'true')
    await click('fit-relaxed')
    await click('tune-next')
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(control('fit-relaxed')).toHaveAttribute('aria-pressed', 'true')
    await click('tune-next')
    const avoid = await screen.findByTestId('style-avoid-crop-top')
    expect(avoid).toHaveAttribute('aria-pressed', 'true')
    expect(writes).toEqual([
      { texture: 'smooth', fit: 'relaxed' },
      { texture: 'smooth', fit: 'relaxed' },
    ])
    await click('tune-skip')

    view.unmount()
    renderStyleSettings()
    await waitFor(() =>
      expect(control('mood-cozy')).toHaveAttribute('aria-pressed', 'true')
    )
    await click('tune-open')
    await click('tune-skip')
    expect(control('fit-relaxed')).toHaveAttribute('aria-pressed', 'true')
    await click('tune-skip')
    await click('tune-skip')
    await click('profile-clear')
    await waitFor(() =>
      expect(control('mood-cozy')).toHaveAttribute('aria-pressed', 'false')
    )
    expect(writes.at(-1)).toBe('clear')
    expect(writes).toHaveLength(3)
  })
})
