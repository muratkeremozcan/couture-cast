// Story CC-7.9 D1 owner: native reads the one token set through `useTokens()`.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
import {
  colorRoles,
  elevation,
  fontWeight,
  radius,
  SCRIM_OPACITY,
  SHADOW_COLOR,
  shell,
  space,
  typeScale,
  withAlpha,
  type ColorRoles,
  type ColorScheme,
  type ElevationKey,
} from '@couture/utils'
import { useColorScheme } from 'react-native'

export interface Tokens {
  scheme: ColorScheme
  /** The D2 color roles of the active scheme (`page`, `card`, `ink`, `inkMuted`, ...). */
  colors: ColorRoles
  /** The scrim at its standard opacity, ready to paint behind a sheet or dialog. */
  scrim: string
  space: typeof space
  radius: typeof radius
  type: typeof typeScale
  fontWeight: typeof fontWeight
  shell: typeof shell
}

function buildTokens(scheme: ColorScheme): Tokens {
  return Object.freeze({
    scheme,
    colors: colorRoles[scheme],
    scrim: withAlpha(colorRoles[scheme].scrim, SCRIM_OPACITY),
    space,
    radius,
    type: typeScale,
    fontWeight,
    shell,
  })
}

const TOKENS: Readonly<Record<ColorScheme, Tokens>> = Object.freeze({
  light: buildTokens('light'),
  dark: buildTokens('dark'),
})

/** The tokens for a scheme, for code that is not a component (a stylesheet factory). */
export function tokensFor(scheme: ColorScheme): Tokens {
  return TOKENS[scheme]
}

/** `'dark'` when the OS is dark, `'light'` otherwise (including an unknown scheme). */
export function resolveScheme(value: string | null | undefined): ColorScheme {
  return value === 'dark' ? 'dark' : 'light'
}

/**
 * The tokens of the OS scheme. `useColorScheme` re-renders on a live flip, so every screen that
 * reads its colors here follows the system setting without a reload.
 */
export function useTokens(): Tokens {
  return TOKENS[resolveScheme(useColorScheme())]
}

/** A D4 elevation level as React Native shadow props (iOS shadow and Android elevation). */
export function elevationStyle(level: ElevationKey) {
  const { offsetY, blur, opacity, androidElevation } = elevation[level]
  return {
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: blur / 2,
    elevation: androidElevation,
  } as const
}

export { withAlpha }
