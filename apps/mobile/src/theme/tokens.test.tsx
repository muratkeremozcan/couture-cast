// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-NAT-001, `useTokens()` returns the roles of the OS scheme and
// follows a live flip without a remount (D1, AC 2).
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
import React, { useEffect } from 'react'
import type * as ReactNativeModule from 'react-native'
import { View } from 'react-native'
import { act, render, screen } from '@testing-library/react'
import { colorRoles, shell, space } from '@couture/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveColorScheme } from '@/src/test-utils/live-color-scheme'
import { elevationStyle, resolveScheme, tokensFor, useTokens } from './tokens'

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const { liveColorScheme: live } = await import('@/src/test-utils/live-color-scheme.js')
  return { ...actual, useColorScheme: live.useColorScheme }
})

const mounts = vi.fn()

function Surface() {
  const { colors, scheme } = useTokens()
  useEffect(() => {
    mounts()
  }, [])
  return (
    <View
      testID="surface"
      accessibilityLabel={scheme}
      style={{ backgroundColor: colors.page, borderColor: colors.line }}
    />
  )
}

/** The `rgb(r, g, b)` a browser computes for `#rrggbb`. */
function rgb(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

describe('7.9-NAT-001 useTokens follows the OS scheme', () => {
  afterEach(() => {
    liveColorScheme.reset()
    mounts.mockClear()
  })

  it('returns the dark roles under a dark OS and the light roles otherwise', () => {
    expect(tokensFor('dark').colors).toEqual(colorRoles.dark)
    expect(tokensFor('light').colors).toEqual(colorRoles.light)
    expect(resolveScheme('dark')).toBe('dark')
    expect(resolveScheme(null)).toBe('light')
    expect(resolveScheme('unspecified')).toBe('light')
  })

  it('repaints the page surface on a live flip, in place', () => {
    render(<Surface />)
    const surface = screen.getByTestId('surface')
    expect(getComputedStyle(surface).backgroundColor).toBe(rgb(colorRoles.light.page))

    act(() => liveColorScheme.set('dark'))

    expect(screen.getByTestId('surface')).toBe(surface)
    expect(getComputedStyle(surface).backgroundColor).toBe(rgb(colorRoles.dark.page))
    expect(surface).toHaveAttribute('aria-label', 'dark')
    expect(mounts).toHaveBeenCalledTimes(1)

    act(() => liveColorScheme.set('light'))
    expect(getComputedStyle(surface).backgroundColor).toBe(rgb(colorRoles.light.page))
  })

  it('carries the D4 scales and shell sizes', () => {
    const tokens = tokensFor('light')
    expect(tokens.space).toBe(space)
    expect(tokens.shell).toBe(shell)
    expect(tokens.scrim).toBe('rgba(0, 0, 0, 0.5)')
    expect(elevationStyle('none')).toMatchObject({ shadowOpacity: 0, elevation: 0 })
    expect(elevationStyle('overlay').elevation).toBeGreaterThan(
      elevationStyle('card').elevation
    )
  })
})
