// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import React from 'react'
import type * as ReactNative from 'react-native'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const captured = vi.hoisted(() => ({ props: [] as ReactNative.TextProps[] }))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNative>()
  const { forwardRef, createElement } = await import('react')
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: 'android' },
    useWindowDimensions: () => ({ width: 400, height: 800, scale: 3, fontScale: 1.5 }),
    Text: forwardRef<ReactNative.Text, ReactNative.TextProps>((props, ref) => {
      captured.props.push(props)
      return createElement(actual.Text, { ...props, ref })
    }),
  }
})
vi.mock('@/src/lib/accessibility-focus', () => ({
  safeFindNodeHandle: vi.fn((node: HTMLElement | null) => (node ? 71 : null)),
}))
vi.mock('../modules/accessibility-focus', () => ({
  focusAccessibilityElement: () => null,
}))
import { ShareCardTabHeading } from './share-card-tab-heading'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { StyleSheet } from 'react-native'
import { Text as ThemedText } from './themed'
import { shareCardHeadingNode } from '@/src/lib/share-card-focus'
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'

// The tab header renders its title inside the navigation theme, as app/_layout.tsx mounts it.
const inTheme =
  (theme = DefaultTheme) =>
  ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider value={theme}>{children}</ThemeProvider>
  )

describe('ShareCardTabHeading', () => {
  beforeEach(() => {
    captured.props = []
  })

  it('L8: the existing tab title supplies an attached fallback and unregisters after unmount', () => {
    const view = render(
      <ShareCardTabHeading scope="community" tintColor="#292724">
        Community
      </ShareCardTabHeading>,
      { wrapper: inTheme() }
    )
    expect(screen.getAllByRole('heading', { name: 'Community' })).toHaveLength(1)
    expect(shareCardHeadingNode('community')).toBe(71)
    view.unmount()
    expect(shareCardHeadingNode('community')).toBeNull()
  })
  it('L8: replacing a tab title keeps the newer heading registered', () => {
    const old = render(<ShareCardTabHeading scope="outfit">Home</ShareCardTabHeading>, {
      wrapper: inTheme(),
    })
    const current = render(
      <ShareCardTabHeading scope="outfit">Home</ShareCardTabHeading>,
      {
        wrapper: inTheme(),
      }
    )
    old.unmount()
    expect(shareCardHeadingNode('outfit')).toBe(71)
    current.unmount()
    expect(shareCardHeadingNode('outfit')).toBeNull()
  })

  it('L8: native heading keeps default scaling, exact label and the attached native focus ref', () => {
    render(
      <ShareCardTabHeading scope="outfit" tintColor="#292724">
        Home
      </ShareCardTabHeading>,
      { wrapper: inTheme() }
    )
    const heading = screen.getByRole('heading', { name: 'Home' })
    const props = captured.props.find((props) => props.children === 'Home')!
    expect(props.allowFontScaling).toBeUndefined()
    expect(props.maxFontSizeMultiplier).toBeUndefined()
    expect(props.numberOfLines).toBe(1)
    expect(StyleSheet.flatten(props.style)?.fontSize).toBe(20)
    expect(shareCardHeadingNode('outfit')).toBe(71)
    expect(vi.mocked(safeFindNodeHandle).mock.calls.at(-1)?.[0]).toBe(heading)
  })

  it('the title takes the navigation theme text color when the header passes no tint', () => {
    // The Home and Community headers set no headerTintColor, so the title had no color
    // and painted near-black on the dark header (PR 167 Android dark screenshots).
    const dark = render(<ShareCardTabHeading scope="outfit">Home</ShareCardTabHeading>, {
      wrapper: inTheme(DarkTheme),
    })
    expect(getComputedStyle(screen.getByRole('heading', { name: 'Home' })).color).toBe(
      DarkTheme.colors.text
    )
    dark.unmount()
    render(<ShareCardTabHeading scope="community">Community</ShareCardTabHeading>, {
      wrapper: inTheme(DefaultTheme),
    })
    expect(
      getComputedStyle(screen.getByRole('heading', { name: 'Community' })).color
    ).toBe(DefaultTheme.colors.text)
  })
  it('an explicit header tint still wins over the theme text color', () => {
    render(
      <ShareCardTabHeading scope="outfit" tintColor="rgb(41, 39, 36)">
        Home
      </ShareCardTabHeading>,
      { wrapper: inTheme(DarkTheme) }
    )
    expect(getComputedStyle(screen.getByRole('heading', { name: 'Home' })).color).toBe(
      'rgb(41, 39, 36)'
    )
  })

  it('ordinary themed text forwards native scaling limits, metrics and accessibility props unchanged', () => {
    render(
      <ThemedText
        testID="native-text-contract"
        maxFontSizeMultiplier={1.7}
        accessibilityRole="header"
        accessibilityLabel="Exact native label"
        accessibilityHint="Details"
        selectable
        style={{ fontSize: 16, lineHeight: 22 }}
      >
        Visible copy
      </ThemedText>
    )
    const props = captured.props.find((props) => props.testID === 'native-text-contract')!
    expect(props.allowFontScaling).toBeUndefined()
    expect(props.maxFontSizeMultiplier).toBe(1.7)
    expect(props.accessibilityHint).toBe('Details')
    expect(props.selectable).toBe(true)
    expect(StyleSheet.flatten(props.style)).toMatchObject({
      fontSize: 16,
      lineHeight: 22,
    })
    expect(screen.getByRole('heading', { name: 'Exact native label' })).toHaveTextContent(
      'Visible copy'
    )
  })
})
