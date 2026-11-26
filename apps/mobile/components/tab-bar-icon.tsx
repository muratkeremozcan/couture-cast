// Story CC-7.11 D2 owner: the native tab icon. It strokes the shared `@couture/utils` outline path
// set through react-native-svg in the label color, the same paths the web tab bar draws, so the
// two bars cannot drift apart and FontAwesome leaves the tab bar.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import {
  TAB_ICON_PATHS,
  TAB_ICON_SIZE,
  TAB_ICON_STROKE_WIDTH,
  TAB_ICON_VIEWBOX,
  type AppTabId,
} from '@couture/utils'
import Svg, { Path } from 'react-native-svg'

export interface TabIconProps {
  tabId: AppTabId
  /** The label color, so the icon follows the active and inactive tint. */
  color: string
}

/** One 24 x 24 outline: a round 2 px stroke and no fill. Decorative: the tab names itself. */
export function TabIcon({ tabId, color }: TabIconProps) {
  return (
    <Svg
      testID={`tab-${tabId}-icon`}
      width={TAB_ICON_SIZE}
      height={TAB_ICON_SIZE}
      viewBox={TAB_ICON_VIEWBOX}
      accessible={false}
    >
      {TAB_ICON_PATHS[tabId].map((d) => (
        <Path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={TAB_ICON_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  )
}
