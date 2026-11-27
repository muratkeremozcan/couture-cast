// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-001 (five tabs in order, ids and catalog labels),
// 7.11-NAT-002 (each icon is the shared react-native-svg path set, no FontAwesome), 7.11-NAT-003
// (the active tab's heavier label and its indicator, only on the active tab), the Style half of
// 7.11-NAT-013 (Style lists Silhouette, Closet setup and Color palette), 7.11-NAT-020 (PARENT_TAB
// covers every D10 native route; a cold entry's back replaces to it), 7.11-NAT-021 (each named
// route's stack top bar has back and its title) and 7.11-NAT-022 (in-stack back pops the caller;
// a pop that bypasses the bar lands on the parent through `tabsAnchorListeners`), and the Style
// screen of 7.11-NAT-040 (it reads nothing, so a guardian-pending teen opens it like anyone).
// The navigators are stood in for so the options the layouts hand them can be read; the headers,
// labels and icons they are handed render for real. The selected state of the real tab buttons
// runs through Expo Router in app-top-bar.routing.test.tsx; the label floor (7.11-NAT-004) in
// five-tab-label-floor.test.tsx; the fold, the More sheet, Looks and Profile in the
// screen-budget-*.test.tsx suites and five-tab-closet.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-020 (D5, PARENT_TAB sends a saved look's direct
// entry to Looks on Saved; its top bar has back and the look's name) and 7.12-NAT-033 (D11, the
// `planner` route is a redirect to Looks with `segment=plan` and declares no screen of its own).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import React, { type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { APP_TABS, TAB_ICON_PATHS, type AppTabId } from '@couture/utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

interface CapturedScreen {
  name?: string
  options?: Record<string, unknown>
}

const captured = vi.hoisted(() => ({
  tabOptions: {} as Record<string, unknown>,
  tabs: [] as CapturedScreen[],
  stackScreens: [] as CapturedScreen[],
  redirects: [] as unknown[],
}))
const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  setParams: vi.fn(),
  dismissTo: vi.fn(),
}))

vi.mock('expo-router', () => {
  const Tabs = ({
    screenOptions,
    children,
  }: {
    screenOptions: Record<string, unknown>
    children?: ReactNode
  }) => {
    captured.tabOptions = screenOptions
    return <>{children}</>
  }
  Tabs.Screen = (props: CapturedScreen) => {
    captured.tabs.push(props)
    return null
  }
  const Stack = ({ children }: { children?: ReactNode }) => <>{children}</>
  Stack.Screen = (props: CapturedScreen) => {
    captured.stackScreens.push(props)
    return null
  }
  // Story CC-7.12 D11: `app/planner.tsx` renders a Redirect; the double records its target.
  const Redirect = ({ href }: { href: unknown }) => {
    captured.redirects.push(href)
    return null
  }
  return {
    Tabs,
    Stack,
    Redirect,
    Link: ({ children }: { children: ReactNode }) => <>{children}</>,
    router: routerMock,
    useRouter: () => routerMock,
  }
})
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// The icon font's native module is absent in the browser. The double marks every FontAwesome
// glyph it draws, so a tab icon drawn with it would show.
vi.mock('@expo/vector-icons/FontAwesome', () => ({
  default: ({ name }: { name: string }) => <span data-fontawesome={name} />,
}))
vi.mock('@/components/android-share-card-presentation', () => ({
  useAndroidNavigationIntent: () => () => undefined,
}))
vi.mock('@/components/share-card-tab-heading', () => ({
  ShareCardTabHeading: () => null,
}))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)
// The routes' own screens are not under test here, only the titles the routes declare.
vi.mock('@/src/features/premium/palette-advisor-screen', () => ({
  PaletteAdvisorScreen: () => null,
}))
vi.mock('@/src/features/wardrobe/wardrobe-onboarding-screen', () => ({
  WardrobeOnboardingScreen: () => null,
}))
vi.mock('@/src/features/wardrobe/wardrobe-silhouette-screen', () => ({
  WardrobeSilhouetteScreen: () => null,
}))

import i18n, { initI18n } from '@/src/lib/i18n'
import TabLayout from '../../app/(tabs)/_layout'
import PaletteAdvisorRoute from '../../app/palette-advisor'
import PlannerRoute from '../../app/planner'
import SettingsStyleRoute from '../../app/settings-style'
import WardrobeOnboardingRoute from '../../app/wardrobe-onboarding'
import WardrobeSilhouetteRoute from '../../app/wardrobe-silhouette'
import {
  PARENT_TAB,
  forgetSeenTabAnchorsForTesting,
  renderStackTopBar,
  tabsAnchorListeners,
} from '@/src/components/app-top-bar'

