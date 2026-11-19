// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19): Jade could not find a profile. The settings tab now reads
// Profile in every locale. Its route, its `tab-settings` id (which the Maestro flows tap) and its
// analytics tab id stay, so only the words a member sees change. The tab navigator is the
// boundary: `Tabs.Screen` records the options the layout gives each tab.
import React from 'react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

interface ScreenProps {
  name: string
  options?: {
    title?: string
    tabBarAccessibilityLabel?: string
    tabBarButtonTestID?: string
    href?: null
  }
  listeners?: { tabPress?: () => void }
}

const { screens, captureMock } = vi.hoisted(() => ({
  screens: [] as ScreenProps[],
  captureMock: vi.fn(),
}))

vi.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}</>
  Tabs.Screen = (props: ScreenProps) => {
    screens.push(props)
    return null
  }
  return { Tabs, Link: ({ children }: { children: React.ReactNode }) => <>{children}</> }
})
// The icon font loads a native module the browser runner does not have.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/components/android-share-card-presentation', () => ({
  useAndroidNavigationIntent: () => () => undefined,
}))
vi.mock('@/components/share-card-tab-heading', () => ({
  ShareCardTabHeading: () => null,
}))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock({
    capture: captureMock,
  })
)

import i18n, { initI18n } from '@/src/lib/i18n'
import TabLayout from '../../app/(tabs)/_layout'

async function settingsTab(): Promise<ScreenProps> {
  screens.length = 0
  const view = await render(<TabLayout />)
  const tab = screens.find((screen) => screen.name === 'settings')
  await view.unmount()
  if (!tab) throw new Error('The settings tab was not declared')
  return tab
}

describe('Profile tab', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    captureMock.mockReset()
    await i18n.changeLanguage('en-US')
  })

  it('PROFILE-MOB-TAB-01 labels the settings route Profile and keeps its id and analytics tab id', async () => {
    const tab = await settingsTab()

    expect(tab.options?.title).toBe('Profile')
    expect(tab.options?.tabBarAccessibilityLabel).toBe('Profile')
    expect(tab.options?.tabBarButtonTestID).toBe('tab-settings')

    tab.listeners?.tabPress?.()
    expect(captureMock).toHaveBeenCalledWith('bottom_nav_clicked', {
      tabId: 'settings',
      label: 'Profile',
      targetPath: '/settings',
    })
  })

  it.each([
    ['tr-TR', 'Profil'],
    ['de-DE', 'Profil'],
    ['fr-CA', 'Profil'],
    ['es-419', 'Perfil'],
    ['it-IT', 'Profilo'],
    ['pt-PT', 'Perfil'],
  ])('PROFILE-MOB-TAB-02 reads the tab in %s as %s', async (locale, label) => {
    await i18n.changeLanguage(locale)

    const tab = await settingsTab()

    expect(tab.options?.title).toBe(label)
    expect(tab.options?.tabBarAccessibilityLabel).toBe(label)
  })
})
