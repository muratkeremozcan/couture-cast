// Story CC-7.9 D7 owner: the one page surface every web tab and routed sub-screen sits on.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
import type { ReactNode } from 'react'

export interface AppPageProps {
  children: ReactNode
  /** Layout only (flex, overflow); the surface color is always `page`. */
  className?: string
  testId?: string
}

/**
 * D7: the single `page` surface of a screen (`data-surface="page"`). It holds the top bar, the
 * screen's `main` and the bottom tab bar. Cards inside it are one level deep and carry
 * `data-surface="card"`; a card never holds another card.
 */
export function AppPage({ children, className, testId }: AppPageProps) {
  return (
    <div
      data-surface="page"
      data-testid={testId}
      className={`flex min-h-screen flex-col bg-page text-ink ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

/** The main column without a width, for a page that sets its own `max-w-*`. */
export const APP_MAIN_BASE_CLASS =
  'mx-auto flex w-full flex-1 flex-col px-4 pt-4 pb-tab-bar outline-none md:pb-8'

/** The main column under the top bar: page gutters and room for the bottom tab bar. */
export const APP_MAIN_CLASS = `${APP_MAIN_BASE_CLASS} max-w-6xl`

/**
 * The same column at reading width (Community, Profile, forms). A separate constant because two
 * `max-w-*` classes on one element resolve by stylesheet order, and `max-w-6xl` would win.
 */
export const APP_MAIN_NARROW_CLASS = `${APP_MAIN_BASE_CLASS} max-w-3xl`
