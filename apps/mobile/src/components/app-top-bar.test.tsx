// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-NAT-002, the native top bar is 56 pt plus the top safe-area
// inset, one row with the title as the header and a back control labeled from the catalog (D6).
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 (TEA): tab titles read Closet and Today (D1), Capsules' parent is Looks (D10), and
// the tab header carries the trailing actions a tab sets (the Closet's Add and More, D4).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-020 (D5, T4), a saved look's screen shows the look's
// name with back; a cold link or View goes back to Looks on Saved, a Saved tile entry to its page.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { colorRoles, shell } from '@couture/utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const routerMocks = vi.hoisted(() => ({ replace: vi.fn(), dismissTo: vi.fn() }))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', () => ({
  router: { replace: routerMocks.replace, dismissTo: routerMocks.dismissTo },
}))
// The icon font loader has no web module Vite resolves; the chevron is decoration.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
  }
})

import i18n, { initI18n } from '@/src/lib/i18n'
import {
  AppTopBar,
  PARENT_TAB,
  renderStackTopBar,
  renderTabTopBar,
  tabsAnchorListeners,
} from './app-top-bar'

const bar = () => screen.getByTestId('app-top-bar')

// The root stack with a real caller below the screen; the cold-link anchor case runs through
// Expo Router itself in app-top-bar.routing.test.tsx.
const capsules = { key: 'wardrobe-capsules-1', name: 'wardrobe-capsules' }
const caller = { key: 'wardrobe-onboarding-1', name: 'wardrobe-onboarding' }

function stackProps(overrides: Record<string, unknown> = {}) {
  return {
    options: { title: 'Outfit capsules' },
    route: capsules,
    navigation: {
      goBack: vi.fn(),
      canGoBack: () => true,
      getState: () => ({ routes: [caller, capsules] }),
    },
    ...overrides,
  }
}

