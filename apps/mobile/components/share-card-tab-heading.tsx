import React, { useLayoutEffect, useRef } from 'react'
import { Text, Platform } from 'react-native'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  registerShareCardHeading,
  type ShareCardHeadingScope,
} from '@/src/lib/share-card-focus'

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
        color: tintColor,
        fontSize: Platform.OS === 'ios' ? 17 : 20,
        fontWeight: Platform.OS === 'ios' ? '600' : '500',
      }}
    >
      {children}
    </Text>
  )
}
