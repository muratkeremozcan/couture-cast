// Story CC-7.11 D2 owner: the shell's small outline glyphs (back, row chevron, close), drawn with
// react-native-svg in the same 24 x 24 round 2 px stroke as the tab icons, so the top bar, the
// layers and the link rows need no icon font.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import { TAB_ICON_STROKE_WIDTH, TAB_ICON_VIEWBOX } from '@couture/utils'
import Svg, { Path } from 'react-native-svg'

const PATHS = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 18l6-6-6-6',
  close: 'M18 6L6 18M6 6l12 12',
  tag: 'M20 13l-7 7L4 11V4h7zM8 8h.01',
  warning: 'M12 3 2 20h20zM12 9v4m0 3h.01',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
} as const

export type ShellIconName = keyof typeof PATHS

/** A decorative glyph; the control around it carries the accessible name. */
export function ShellIcon({
  name,
  size,
  color,
}: {
  name: ShellIconName
  size: number
  color: string
}) {
  return (
    <Svg width={size} height={size} viewBox={TAB_ICON_VIEWBOX} accessible={false}>
      <Path
        d={PATHS[name]}
        fill="none"
        stroke={color}
        strokeWidth={TAB_ICON_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