const ORDER: readonly AppTabId[] = ['home', 'wardrobe', 'looks', 'community', 'settings']
const EN_LABELS = ['Today', 'Closet', 'Looks', 'Community', 'Profile']

/** Spec D10: every native sub-screen route and the tab a direct entry goes back to. */
const D10_PARENTS: Readonly<
  Record<string, string | { pathname: string; params: Record<string, string> }>
> = {
  'wardrobe-garment': '/wardrobe',
  'wardrobe-onboarding': '/wardrobe',
  'wardrobe-silhouette': '/wardrobe',
  'wardrobe-capsules': '/looks',
  // Story CC-7.12 D5: a saved look's direct entry goes back to Looks on Saved.
  'saved-look/[savedLookId]': { pathname: '/looks', params: { segment: 'saved' } },
  // The `planner` route redirects before it shows (7.12-NAT-033); its entry stays a fallback.
  planner: '/looks',
  'settings-account': '/settings',
  'settings-premium': '/settings',
  'settings-language': '/settings',
  'settings-about': '/settings',
  'settings-style': '/settings',
  'palette-advisor': '/settings',
  'notification-settings': '/settings',
  locations: '/settings',
  'guardian-dashboard': '/settings',
  'teen-dashboard': '/settings',
}

type IconRender = (props: { color: string; focused: boolean; size: number }) => ReactNode
type LabelRender = (props: {
  color: string
  children: string
  focused: boolean
  position: 'below-icon' | 'beside-icon'
}) => ReactNode

/** The tab screens the layout declares, in order, without the hidden `two` route. */
function declaredTabs() {
  captured.tabs.length = 0
  render(<TabLayout />).unmount()
  return captured.tabs.filter((tab) => tab.options?.href !== null)
}

/** The title a route file declares through `<Stack.Screen options={{ title }} />`. */
function routeTitle(Route: () => ReactNode) {
  captured.stackScreens.length = 0
  render(<Route />).unmount()
  const title = captured.stackScreens.at(-1)?.options?.title
  if (typeof title !== 'string') throw new Error('the route declared no title')
  return title
}

/** The root stack's header for `name`, with `below` as the route under it. */
function stackHeader(
  name: string,
  title: string,
  below: { key: string; name: string },
  goBack = vi.fn()
) {
  // A saved look opened from a Saved tile carries its filter (TEA T2); one opened by View has
  // none and dismisses to Looks Saved (TEA T4, app-top-bar.test.tsx).
  const route =
    name === 'saved-look/[savedLookId]'
      ? { key: `${name}-1`, name, params: { savedLookId: 'sl-1', from: 'all' } }
      : { key: `${name}-1`, name }
  const view = render(
    renderStackTopBar({
      options: { title },
      route,
      navigation: {
        goBack,
        canGoBack: () => true,
        getState: () => ({ routes: [below, route] }),
      },
      back: { title: 'below', href: undefined },
    })
  )
  return { view, goBack }
}

