/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */

import {
  Text as DefaultText,
  View as DefaultView,
  StyleSheet,
  useColorScheme,
} from 'react-native'

import Colors, { type SchemeColors } from '@/constants/colors'

type ThemeProps = {
  lightColor?: string
  darkColor?: string
}

export type TextProps = ThemeProps & DefaultText['props']
export type ViewProps = ThemeProps & DefaultView['props']

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof (typeof Colors)['light']
) {
  const theme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const colorFromProps = props[theme]

  if (colorFromProps) {
    return colorFromProps
  } else {
    return Colors[theme][colorName]
  }
}

/** The OS scheme's chrome tokens (`constants/colors.ts`), for styles a themed View or Text cannot carry. */
export function useSchemeColors() {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light']
}

/**
 * A stylesheet per OS scheme, created once at module load: the returned hook hands back the
 * active scheme's sheet, so a screen keeps its layout in one static sheet and its colors here.
 */
export function createSchemeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: SchemeColors) => T
) {
  const light = StyleSheet.create(factory(Colors.light))
  const dark = StyleSheet.create(factory(Colors.dark))
  return function useSchemeStyles() {
    return useColorScheme() === 'dark' ? dark : light
  }
}

export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text')

  return <DefaultText style={[{ color }, style]} {...otherProps} />
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    'background'
  )

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />
}
