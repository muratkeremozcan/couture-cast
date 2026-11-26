import React, { useLayoutEffect, useRef } from 'react'
import { Text } from 'react-native'
import { useTheme } from '@react-navigation/native'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  registerShareCardHeading,
  type ShareCardHeadingScope,
} from '@/src/lib/share-card-focus'
import { useTokens } from '@/src/theme/tokens'

/** Keep the existing tab title visible and addressable by native accessibility focus. */
export function ShareCardTabHeading({
  children,
  tintColor,
  scope,
}: {
  children: string
  tintColor?: string
  scope: ShareCardHeadingScope
}) {
  const title = useRef<Text>(null)
  // No headerTintColor is set, so React Navigation passes no tint; its own default title
  // falls back to the theme's text color, and so must this one, or a plain Text paints
  // near-black on the dark header.
  const { colors } = useTheme()
  // Story CC-7.9 D6: the same title style as AppTopBar's plain title on every tab.
  const { type, fontWeight } = useTokens()
  useLayoutEffect(
    () => registerShareCardHeading(scope, () => safeFindNodeHandle(title.current)),
    [scope]
  )
  return (
    <Text
      ref={title}
      accessibilityRole="header"
      numberOfLines={1}
      style={{
        color: tintColor ?? colors.text,
        fontSize: type.lg.fontSize,
        lineHeight: type.lg.lineHeight,
        fontWeight: fontWeight.semibold,
      }}
    >
      {children}
    </Text>
  )
}