describe('7.9-NAT-002 AppTopBar (native)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterEach(async () => {
    routerMocks.replace.mockClear()
    routerMocks.dismissTo.mockClear()
    await act(() => i18n.changeLanguage('en-US'))
  })

  it('is 56 pt plus the top inset, on the page surface, with the title as its header', () => {
    render(<AppTopBar title="Closet" />)

    const style = getComputedStyle(bar())
    expect(style.height).toBe(`${shell.topBarHeight + 24}px`)
    expect(style.paddingTop).toBe('24px')
    expect(screen.getByRole('heading')).toHaveTextContent('Closet')
    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
    expect(colorRoles.light.page).toBe('#FFFFFF')
    expect(style.backgroundColor).toBe('rgb(255, 255, 255)')
  })

  it('labels the back control from the catalog and calls onBack', async () => {
    const onBack = vi.fn()
    render(<AppTopBar title="Outfit capsules" onBack={onBack} />)

    const back = screen.getByTestId('app-top-bar-back')
    expect(back).toHaveAccessibleName('Back')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)

    await act(() => i18n.changeLanguage('de-DE'))
    expect(screen.getByTestId('app-top-bar-back')).toHaveAccessibleName(
      i18n.t('shell.back', { lng: 'de-DE' })
    )
    expect(i18n.t('shell.back', { lng: 'de-DE' })).not.toBe('Back')
  })

  it('as the tab header shows the tab title and no back', () => {
    render(renderTabTopBar({ ...stackProps({ options: { title: 'Community' } }) }))

    expect(screen.getByRole('heading')).toHaveTextContent('Community')
    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
  })

  it('as the stack header goes back to the screen below', () => {
    const props = stackProps({ back: { title: 'Closet', href: undefined } })
    render(renderStackTopBar(props))

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(props.navigation.goBack).toHaveBeenCalledTimes(1)
    expect(routerMocks.replace).not.toHaveBeenCalled()
  })

  it('[7.11 D10] on a direct entry goes back to the parent tab, Looks for Capsules', () => {
    render(renderStackTopBar(stackProps()))

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(routerMocks.replace).toHaveBeenCalledExactlyOnceWith('/looks')
  })

  /** The saved look screen's header with `below` under it and `from` in its params. */
  function savedLookHeader(
    below: { key: string; name: string },
    title: string,
    from?: string
  ) {
    const savedLook = {
      key: `saved-look-${below.key}`,
      name: 'saved-look/[savedLookId]',
      params:
        from === undefined ? { savedLookId: 'sl-1' } : { savedLookId: 'sl-1', from },
    }
    const props = stackProps({
      options: { title },
      route: savedLook,
      back: { title: 'below', href: undefined },
      navigation: {
        goBack: vi.fn(),
        canGoBack: () => true,
        getState: () => ({ routes: [below, savedLook] }),
      },
    })
    render(renderStackTopBar(props))
    expect(screen.getByRole('heading')).toHaveTextContent(title)
    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    return props.navigation.goBack
  }

  const SAVED = { pathname: '/looks', params: { segment: 'saved' } }

  it('[P0] [7.12-NAT-020] PARENT_TAB sends a saved look to Looks on Saved', () => {
    expect(PARENT_TAB['saved-look/[savedLookId]']).toEqual(SAVED)
  })

  it('[P0] [7.12-NAT-020] a cold link to a saved look shows its name and back goes to Looks on Saved', () => {
    // Expo Router passes `back` for the inserted, never-seen tab anchor; a link carries no `from`.
    const goBack = savedLookHeader({ key: 'tabs-cold', name: '(tabs)' }, 'Rainy commute')

    expect(routerMocks.dismissTo).toHaveBeenCalledExactlyOnceWith(SAVED)
    expect(goBack).not.toHaveBeenCalled()
    expect(routerMocks.replace).not.toHaveBeenCalled()
  })

  it('[P0] [7.12-NAT-020] TEA T4: View from a save confirmation goes back to Looks on Saved, not to the saving screen', () => {
    const goBack = savedLookHeader(caller, 'Weekend layers')

    expect(routerMocks.dismissTo).toHaveBeenCalledExactlyOnceWith(SAVED)
    expect(goBack).not.toHaveBeenCalled()
  })

  it('[P0] [7.12-NAT-020] a saved look opened from a Saved tile pops back to that Looks page', () => {
    const anchor = { key: 'tabs-seen', name: '(tabs)' }
    // The member was on Looks: pushing the saved look blurred the tab anchor.
    tabsAnchorListeners({ route: anchor }).blur()
    const goBack = savedLookHeader(anchor, 'Weekend layers', 'today')

    expect(goBack).toHaveBeenCalledTimes(1)
    expect(routerMocks.dismissTo).not.toHaveBeenCalled()
    expect(routerMocks.replace).not.toHaveBeenCalled()
  })

  it('[P1] [7.12-NAT-020] a cold entry that carries a filter replaces to Looks on Saved', () => {
    const goBack = savedLookHeader(
      { key: 'tabs-cold-from', name: '(tabs)' },
      'Rainy commute',
      'all'
    )

    expect(routerMocks.replace).toHaveBeenCalledExactlyOnceWith(SAVED)
    expect(goBack).not.toHaveBeenCalled()
  })

  it('[7.11 D4] as the tab header draws the trailing actions the tab sets', () => {
    render(
      renderTabTopBar({
        ...stackProps({
          options: {
            title: 'Closet',
            headerRight: () => <button type="button" data-testid="closet-trailing" />,
          },
        }),
      })
    )

    const bar = screen.getByTestId('app-top-bar')
    expect(bar).toContainElement(screen.getByTestId('closet-trailing'))
    expect(screen.getByRole('heading')).toHaveTextContent('Closet')
    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
  })

  it('hides the back control when the screen asks for none', () => {
    render(
      renderStackTopBar(
        stackProps({
          back: { title: 'Today', href: undefined },
          options: { title: 'Finish', headerBackVisible: false },
        })
      )
    )

    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
  })
})