describe('CC-7.11 native five tabs and the back pattern', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    forgetSeenTabAnchorsForTesting()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('[P0] [7.11-NAT-001] declares Today, Closet, Looks, Community and Profile in order with their ids', () => {
    const tabs = declaredTabs()

    expect(tabs.map((tab) => tab.name)).toEqual([
      'index',
      'wardrobe',
      'looks',
      'community',
      'settings',
    ])
    expect(tabs.map((tab) => tab.options?.tabBarButtonTestID)).toEqual(
      ORDER.map((id) => `tab-${id}`)
    )
    expect(tabs.map((tab) => tab.options?.title)).toEqual(EN_LABELS)
    expect(tabs.map((tab) => tab.options?.tabBarAccessibilityLabel)).toEqual(EN_LABELS)
    // One definition for both platforms: the shared list names the same routes and labels.
    expect(APP_TABS.map((tab) => tab.nativeRoute)).toEqual(tabs.map((tab) => tab.name))
    expect(APP_TABS.map((tab) => i18n.t(`tabs.${tab.labelKey}`))).toEqual(EN_LABELS)
    // The hidden route stays routable but never shows a tab.
    expect(captured.tabs.find((tab) => tab.name === 'two')?.options?.href).toBeNull()
  })

  it('[P1] [7.11-NAT-001] reads the labels from the tabs catalog in the member language', async () => {
    await act(() => i18n.changeLanguage('de-DE'))
    const tabs = declaredTabs()

    expect(tabs.map((tab) => tab.options?.title)).toEqual([
      'Heute',
      'Schrank',
      'Looks',
      'Community',
      'Profil',
    ])
  })

  it('[P0] [7.11-NAT-002] draws each tab icon from the shared path set, in the label color, without FontAwesome', () => {
    const tabs = declaredTabs()

    for (const [index, tab] of tabs.entries()) {
      const id = ORDER[index]!
      const icon = tab.options?.tabBarIcon as IconRender
      const { container, unmount } = render(
        <>{icon({ color: 'rgb(1, 2, 3)', focused: false, size: 24 })}</>
      )
      const svg = container.querySelector(`svg[data-testid="tab-${id}-icon"]`)
      expect(svg, `${id} icon svg`).not.toBeNull()
      expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24')
      const paths = Array.from(svg!.querySelectorAll('path'))
      expect(paths.map((path) => path.getAttribute('d'))).toEqual([...TAB_ICON_PATHS[id]])
      for (const path of paths) {
        expect(path.getAttribute('stroke')).toBe('rgb(1, 2, 3)')
        expect(path.getAttribute('fill')).toBe('none')
      }
      expect(
        container.querySelector('[data-fontawesome]'),
        `${id} FontAwesome`
      ).toBeNull()
      unmount()
    }
    // Five distinct icons.
    expect(new Set(ORDER.map((id) => TAB_ICON_PATHS[id].join(' '))).size).toBe(5)
  })

  it('[P0] [7.11-NAT-003] marks only the active tab with the indicator and a semibold label', () => {
    const tabs = declaredTabs()
    const label = captured.tabOptions.tabBarLabel as LabelRender

    for (const [index, tab] of tabs.entries()) {
      const id = ORDER[index]!
      const icon = tab.options?.tabBarIcon as IconRender
      for (const focused of [true, false]) {
        const { unmount } = render(
          <>
            {icon({ color: 'rgb(1, 2, 3)', focused, size: 24 })}
            {label({
              color: 'rgb(1, 2, 3)',
              children: EN_LABELS[index]!,
              focused,
              position: 'below-icon',
            })}
          </>
        )
        const indicator = screen.queryByTestId(`tab-${id}-active-indicator`)
        if (focused) {
          expect(indicator, `${id} indicator when active`).not.toBeNull()
          expect(getComputedStyle(indicator!).backgroundColor).toBe('rgb(1, 2, 3)')
          expect(indicator!.getBoundingClientRect().height).toBeGreaterThan(0)
        } else {
          expect(indicator, `${id} indicator when inactive`).toBeNull()
        }
        const weight = Number(
          getComputedStyle(screen.getByText(EN_LABELS[index]!)).fontWeight
        )
        // P6: the active label weighs 600 or more, an inactive one 400 or 500.
        if (focused) expect(weight, `${id} active weight`).toBeGreaterThanOrEqual(600)
        else expect([400, 500], `${id} inactive weight`).toContain(weight)
        unmount()
      }
    }
  })

  it('[P1] [7.11-NAT-013] Style lists Silhouette, Closet setup and Color palette, and each opens its screen', () => {
    // NAT-040: the Style screen reads nothing, so no consent or guardian state can hold it.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<SettingsStyleRoute />)

    const rows = ['style-row-silhouette', 'style-row-setup', 'style-row-palette'].map(
      (id) => screen.getByTestId(id)
    )
    expect(rows.map((row) => row.textContent)).toEqual([
      'Silhouette',
      'Closet setup',
      'Color palette',
    ])
    for (const [index, row] of rows.entries())
      if (index > 0)
        expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          rows[index - 1]!.getBoundingClientRect().bottom - 0.5
        )
    for (const row of rows) fireEvent.click(row)
    expect(routerMock.push.mock.calls).toEqual([
      ['/wardrobe-silhouette'],
      ['/wardrobe-onboarding'],
      ['/palette-advisor'],
    ])
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('[P0] [7.11-NAT-020] PARENT_TAB names the D10 parent of every native sub-screen route', () => {
    expect(PARENT_TAB).toEqual(D10_PARENTS)
  })

  it.each(Object.entries(D10_PARENTS))(
    '[P0] [7.11-NAT-020] a cold entry to %s goes back by replacing to %s',
    (name, parent) => {
      // A cold deep link inserts an unseen tab anchor below the linked screen.
      stackHeader(name, name, { key: `cold-anchor-${name}`, name: '(tabs)' })

      fireEvent.click(screen.getByTestId('app-top-bar-back'))
      expect(routerMock.replace).toHaveBeenCalledExactlyOnceWith(parent)
    }
  )

  it('[P0] [7.12-NAT-033] the planner route redirects to Looks on Plan and declares no screen', () => {
    captured.redirects.length = 0
    captured.stackScreens.length = 0
    render(<PlannerRoute />).unmount()

    expect(captured.redirects).toEqual([
      { pathname: '/looks', params: { segment: 'plan' } },
    ])
    // No planner title or top bar: Plan is a segment of the Looks tab (D10).
    expect(captured.stackScreens).toEqual([])
  })

  it('[P0] [7.11-NAT-021] [7.12-NAT-020] each named sub-screen shows back and its title in the stack top bar', () => {
    // The titles the routes declare themselves, and those app/_layout.tsx registers (pinned
    // there by root-layout-startup.test.tsx). Story CC-7.12: `planner` is a redirect (above);
    // a saved look titles itself with the look's name once read.
    const titles: [string, string][] = [
      ['saved-look/[savedLookId]', 'Rainy commute'],
      ['palette-advisor', routeTitle(PaletteAdvisorRoute)],
      ['wardrobe-onboarding', routeTitle(WardrobeOnboardingRoute)],
      ['wardrobe-silhouette', routeTitle(WardrobeSilhouetteRoute)],
      ['wardrobe-capsules', i18n.t('wardrobe.capsules.title')],
      ['settings-account', i18n.t('settings.profile.account')],
      ['settings-premium', i18n.t('settings.profile.premium')],
      ['settings-language', i18n.t('settings.profile.language')],
      ['settings-about', i18n.t('settings.profile.about')],
      ['settings-style', i18n.t('settings.profile.style')],
      ['guardian-dashboard', i18n.t('guardian.dashboard.title')],
      ['teen-dashboard', i18n.t('teen.dashboard.title')],
      ['notification-settings', i18n.t('community.notifications.title')],
      ['locations', i18n.t('settings.profile.places')],
    ]
    // The builder and TEA title contract (spec Plan Change Log).
    expect(Object.fromEntries(titles)).toMatchObject({
      'saved-look/[savedLookId]': 'Rainy commute',
      'palette-advisor': 'Color palette',
      'wardrobe-onboarding': 'Closet setup',
      'wardrobe-silhouette': 'Silhouette',
      'wardrobe-capsules': 'Outfit capsules',
      'settings-style': 'Style',
      'guardian-dashboard': 'Guardian dashboard',
      'teen-dashboard': 'Teen dashboard',
    })

    for (const [name, title] of titles) {
      const { view } = stackHeader(name, title, {
        key: 'caller-1',
        name: 'wardrobe-garment',
      })
      expect(screen.getByTestId('app-top-bar-back'), `${name} back`).toHaveAccessibleName(
        i18n.t('shell.back')
      )
      expect(screen.getByTestId('app-top-bar-title'), `${name} title`).toHaveTextContent(
        title
      )
      expect(screen.getByRole('heading')).toHaveTextContent(title)
      view.unmount()
    }
  })

  it('[P0] [7.11-NAT-022] [7.12-NAT-020] back with a real caller below pops it, never replacing to the parent tab', () => {
    // CC-7.12: the saved look screen stands in for the old planner screen, now a redirect.
    const { goBack } = stackHeader('saved-look/[savedLookId]', 'Rainy commute', {
      key: 'caller-1',
      name: 'wardrobe-capsules',
    })

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(routerMock.dismissTo).not.toHaveBeenCalled()
  })

  it('[P0] [7.11-NAT-022] back over a tab the member came from pops to it', () => {
    const anchor = { key: 'seen-anchor', name: '(tabs)' }
    // The member was on a tab: pushing the screen blurred the anchor.
    tabsAnchorListeners({ route: anchor }).blur()
    const { goBack } = stackHeader('saved-look/[savedLookId]', 'Rainy commute', anchor)

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(routerMock.dismissTo).not.toHaveBeenCalled()
  })

  it.each(Object.entries(D10_PARENTS))(
    '[P0] [7.11-NAT-022] a system back from a cold entry to %s lands on %s through the anchor listener',
    (name, parent) => {
      const anchor = { key: `cold-system-${name}`, name: '(tabs)' }
      // The header records the parent owed to the unseen anchor below the cold link.
      stackHeader(name, name, anchor)
      // Android hardware back or the iOS swipe pops the screen without the top bar: the anchor
      // comes to the front for the first time.
      tabsAnchorListeners({ route: anchor }).focus()
      expect(routerMock.navigate).toHaveBeenCalledExactlyOnceWith(parent)
      // A later focus of the same anchor is the member's own tab and moves nowhere.
      tabsAnchorListeners({ route: anchor }).focus()
      expect(routerMock.navigate).toHaveBeenCalledTimes(1)
    }
  )
})
