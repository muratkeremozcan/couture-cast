import React from 'react'

// Story 6.16: the guest preview draws sample garments with react-native-svg. Under
// vitest browser mode the native module is absent, so Svg and Path render plain DOM
// SVG with the same accessibility props mapped to ARIA.
export function Path({ d, fill, stroke, strokeWidth }) {
  return <path d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
}

export default function Svg({
  children,
  viewBox,
  width,
  height,
  testID,
  accessibilityLabel,
  accessible,
}) {
  const labelled = accessible !== false && accessibilityLabel
  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      data-testid={testID}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? accessibilityLabel : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {children}
    </svg>
  )
}
