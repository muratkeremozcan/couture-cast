// Story CC-7.11 D2 owner: the web drawing of the shared tab icon set.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import {
  TAB_ICON_PATHS,
  TAB_ICON_SIZE,
  TAB_ICON_STROKE_WIDTH,
  TAB_ICON_VIEWBOX,
  type AppTabId,
} from '@couture/utils'

/** The tab's outline icon, stroked in the label color (`currentColor`). */
export function TabIcon({ id }: { id: AppTabId }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid={`tab-icon-${id}`}
      viewBox={TAB_ICON_VIEWBOX}
      width={TAB_ICON_SIZE}
      height={TAB_ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth={TAB_ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {TAB_ICON_PATHS[id].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
