// Browser-only Expo Image adapter. Let the browser deliver real media load and error events.
import type { ImageProps } from 'expo-image'
import type { CSSProperties } from 'react'
import { StyleSheet } from 'react-native'

export function Image({ source, testID, style, onLoad, onError }: ImageProps) {
  const image = Array.isArray(source) ? source[0] : source
  const uri =
    typeof image === 'string'
      ? image
      : image && typeof image === 'object' && 'uri' in image
        ? image.uri
        : undefined
  return (
    <img
      alt=""
      aria-hidden="true"
      src={uri}
      data-testid={testID}
      style={StyleSheet.flatten(style) as CSSProperties}
      onLoad={({ currentTarget }) =>
        onLoad?.({
          cacheType: 'none',
          source: {
            url: currentTarget.currentSrc,
            width: currentTarget.naturalWidth,
            height: currentTarget.naturalHeight,
            mediaType: null,
            isAnimated: false,
          },
        })
      }
      onError={() => onError?.({ error: 'Image failed to load' })}
    />
  )
}
