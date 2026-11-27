// Story CC-7.11 D7, D8 owner: the one-line row that opens a sub-screen (Profile > Style, the Style
// rows, the Looks Capsules and Plan rows).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import Link from 'next/link'

export interface NavRowProps {
  href: string
  label: string
  value?: string
  testId: string
  /**
   * The last row of a group that a ruled section follows: it drops its own rule, so the two
   * rules never frame an empty band (Profile's rows above Locations).
   */
  last?: boolean
}

/** A neutral full-width link row with a chevron: a 44 px target with a rule below. */
export function NavRow({ href, label, value, testId, last = false }: NavRowProps) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`flex min-h-touch items-center justify-between gap-2 py-3 text-base font-medium text-ink ${
        last ? '' : 'border-b border-line'
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 [overflow-wrap:anywhere]">
        <span className="min-w-0">{label}</span>
        {value && (
          <span className="min-w-0 text-sm font-normal text-ink-muted">{value}</span>
        )}
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 shrink-0 text-ink-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  )
}
